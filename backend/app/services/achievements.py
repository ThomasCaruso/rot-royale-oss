"""Achievements engine: who has earned which badges/titles (Identity V2).

Earned is COMPUTED ON READ — no grant table. The inputs (campaign progress, settled standings,
ranked entries) are durable and only ever grow, so achievements are monotonic. Requirement
grammar lives in core/achievements.py; the world-completion machinery is shared with the vault's
cosmetic gating (services/world_progress.py) — one source of truth for "world fully cleared".

Every aggregate is computed AT MOST ONCE per request (`_Aggregates`), then all 16 catalog
requirements are answered from it. Unknown requirement formats are never earned (safe default:
a catalog typo can lock an achievement — loud, visible, fixable — but never hand it out early).

Equipping badges/titles never touches rating/division/streak/standings (tested invariant).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from content.campaign import manifest as cm
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.achievements import BADGE_CATALOG, TITLE_CATALOG
from app.models import Entry, Profile, Standing
from app.services.world_progress import (
    all_worlds_cleared,
    cleared_world_count,
    world_cleared,
    world_completion,
)

__all__ = ["IdentityItemView", "earned_map", "get_identity"]


@dataclass(frozen=True)
class IdentityItemView:
    id: str
    earned: bool
    equipped: bool


@dataclass(frozen=True)
class _Aggregates:
    """Everything the requirement grammar can ask about, computed once per request."""

    completion: dict[str, int]  # world → cleared-level count (any clear_status)
    cleared_worlds: int  # how many manifest worlds are fully cleared
    perfect_world_any: bool  # ≥1 world with EVERY level clear_status='perfect'
    top3: int  # settled standings with place <= 3
    first_place: int  # settled standings with place == 1
    ranked_entries: int  # entries on ranked contest windows (never practice/campaign)


async def _collect(session: AsyncSession, user_id: uuid.UUID) -> _Aggregates:
    completion = await world_completion(session, user_id)
    perfect = await world_completion(session, user_id, perfect_only=True)
    top3, first_place = (
        await session.execute(
            select(
                func.count().filter(Standing.place <= 3),
                func.count().filter(Standing.place == 1),
            ).where(Standing.user_id == user_id)
        )
    ).one()
    # Ranked = window-attached. Practice and campaign entries have window_id NULL (is_practice
    # True) — "every contest query filters by window_id" (models/contest.py), so this counts
    # exactly the user's ranked-window entries.
    ranked_entries = (
        await session.execute(
            select(func.count())
            .select_from(Entry)
            .where(Entry.user_id == user_id, Entry.window_id.is_not(None))
        )
    ).scalar_one()
    return _Aggregates(
        completion=completion,
        cleared_worlds=cleared_world_count(completion),
        perfect_world_any=any(world_cleared(perfect, w.world) for w in cm.worlds()),
        top3=int(top3),
        first_place=int(first_place),
        ranked_entries=int(ranked_entries),
    )


def _parse_n(raw: str) -> int | None:
    """The <n> of a counted requirement: a positive int, else None (malformed → never earned)."""
    try:
        n = int(raw)
    except ValueError:
        return None
    return n if n >= 1 else None


def _requirement_met(req: str, agg: _Aggregates) -> bool:
    if req == "all_worlds":
        return all_worlds_cleared(agg.completion)
    if req == "perfect_world_any":
        return agg.perfect_world_any
    if req.startswith("world:"):
        return world_cleared(agg.completion, req.removeprefix("world:"))
    counted = {
        "worlds_any:": agg.cleared_worlds,
        "top3:": agg.top3,
        "first_place:": agg.first_place,
        "ranked_entries:": agg.ranked_entries,
    }
    for prefix, have in counted.items():
        if req.startswith(prefix):
            n = _parse_n(req.removeprefix(prefix))
            return n is not None and have >= n
    return False  # unknown format → not earned (safe default)


async def earned_map(session: AsyncSession, user_id: uuid.UUID) -> dict[str, bool]:
    """Earned flag for every catalog achievement (all 16 ids), one aggregate pass."""
    agg = await _collect(session, user_id)
    return {a.id: _requirement_met(a.requirement, agg) for a in (*BADGE_CATALOG, *TITLE_CATALOG)}


async def get_identity(
    session: AsyncSession, user_id: uuid.UUID
) -> tuple[list[IdentityItemView], list[IdentityItemView]]:
    """(badges, titles) in catalog order, each with earned + equipped flags."""
    profile = await session.get(Profile, user_id)
    if profile is None:
        raise LookupError(f"No profile for user {user_id}")
    earned = await earned_map(session, user_id)
    equipped_badges = set(profile.equipped_badges)
    badges = [
        IdentityItemView(id=a.id, earned=earned[a.id], equipped=a.id in equipped_badges)
        for a in BADGE_CATALOG
    ]
    titles = [
        IdentityItemView(id=a.id, earned=earned[a.id], equipped=a.id == profile.equipped_title)
        for a in TITLE_CATALOG
    ]
    return badges, titles
