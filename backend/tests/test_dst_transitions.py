"""Forced spring-forward / fall-back tests (PLAN.md §4, §9).

The whole point: window open/close instants in UTC shift by an hour across a DST change, and the
timer-driven transitioner must fire at the DST-correct UTC moment. We pin both the computed bounds
and the actual SCHEDULED→OPEN edge on each transition day.

2025-03-09: spring forward (EST→EDT at 02:00 local).  2025-11-02: fall back (EDT→EST at 02:00).
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from app.core.timezone import window_bounds_utc
from app.jobs.tasks import ensure_upcoming_windows, run_transitions
from app.models import ContestWindow
from app.models.contest import OPEN, SCHEDULED
from app.services.scheduler import create_windows_for_date
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

SPRING = date(2025, 3, 9)
FALL = date(2025, 11, 2)


# --- Legacy slot bounds (window_bounds_utc still computes these — preserved parsing) ---
def test_spring_forward_legacy_morning_opens_at_edt_instant():
    open_at, _ = window_bounds_utc(SPRING, "morning")
    assert open_at == datetime(2025, 3, 9, 9, 0, tzinfo=UTC)  # 05:00 EDT (UTC-4)


def test_fall_back_legacy_morning_opens_at_est_instant():
    open_at, _ = window_bounds_utc(FALL, "morning")
    assert open_at == datetime(2025, 11, 2, 10, 0, tzinfo=UTC)  # 05:00 EST (UTC-5)


def test_legacy_morning_open_differs_by_one_hour_across_dst():
    spring_open, _ = window_bounds_utc(SPRING, "morning")
    fall_open, _ = window_bounds_utc(FALL, "morning")
    assert (fall_open.hour - spring_open.hour) == 1  # the DST hour, in UTC


# --- Daily Royale bounds across DST (midnight-to-midnight ET, a full day) ---
def test_royale_open_close_track_dst():
    from datetime import timedelta

    # Spring-forward day: midnight ET is still EST (DST starts at 02:00), next midnight is EDT — so
    # the wall-clock "day" is only 23 hours long, and window_bounds_utc reflects that.
    spring_open, spring_close = window_bounds_utc(SPRING, "royale")
    assert spring_open == datetime(2025, 3, 9, 5, 0, tzinfo=UTC)  # 00:00 EST (UTC-5)
    assert spring_close == datetime(2025, 3, 10, 4, 0, tzinfo=UTC)  # 00:00 EDT (UTC-4) next day
    assert spring_close - spring_open == timedelta(hours=23)  # spring-forward day = 23h
    # Fall-back day: midnight ET is EDT, next midnight is EST — a 25-hour wall-clock day.
    fall_open, fall_close = window_bounds_utc(FALL, "royale")
    assert fall_open == datetime(2025, 11, 2, 4, 0, tzinfo=UTC)  # 00:00 EDT (UTC-4)
    assert fall_close == datetime(2025, 11, 3, 5, 0, tzinfo=UTC)  # 00:00 EST (UTC-5) next day
    assert fall_close - fall_open == timedelta(hours=25)  # fall-back day = 25h


async def _royale_state(session: AsyncSession, d: date) -> str:
    window = (
        await session.execute(
            select(ContestWindow).where(
                ContestWindow.contest_date == d, ContestWindow.slot == "royale"
            )
        )
    ).scalar_one()
    await session.refresh(window)
    return window.state


async def test_transitioner_fires_at_spring_forward_instant(db_session: AsyncSession):
    await create_windows_for_date(db_session, SPRING)
    # 04:59 UTC = 11:59 PM EST the prior evening → not yet open (midnight ET = 05:00 UTC in EST)
    await run_transitions(db_session, datetime(2025, 3, 9, 4, 59, tzinfo=UTC))
    assert await _royale_state(db_session, SPRING) == SCHEDULED
    # 05:00 UTC = 12:00 AM EST → opens
    await run_transitions(db_session, datetime(2025, 3, 9, 5, 0, tzinfo=UTC))
    assert await _royale_state(db_session, SPRING) == OPEN


async def test_transitioner_fires_at_fall_back_instant(db_session: AsyncSession):
    await create_windows_for_date(db_session, FALL)
    # 03:59 UTC = 11:59 PM EDT the prior evening → not yet open (midnight ET = 04:00 UTC in EDT)
    await run_transitions(db_session, datetime(2025, 11, 2, 3, 59, tzinfo=UTC))
    assert await _royale_state(db_session, FALL) == SCHEDULED
    # 04:00 UTC = 12:00 AM EDT → opens
    await run_transitions(db_session, datetime(2025, 11, 2, 4, 0, tzinfo=UTC))
    assert await _royale_state(db_session, FALL) == OPEN


async def test_ensure_upcoming_windows_creates_today_and_tomorrow(db_session: AsyncSession):
    # now = noon ET on the spring-forward day
    await ensure_upcoming_windows(db_session, datetime(2025, 3, 9, 16, 0, tzinfo=UTC))
    dates = set((await db_session.execute(select(ContestWindow.contest_date))).scalars().all())
    assert SPRING in dates
    assert date(2025, 3, 10) in dates
