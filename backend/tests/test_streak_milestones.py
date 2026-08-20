"""Streak milestone rewards (engagement layer): when the Daily Royale daily streak first reaches
day 3 / 5 / 7, settlement grants a small EARNED gem reward — idempotent (gem key), royale-only, and
never touching non-milestone days. Earned, never purchasable.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from app.core.timezone import window_bounds_utc
from app.models import ContestWindow, Entry, GemLedger, Profile, User
from app.models.contest import CLOSED, SUBMITTED
from app.services.settlement import settle_window, streak_milestone_reward
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


# ---------------- pure helper ----------------
def test_streak_milestone_reward_table():
    assert streak_milestone_reward(3) == (0, 1)
    assert streak_milestone_reward(5) == (0, 2)
    assert streak_milestone_reward(7) == (0, 3)
    for non in (1, 2, 4, 6, 8, 10):
        assert streak_milestone_reward(non) is None


# ---------------- DB helpers ----------------
async def _user(session: AsyncSession) -> User:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(Profile(user_id=user.id, username=f"u{uuid.uuid4().hex[:10]}", division="Bronze"))
    await session.flush()
    return user


async def _closed_royale(session: AsyncSession, d: date) -> ContestWindow:
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
    return w


async def _entry(session: AsyncSession, w: ContestWindow, u: User, score: int) -> Entry:
    e = Entry(
        window_id=w.id,
        user_id=u.id,
        seed=1,
        round_set=[],
        started_at=datetime.now(UTC),
        submitted_at=datetime.now(UTC),
        total_score=score,
        status=SUBMITTED,
    )
    session.add(e)
    await session.flush()
    return e


async def _milestone_gems(session: AsyncSession, user_id: uuid.UUID) -> list[int]:
    return list(
        (
            await session.execute(
                select(GemLedger.delta).where(
                    GemLedger.user_id == user_id, GemLedger.reason == "streak_milestone"
                )
            )
        )
        .scalars()
        .all()
    )


# ---------------- integration ----------------
async def test_reaching_day_3_grants_one_milestone_gem(db_session: AsyncSession):
    d = date(2026, 6, 15)
    u = await _user(db_session)
    # Pre-seed a 2-day streak ending yesterday so settling today's window crosses to day 3.
    p = await db_session.get(Profile, u.id)
    p.streak_count = 2
    p.last_streak_date = d - timedelta(days=1)
    await db_session.flush()

    w = await _closed_royale(db_session, d)
    await _entry(db_session, w, u, 1200)
    await settle_window(db_session, w.id)

    p = await db_session.get(Profile, u.id)
    assert p.streak_count == 3  # crossed into the milestone
    rows = await _milestone_gems(db_session, u.id)
    assert rows == [1]  # exactly one +1 gem milestone row
    # Balance invariant still holds (milestone + starter/placement gems all flow via the ledger).
    total = (
        await db_session.execute(
            select(func.coalesce(func.sum(GemLedger.delta), 0)).where(GemLedger.user_id == u.id)
        )
    ).scalar_one()
    assert p.gems_balance == total


async def test_non_milestone_day_grants_no_milestone(db_session: AsyncSession):
    d = date(2026, 6, 15)
    u = await _user(db_session)  # fresh → first contest → streak 1 (not a milestone)
    w = await _closed_royale(db_session, d)
    await _entry(db_session, w, u, 900)
    await settle_window(db_session, w.id)

    p = await db_session.get(Profile, u.id)
    assert p.streak_count == 1
    assert await _milestone_gems(db_session, u.id) == []
