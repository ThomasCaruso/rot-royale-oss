"""Unlock-source engine (vault unlock foundation).

Three layers, cleanly separated:

  1. `requirement_met(req, progress)` — a PURE function: given a requirement string and a snapshot
     of the player's progress, is it satisfied right now? No DB, unit-tested per verb.
  2. `gather_progress(session, user_id)` — builds that snapshot from the DB (campaign progress,
     profile streak/division, duel stats), a bounded number of queries per request.
  3. `pending_unlocks` / `acknowledge_unlocks` — the earn-moment orchestration: what has the player
     newly earned (met now, not yet acknowledged), and the once-only ack + earned-free grant.

Permanence lives in user_unlock_acks (see models/unlock_ack.py): the requirement check reads CURRENT
values, but once acknowledged an item stays unlocked forever — the ack row is the high-water mark.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import DUEL_TIER_THRESHOLDS
from app.core.cosmetics import COSMETIC_CATALOG, CosmeticItem
from app.models import (
    ContestWindow,
    DuelUserStats,
    Entry,
    Profile,
    User,
    UserCampaignProgress,
    UserCosmetic,
    UserTheme,
    UserUnlockAck,
)
from app.models.campaign import PERFECT  # noqa: F401  (kept for parity with world_progress filters)
from app.models.contest import SUBMITTED
from app.services.rating import DIVISION_THRESHOLDS
from app.services.world_progress import all_worlds_cleared, world_cleared

__all__ = [
    "PlayerProgress",
    "acknowledge_unlocks",
    "gather_progress",
    "pending_unlocks",
    "requirement_met",
]

# Ordered division / duel-tier names, LOW → HIGH, for the `>=` comparisons. Derived from the single
# sources of truth so a rebalance there flows here automatically.
_DIVISION_ORDER: tuple[str, ...] = tuple(name for _, name in reversed(DIVISION_THRESHOLDS))
_DUEL_TIER_ORDER: tuple[str, ...] = tuple(name for name, _ in DUEL_TIER_THRESHOLDS)


def _rank(name: str, order: tuple[str, ...]) -> int:
    """Index of `name` in a low→high order, or -1 if unknown (safe default: unknown → not met)."""
    try:
        return order.index(name)
    except ValueError:
        return -1


@dataclass(frozen=True)
class PlayerProgress:
    """Everything the requirement grammar needs, snapshotted once per evaluation."""

    cleared_levels: frozenset[tuple[str, int]] = field(default_factory=frozenset)
    world_counts: dict[str, int] = field(default_factory=dict)
    streak: int = 0
    division: str = "Bronze"
    duel_wins: int = 0
    duel_tier: str = "bronze"
    duel_perfect: int = 0
    # Completed Daily Royales (SUBMITTED royale entries); only grows, so never re-locks.
    royales_played: int = 0
    # 1-based position of this account in registration order (users.created_at). 0 = unknown →
    # founder requirements safely NOT met (a snapshot built without the rank can't leak the
    # exclusive; registration order never changes, so met-once is met-forever).
    registration_rank: int = 0


def _int_arg(value: str) -> int | None:
    try:
        return int(value)
    except ValueError:
        return None


def requirement_met(req: str | None, p: PlayerProgress) -> bool:
    """PURE: is `req` satisfied by snapshot `p`? Unknown/malformed verb → False (safe default: a
    catalog typo can lock an item, never leak one)."""
    if req is None:
        return True
    if req == "all_worlds":
        return all_worlds_cleared(p.world_counts)
    verb, _, arg = req.partition(":")
    if verb == "world":
        return world_cleared(p.world_counts, arg)
    if verb == "level":
        world, _, num = arg.rpartition(":")
        n = _int_arg(num)
        return n is not None and (world, n) in p.cleared_levels
    if verb == "streak":
        n = _int_arg(arg)
        return n is not None and p.streak >= n
    if verb == "royales":
        n = _int_arg(arg)
        return n is not None and p.royales_played >= n
    if verb == "division":
        want = _rank(arg, _DIVISION_ORDER)
        return want >= 0 and _rank(p.division, _DIVISION_ORDER) >= want
    if verb == "duel_wins":
        n = _int_arg(arg)
        return n is not None and p.duel_wins >= n
    if verb == "duel_tier":
        want = _rank(arg, _DUEL_TIER_ORDER)
        return want >= 0 and _rank(p.duel_tier, _DUEL_TIER_ORDER) >= want
    if verb == "duel_perfect":
        n = _int_arg(arg)
        return n is not None and p.duel_perfect >= n
    if verb == "founder":
        n = _int_arg(arg)
        return n is not None and 0 < p.registration_rank <= n
    return False


async def gather_progress(session: AsyncSession, user_id: uuid.UUID) -> PlayerProgress:
    """Snapshot the player's unlock-relevant progress from the DB. Cheap: one campaign-progress
    query, the profile (usually already loaded), and the duel-stats row (may be absent)."""
    rows = (
        await session.execute(
            select(UserCampaignProgress.world, UserCampaignProgress.level_number).where(
                UserCampaignProgress.user_id == user_id,
                UserCampaignProgress.clear_status.is_not(None),
            )
        )
    ).all()
    cleared = frozenset((w, ln) for w, ln in rows)
    counts: dict[str, int] = {}
    for w, _ in rows:
        counts[w] = counts.get(w, 0) + 1

    profile = await session.get(Profile, user_id)
    stats = await session.get(DuelUserStats, user_id)

    # Registration rank for founder:<n> — how many accounts existed up to (and including) this one,
    # by created_at. Ties on identical timestamps count generously (both rank equal); registration
    # order never changes, so the check is stable forever.
    user = await session.get(User, user_id)
    registration_rank = 0
    if user is not None:
        earlier = await session.scalar(
            select(func.count()).select_from(User).where(User.created_at < user.created_at)
        )
        registration_rank = int(earlier or 0) + 1

    # Completed Daily Royales: SUBMITTED entries in royale-slot windows (a finished ranked run).
    royales_played = int(
        await session.scalar(
            select(func.count())
            .select_from(Entry)
            .join(ContestWindow, Entry.window_id == ContestWindow.id)
            .where(
                Entry.user_id == user_id,
                Entry.status == SUBMITTED,
                ContestWindow.slot == "royale",
            )
        )
        or 0
    )

    return PlayerProgress(
        cleared_levels=cleared,
        world_counts=counts,
        streak=profile.streak_count if profile else 0,
        division=profile.division if profile else "Bronze",
        duel_wins=stats.wins if stats else 0,
        duel_tier=stats.duel_tier if stats else "bronze",
        duel_perfect=stats.perfect_wins if stats else 0,
        registration_rank=registration_rank,
        royales_played=royales_played,
    )


async def _acked_ids(session: AsyncSession, user_id: uuid.UUID) -> set[str]:
    return {
        r
        for r in (
            await session.execute(
                select(UserUnlockAck.item_id).where(UserUnlockAck.user_id == user_id)
            )
        ).scalars()
    }


async def _owned_ids(session: AsyncSession, user_id: uuid.UUID) -> set[str]:
    theme_ids = (
        await session.execute(select(UserTheme.theme_id).where(UserTheme.user_id == user_id))
    ).scalars()
    cosmetic_ids = (
        await session.execute(select(UserCosmetic.item_id).where(UserCosmetic.user_id == user_id))
    ).scalars()
    return set(theme_ids) | set(cosmetic_ids)


async def pending_unlocks(session: AsyncSession, user_id: uuid.UUID) -> list[CosmeticItem]:
    """Items the player has NEWLY earned: requirement met now, requirement is real (not None), and
    not yet acknowledged. This is the diff both the results screens and the Home net celebrate.

    UNRELEASED items are excluded. Acknowledging an earned-free unlock writes a permanent ownership
    grant, and ownership outranks `locked` at equip time — so letting a `coming_soon` item through
    here would hand out the very thing the flag is holding back, to exactly the players who play
    hardest. It re-enters this pipeline untouched the moment the flag is cleared."""
    progress = await gather_progress(session, user_id)
    acked = await _acked_ids(session, user_id)
    return [
        item
        for item in COSMETIC_CATALOG
        if item.requirement is not None
        and not item.coming_soon
        and item.id not in acked
        and requirement_met(item.requirement, progress)
    ]


async def acknowledge_unlocks(
    session: AsyncSession, user_id: uuid.UUID, item_ids: list[str]
) -> list[CosmeticItem]:
    """Mark the given pending unlocks as revealed: write an ack row for each, and for earned-free
    (cost 0) items also write the permanent ownership grant. Idempotent — a duplicate ack or grant
    (composite PK) is swallowed so re-reveals are harmless. Never commits (request boundary does).
    Only items that are genuinely pending are acted on; ids that aren't get ignored. Returns the
    items actually acknowledged this call."""
    if not item_ids:
        return []
    wanted = set(item_ids)
    pending = [i for i in await pending_unlocks(session, user_id) if i.id in wanted]
    owned = await _owned_ids(session, user_id)
    done: list[CosmeticItem] = []
    for item in pending:
        try:
            # A SAVEPOINT per item: a concurrent duplicate (composite PK clash) rolls back only this
            # item, never the outer transaction or the acks already written this call.
            async with session.begin_nested():
                session.add(UserUnlockAck(user_id=user_id, item_id=item.id))
                if item.cost == 0 and item.id not in owned:
                    # earned-free → permanent ownership grant (equip reads ownership rows).
                    if item.kind == "theme":
                        session.add(UserTheme(user_id=user_id, theme_id=item.id))
                    else:
                        session.add(UserCosmetic(user_id=user_id, item_id=item.id, kind=item.kind))
        except IntegrityError:
            # concurrent reveal of the same unlock lost the race — already acked/owned, harmless.
            continue
        done.append(item)
    return done
