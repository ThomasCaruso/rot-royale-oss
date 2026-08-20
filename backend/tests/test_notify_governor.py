"""Notification frequency governor — quiet hours + per-day caps. Uses the rolled-back db_session:
can_send() only reads user_notifications, and we seed rows directly."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from app.core.timezone import ET
from app.models import User, UserNotification
from app.services.notify_governor import can_send, in_quiet_hours
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

# 2 PM ET (a safe, non-quiet hour) and 2 AM ET (quiet).
MIDDAY = datetime(2026, 6, 15, 14, 0, tzinfo=ET).astimezone(UTC)
NIGHT = datetime(2026, 6, 15, 2, 0, tzinfo=ET).astimezone(UTC)
TODAY_ET = date(2026, 6, 15)


def test_in_quiet_hours_boundaries():
    assert in_quiet_hours(datetime(2026, 6, 15, 21, 0, tzinfo=ET).astimezone(UTC)) is True  # 9 PM
    assert (
        in_quiet_hours(datetime(2026, 6, 15, 7, 59, tzinfo=ET).astimezone(UTC)) is True
    )  # 7:59 AM
    assert in_quiet_hours(datetime(2026, 6, 15, 8, 0, tzinfo=ET).astimezone(UTC)) is False  # 8 AM
    assert (
        in_quiet_hours(datetime(2026, 6, 15, 20, 59, tzinfo=ET).astimezone(UTC)) is False
    )  # 8:59 PM


async def _seed_user(session: AsyncSession) -> uuid.UUID:
    uid = uuid.uuid4()
    await session.execute(insert(User).values(id=uid, email=f"{uid.hex}@x.com", password_hash="x"))
    return uid


async def _seed_sent(session: AsyncSession, uid: uuid.UUID, kind: str) -> None:
    await session.execute(
        insert(UserNotification).values(user_id=uid, notify_date=TODAY_ET, kind=kind)
    )


async def test_blocks_during_quiet_hours(db_session: AsyncSession):
    uid = await _seed_user(db_session)
    assert await can_send(db_session, uid, "daily_reminder", NIGHT) is False


async def test_allows_first_automated_of_day(db_session: AsyncSession):
    uid = await _seed_user(db_session)
    assert await can_send(db_session, uid, "daily_reminder", MIDDAY) is True


async def test_second_automated_blocked_by_cap(db_session: AsyncSession):
    uid = await _seed_user(db_session)
    await _seed_sent(db_session, uid, "daily_reminder")  # 1 automated already sent today
    assert await can_send(db_session, uid, "streak_saved", MIDDAY) is False


async def test_directed_allowed_alongside_automated(db_session: AsyncSession):
    uid = await _seed_user(db_session)
    await _seed_sent(db_session, uid, "daily_reminder")  # automated used
    assert (
        await can_send(db_session, uid, "challenged", MIDDAY) is True
    )  # directed has its own budget


async def test_directed_second_allowed_third_blocked(db_session: AsyncSession):
    uid = await _seed_user(db_session)
    await _seed_sent(db_session, uid, "challenged")
    # Second directed of a DIFFERENT kind is allowed (cap is 2 directed/day).
    assert await can_send(db_session, uid, "friend_beat", MIDDAY) is True
    await _seed_sent(db_session, uid, "friend_beat")
    # A hypothetical third directed would exceed DIRECTED_DAILY_CAP.
    assert await can_send(db_session, uid, "friend_beat", MIDDAY) is False


async def test_total_ceiling(db_session: AsyncSession):
    uid = await _seed_user(db_session)
    await _seed_sent(db_session, uid, "daily_reminder")  # 1 automated
    await _seed_sent(db_session, uid, "challenged")  # 1 directed
    await _seed_sent(db_session, uid, "friend_beat")  # 2 directed → 3 total
    # Nothing more today, automated or directed — the hard 3/day ceiling.
    assert await can_send(db_session, uid, "streak_saved", MIDDAY) is False
