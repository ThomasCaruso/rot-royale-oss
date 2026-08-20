"""Shared campaign world-completion helpers (vault requirement gating + achievements engine).

Single source of truth for "is a world fully cleared?": per-world counts of a user's cleared
levels (ONE grouped query per request) compared against the campaign manifest's level counts —
never a hardcoded constant. services/vault.py uses these for cosmetic requirement gating;
services/achievements.py uses the same machinery for badge/title requirements.
"""

from __future__ import annotations

import uuid

from content.campaign import manifest as cm
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UserCampaignProgress
from app.models.campaign import PERFECT

__all__ = [
    "all_worlds_cleared",
    "cleared_world_count",
    "world_cleared",
    "world_completion",
]


async def world_completion(
    session: AsyncSession, user_id: uuid.UUID, *, perfect_only: bool = False
) -> dict[str, int]:
    """Per-world count of this user's CLEARED levels (clear_status set), one query per request.
    Rows are unique per (user, world, level), so the count is a distinct-level count.
    With perfect_only=True, only levels whose best clear_status is 'perfect' count."""
    status_filter = (
        UserCampaignProgress.clear_status == PERFECT
        if perfect_only
        else UserCampaignProgress.clear_status.is_not(None)
    )
    rows = await session.execute(
        select(UserCampaignProgress.world, func.count())
        .where(UserCampaignProgress.user_id == user_id, status_filter)
        .group_by(UserCampaignProgress.world)
    )
    return {world: int(count) for world, count in rows}


def world_cleared(completion: dict[str, int], world_key: str) -> bool:
    """Every level of `world_key` counted in `completion`. The expected level count comes from the
    campaign manifest (the same loader the campaign service uses), never a hardcoded constant."""
    world = cm.get_world(world_key)
    if world is None:
        return False  # unknown world key in a requirement → safe default: not met
    return completion.get(world_key, 0) >= len(world.levels)


def all_worlds_cleared(completion: dict[str, int]) -> bool:
    """Every world in the campaign manifest fully counted in `completion`."""
    return all(world_cleared(completion, w.world) for w in cm.worlds())


def cleared_world_count(completion: dict[str, int]) -> int:
    """How many manifest worlds are fully counted in `completion`."""
    return sum(1 for w in cm.worlds() if world_cleared(completion, w.world))
