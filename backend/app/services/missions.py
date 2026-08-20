"""Daily Missions service (engagement layer).

Three fixed daily missions — play the Daily Royale, complete a duel, clear a campaign level — each
DERIVED on read from real ET-day signals (no per-mission progress table). Complete
DAILY_MISSIONS_REQUIRED of the three to open the daily chest, whose reward is FIXED by ET weekday.

Idempotency: the chest grant must happen exactly once per (user, ET day). The coin ledger has no
idempotency_key, so the `daily_chest_claims` row (PK = user_id, claim_date) is the gate — we insert
it FIRST and grant only after it lands, so a double-claim (even concurrent) never double-pays. The
gem grant additionally carries its own idempotency_key as belt-and-suspenders.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import (
    DAILY_CHEST_COIN_REASON,
    DAILY_CHEST_GEM_REASON,
    DAILY_CHEST_REWARDS,
    DAILY_MISSION_IDS,
    DAILY_MISSIONS_REQUIRED,
)
from app.core.timezone import ET, et_wall_to_utc
from app.models import (
    ContestWindow,
    DailyChestClaim,
    DuelMatch,
    Entry,
    UserCampaignProgress,
)
from app.models.contest import SUBMITTED
from app.services.gem_ledger import record_gem_delta
from app.services.ledger import record_coin_delta

# Chest states (what the player sees / the API surfaces).
CHEST_IN_PROGRESS = "in_progress"  # fewer than required missions done
CHEST_READY = "ready"  # required met, not yet claimed → claimable
CHEST_CLAIMED = "claimed"  # already claimed today

_WEEKDAY_CODES = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


@dataclass(frozen=True)
class ChestReward:
    coins: int
    gems: int
    code: str  # weekday code ("mon".."sun"); the rotation is fixed so this audits what was paid


@dataclass(frozen=True)
class MissionState:
    id: str
    done: bool


@dataclass(frozen=True)
class MissionsView:
    missions: list[MissionState]
    completed_count: int
    required: int
    reward: ChestReward
    chest_state: str


@dataclass(frozen=True)
class ClaimResult:
    reward: ChestReward
    coins_awarded: int
    gems_awarded: int
    already_claimed: bool


class ChestNotEligibleError(Exception):
    """Fewer than DAILY_MISSIONS_REQUIRED missions complete — the chest can't be claimed yet."""


# ---------------- pure helpers ----------------
def et_today(now: datetime) -> date:
    """The America/New_York calendar date for an instant — the day missions are scoped to."""
    return now.astimezone(ET).date()


def _et_day_start_utc(now: datetime) -> datetime:
    """UTC instant of the most recent ET midnight at or before `now`."""
    return et_wall_to_utc(et_today(now), time(0, 0))


def weekday_reward(d: date) -> ChestReward:
    """The fixed chest reward for an ET date, by weekday (Monday=0 .. Sunday=6)."""
    coins, gems = DAILY_CHEST_REWARDS[d.weekday()]
    return ChestReward(coins=coins, gems=gems, code=_WEEKDAY_CODES[d.weekday()])


# ---------------- mission signals (one query each, ET-day scoped) ----------------
async def _played_royale_today(session: AsyncSession, user_id: uuid.UUID, today: date) -> bool:
    """A SUBMITTED entry in today's royale window (keyed off the window's ET contest_date)."""
    stmt = (
        select(Entry.id)
        .join(ContestWindow, ContestWindow.id == Entry.window_id)
        .where(
            Entry.user_id == user_id,
            Entry.status == SUBMITTED,
            ContestWindow.slot == "royale",
            ContestWindow.contest_date == today,
        )
        .limit(1)
    )
    return (await session.scalar(stmt)) is not None


async def _completed_duel_today(session: AsyncSession, user_id: uuid.UUID, today: date) -> bool:
    """A completed duel today (any duel_type; DuelMatch.contest_date is the ET day)."""
    stmt = (
        select(DuelMatch.id)
        .where(
            DuelMatch.user_id == user_id,
            DuelMatch.status == "completed",
            DuelMatch.contest_date == today,
        )
        .limit(1)
    )
    return (await session.scalar(stmt)) is not None


