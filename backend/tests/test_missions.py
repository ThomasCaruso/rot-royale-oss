"""Daily missions (engagement layer): the three daily missions derive from real ET-day signals,
the chest reward rotates by ET weekday, and claiming is eligibility-gated + idempotent (claim once
per ET day, grant exactly once even on a double-claim).

Pure-service tests: they insert the signal rows directly via the session and call the service with
an injected `now`, mirroring tests/test_settlement.py.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from app.core.timezone import window_bounds_utc
from app.models import (
    ContestWindow,
    DailyChestClaim,
    DuelMatch,
    Entry,
    GemLedger,
    Profile,
    User,
    UserCampaignProgress,
)
from app.models.contest import CLOSED, SUBMITTED
from app.services.missions import (
    CHEST_CLAIMED,
    CHEST_IN_PROGRESS,
    CHEST_READY,
    ChestNotEligibleError,
    claim_chest,
    compute_missions,
    get_missions_view,
    weekday_reward,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

# A fixed Monday 2026-06-15, 18:00 UTC = 14:00 EDT — the ET day is 2026-06-15 (Mon → 50 coins).
MON_NOW = datetime(2026, 6, 15, 18, 0, tzinfo=UTC)
MON_DATE = date(2026, 6, 15)
# A fixed Tuesday (a gem reward day: 1 gem).
TUE_NOW = datetime(2026, 6, 16, 18, 0, tzinfo=UTC)
TUE_DATE = date(2026, 6, 16)


# ---------------- DB helpers ----------------
async def _user(session: AsyncSession) -> User:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(Profile(user_id=user.id, username=f"u{uuid.uuid4().hex[:10]}", division="Bronze"))
    await session.flush()
    return user


async def _played_royale(session: AsyncSession, user: User, d: date) -> None:
    """A SUBMITTED entry in the royale window for ET date `d` (the play_royale signal)."""
    open_at, close_at = window_bounds_utc(d, "royale")
    w = ContestWindow(
        contest_date=d,
        slot="royale",
        open_at=open_at,
        close_at=close_at,
        state=CLOSED,
        template_id="dr_8_trivia",
    )
    session.add(w)
    await session.flush()
    session.add(
        Entry(
            window_id=w.id,
            user_id=user.id,
            seed=1,
            round_set=[],
            started_at=datetime.now(UTC),
            submitted_at=datetime.now(UTC),
            total_score=500,
            status=SUBMITTED,
        )
    )
    await session.flush()


async def _completed_duel(session: AsyncSession, user: User, d: date) -> None:
    """A completed duel on ET date `d` (the complete_duel signal)."""
    entry = Entry(
        window_id=None,
        user_id=user.id,
        is_practice=True,
        seed=42,
        round_set=[],
        started_at=datetime.now(UTC),
        status="IN_PROGRESS",
    )
    session.add(entry)
    await session.flush()
    session.add(
        DuelMatch(
            user_id=user.id,
            entry_id=entry.id,
            duel_type="training",
            seed=7,
            rival_run=[],
            status="completed",
            contest_date=d,
        )
    )
    await session.flush()


async def _cleared_campaign(session: AsyncSession, user: User, when: datetime) -> None:
    """A campaign level cleared at `when` (the clear_campaign signal; drives completed_at)."""
    session.add(
        UserCampaignProgress(
            user_id=user.id,
            world="Science",
            level_number=1,
            best_correct=8,
            clear_status="clear",
            first_clear_claimed=True,
            times_cleared=1,
            completed_at=when,
        )
    )
    await session.flush()


async def _coins(session: AsyncSession, user_id: uuid.UUID) -> int:
    p = await session.get(Profile, user_id)
    return p.coins_balance


async def _gems(session: AsyncSession, user_id: uuid.UUID) -> int:
    p = await session.get(Profile, user_id)
    return p.gems_balance


def _done(missions) -> set[str]:
    return {m.id for m in missions if m.done}


# ---------------- weekday reward (pure) ----------------
def test_weekday_reward_rotation():
    # Mon 2026-06-15 .. Sun 2026-06-21 → the fixed v1 rotation.
    expected = [
        (date(2026, 6, 15), (50, 0)),  # Mon
        (date(2026, 6, 16), (0, 1)),  # Tue
        (date(2026, 6, 17), (75, 0)),  # Wed
        (date(2026, 6, 18), (50, 0)),  # Thu
        (date(2026, 6, 19), (0, 1)),  # Fri
        (date(2026, 6, 20), (100, 0)),  # Sat
        (date(2026, 6, 21), (0, 2)),  # Sun
    ]
    for d, (coins, gems) in expected:
        r = weekday_reward(d)
        assert (r.coins, r.gems) == (coins, gems), d


# ---------------- mission derivation ----------------
async def test_fresh_user_has_no_missions_and_chest_in_progress(db_session: AsyncSession):
    u = await _user(db_session)
    view = await get_missions_view(db_session, u.id, now=MON_NOW)
    assert _done(view.missions) == set()
    assert view.completed_count == 0
    assert view.chest_state == CHEST_IN_PROGRESS
    assert (view.reward.coins, view.reward.gems) == (50, 0)  # Monday


async def test_play_royale_marks_mission_done(db_session: AsyncSession):
    u = await _user(db_session)
    await _played_royale(db_session, u, MON_DATE)
    missions = await compute_missions(db_session, u.id, now=MON_NOW)
    assert _done(missions) == {"play_royale"}


async def test_completed_duel_marks_mission_done(db_session: AsyncSession):
    u = await _user(db_session)
    await _completed_duel(db_session, u, MON_DATE)
    missions = await compute_missions(db_session, u.id, now=MON_NOW)
    assert _done(missions) == {"complete_duel"}


async def test_campaign_clear_marks_mission_done(db_session: AsyncSession):
    u = await _user(db_session)
    await _cleared_campaign(db_session, u, MON_NOW)
    missions = await compute_missions(db_session, u.id, now=MON_NOW)
    assert _done(missions) == {"clear_campaign"}


async def test_two_missions_make_chest_ready(db_session: AsyncSession):
    u = await _user(db_session)
    await _played_royale(db_session, u, MON_DATE)
    await _completed_duel(db_session, u, MON_DATE)
    view = await get_missions_view(db_session, u.id, now=MON_NOW)
    assert view.completed_count == 2
    assert view.chest_state == CHEST_READY


# ---------------- claim: grant + idempotency ----------------
async def test_claim_grants_coins_and_is_idempotent(db_session: AsyncSession):
    u = await _user(db_session)
    await _played_royale(db_session, u, MON_DATE)
    await _completed_duel(db_session, u, MON_DATE)

    res = await claim_chest(db_session, u.id, now=MON_NOW)
    assert res.already_claimed is False
    assert (res.coins_awarded, res.gems_awarded) == (50, 0)
    assert await _coins(db_session, u.id) == 50

    # The chest now reads as claimed.
    view = await get_missions_view(db_session, u.id, now=MON_NOW)
    assert view.chest_state == CHEST_CLAIMED

    # A second claim is a no-op: no double-grant, exactly one claim row.
    again = await claim_chest(db_session, u.id, now=MON_NOW)
    assert again.already_claimed is True
    assert await _coins(db_session, u.id) == 50
    rows = (
        await db_session.execute(
            select(func.count()).select_from(DailyChestClaim).where(DailyChestClaim.user_id == u.id)
        )
    ).scalar_one()
    assert rows == 1


async def test_claim_gem_day_grants_gem_once(db_session: AsyncSession):
    u = await _user(db_session)
    await _played_royale(db_session, u, TUE_DATE)
    await _cleared_campaign(db_session, u, TUE_NOW)

    res = await claim_chest(db_session, u.id, now=TUE_NOW)
    assert (res.coins_awarded, res.gems_awarded) == (0, 1)
    assert await _gems(db_session, u.id) == 1
    gem_rows = (
        await db_session.execute(
            select(func.count())
            .select_from(GemLedger)
            .where(GemLedger.user_id == u.id, GemLedger.reason == "daily_chest")
        )
    ).scalar_one()
    assert gem_rows == 1

    await claim_chest(db_session, u.id, now=TUE_NOW)  # idempotent
    assert await _gems(db_session, u.id) == 1


async def test_claim_rejects_when_under_threshold(db_session: AsyncSession):
    u = await _user(db_session)
    await _played_royale(db_session, u, MON_DATE)  # only 1 of 3
    with pytest.raises(ChestNotEligibleError):
        await claim_chest(db_session, u.id, now=MON_NOW)
    # Nothing granted, no claim row.
    assert await _coins(db_session, u.id) == 0
    rows = (
        await db_session.execute(
            select(func.count()).select_from(DailyChestClaim).where(DailyChestClaim.user_id == u.id)
        )
    ).scalar_one()
    assert rows == 0
