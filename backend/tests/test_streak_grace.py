"""Free weekly streak-grace: a single missed Daily Royale day is forgiven ONCE per ISO week, so a
strong streak survives one slip instead of resetting to 1. Grace is consumed at settlement and
recorded on the profile (streak_grace_used_date); available again the next ISO week.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from app.core.timezone import window_bounds_utc
from app.models import ContestWindow, Entry, Profile, User
from app.models.contest import CLOSED, SUBMITTED
from app.services.settlement import grace_available, next_streak, settle_window
from sqlalchemy.ext.asyncio import AsyncSession


# ---------------- pure logic ----------------
def test_grace_available_by_iso_week():
    mon = date(2026, 6, 15)  # Monday
    wed = date(2026, 6, 17)  # same ISO week
    prev_mon = date(2026, 6, 8)  # previous ISO week
    assert grace_available(None, mon) is True  # never used
    assert grace_available(mon, wed) is False  # already spent this week
    assert grace_available(prev_mon, mon) is True  # spent last week → refreshed


def test_next_streak_grace_rules():
    d = date(2026, 6, 15)
    # consecutive day → +1, no grace consumed
    assert next_streak(d - timedelta(days=1), d, 5, True) == (6, d, False)
    # exactly one missed day + grace available → streak lives, grace consumed
    assert next_streak(d - timedelta(days=2), d, 5, True) == (6, d, True)
    # one missed day but NO grace → reset
    assert next_streak(d - timedelta(days=2), d, 5, False) == (1, d, False)
    # two missed days → grace can't cover it, reset
    assert next_streak(d - timedelta(days=3), d, 5, True) == (1, d, False)
    # nothing to save (streak 0) → reset even with grace
    assert next_streak(d - timedelta(days=2), d, 0, True) == (1, d, False)
    # already counted today → unchanged
    assert next_streak(d, d, 5, True) == (5, d, False)


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


# ---------------- integration ----------------
async def test_grace_saves_a_streak_after_one_missed_day(db_session: AsyncSession):
    d = date(2026, 6, 15)  # Monday
    u = await _user(db_session)
    p = await db_session.get(Profile, u.id)
    p.streak_count = 5
    p.last_streak_date = d - timedelta(days=2)  # missed yesterday
    await db_session.flush()

    w = await _closed_royale(db_session, d)
    await _entry(db_session, w, u, 1000)
    await settle_window(db_session, w.id)

    p = await db_session.get(Profile, u.id)
    assert p.streak_count == 6  # streak survived the slip
    assert p.streak_grace_used_date == d  # grace consumed this week


async def test_grace_is_once_per_week(db_session: AsyncSession):
    d = date(2026, 6, 17)  # Wednesday
    u = await _user(db_session)
    p = await db_session.get(Profile, u.id)
    p.streak_count = 6
    p.last_streak_date = d - timedelta(days=2)  # missed yesterday again
    p.streak_grace_used_date = date(2026, 6, 15)  # already used this ISO week (Mon)
    await db_session.flush()

    w = await _closed_royale(db_session, d)
    await _entry(db_session, w, u, 1000)
    await settle_window(db_session, w.id)

    p = await db_session.get(Profile, u.id)
    assert p.streak_count == 1  # no grace left this week → reset


async def test_two_day_gap_resets_even_with_grace(db_session: AsyncSession):
    d = date(2026, 6, 15)
    u = await _user(db_session)
    p = await db_session.get(Profile, u.id)
    p.streak_count = 5
    p.last_streak_date = d - timedelta(days=3)  # two missed days
    await db_session.flush()

    w = await _closed_royale(db_session, d)
    await _entry(db_session, w, u, 1000)
    await settle_window(db_session, w.id)

    p = await db_session.get(Profile, u.id)
    assert p.streak_count == 1
    assert p.streak_grace_used_date is None  # grace not touched