async def _cleared_campaign_today(
    session: AsyncSession, user_id: uuid.UUID, day_start_utc: datetime
) -> bool:
    """A campaign level cleared today. UserCampaignProgress.completed_at is set only on a pass, so
    completed_at >= the ET-day start means a clear happened today (first clear or replay)."""
    stmt = (
        select(UserCampaignProgress.user_id)
        .where(
            UserCampaignProgress.user_id == user_id,
            UserCampaignProgress.completed_at >= day_start_utc,
        )
        .limit(1)
    )
    return (await session.scalar(stmt)) is not None


# ---------------- public API ----------------
async def compute_missions(
    session: AsyncSession, user_id: uuid.UUID, now: datetime | None = None
) -> list[MissionState]:
    """The three daily missions with their done flags, in DAILY_MISSION_IDS order."""
    now = now or datetime.now(UTC)
    today = et_today(now)
    flags = {
        "play_royale": await _played_royale_today(session, user_id, today),
        "complete_duel": await _completed_duel_today(session, user_id, today),
        "clear_campaign": await _cleared_campaign_today(session, user_id, _et_day_start_utc(now)),
    }
    return [MissionState(id=mid, done=flags[mid]) for mid in DAILY_MISSION_IDS]


async def get_missions_view(
    session: AsyncSession, user_id: uuid.UUID, now: datetime | None = None
) -> MissionsView:
    """Missions + today's reward + the chest state (in_progress | ready | claimed)."""
    now = now or datetime.now(UTC)
    today = et_today(now)
    missions = await compute_missions(session, user_id, now)
    completed = sum(1 for m in missions if m.done)
    claimed = (await session.get(DailyChestClaim, (user_id, today))) is not None
    if claimed:
        state = CHEST_CLAIMED
    elif completed >= DAILY_MISSIONS_REQUIRED:
        state = CHEST_READY
    else:
        state = CHEST_IN_PROGRESS
    return MissionsView(
        missions=missions,
        completed_count=completed,
        required=DAILY_MISSIONS_REQUIRED,
        reward=weekday_reward(today),
        chest_state=state,
    )


async def claim_chest(
    session: AsyncSession, user_id: uuid.UUID, now: datetime | None = None
) -> ClaimResult:
    """Claim today's chest. Eligibility-gated (>= required) and idempotent (once per ET day).
    Does not commit (the request boundary does)."""
    now = now or datetime.now(UTC)
    today = et_today(now)

    # Already claimed → return the recorded grant, change nothing.
    existing = await session.get(DailyChestClaim, (user_id, today))
    if existing is not None:
        return _claimed(existing)

    # Recompute eligibility server-side (never trust the client).
    missions = await compute_missions(session, user_id, now)
    if sum(1 for m in missions if m.done) < DAILY_MISSIONS_REQUIRED:
        raise ChestNotEligibleError(f"user {user_id} has not completed {DAILY_MISSIONS_REQUIRED}")

    reward = weekday_reward(today)
    claim = DailyChestClaim(
        user_id=user_id,
        claim_date=today,
        coins_awarded=reward.coins,
        gems_awarded=reward.gems,
        reward_code=reward.code,
    )
    try:
        # Insert the claim row FIRST — it is the idempotency gate. A concurrent double-claim loses
        # here (PK conflict) and returns the winner's recorded claim, never double-granting.
        async with session.begin_nested():
            session.add(claim)
            await session.flush()
    except IntegrityError:
        existing = await session.get(DailyChestClaim, (user_id, today))
        if existing is not None:
            return _claimed(existing)
        raise

    # Grant AFTER the gate row lands. Skip zero amounts so the append-only ledgers carry no noise.
    if reward.coins:
        await record_coin_delta(
            session,
            user_id,
            reward.coins,
            DAILY_CHEST_COIN_REASON,
            ref_type="daily_chest",
            ref_key=today.isoformat(),
        )
    if reward.gems:
        await record_gem_delta(
            session,
            user_id,
            reward.gems,
            DAILY_CHEST_GEM_REASON,
            ref_type="daily_chest",
            ref_key=today.isoformat(),
            idempotency_key=f"daily_chest:{user_id}:{today.isoformat()}",
        )
    return ClaimResult(
        reward=reward,
        coins_awarded=reward.coins,
        gems_awarded=reward.gems,
        already_claimed=False,
    )


def _claimed(row: DailyChestClaim) -> ClaimResult:
    return ClaimResult(
        reward=ChestReward(coins=row.coins_awarded, gems=row.gems_awarded, code=row.reward_code),
        coins_awarded=row.coins_awarded,
        gems_awarded=row.gems_awarded,
        already_claimed=True,
    )
