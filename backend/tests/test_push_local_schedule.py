"""Evening pushes fire in the PLAYER'S local evening, and at most twice.

The old scheduler used one ET hour for everybody, which is right for the contest and wrong for a
reminder. These tests pin the two rules that make the new behaviour safe: the right hour in the
right zone, and never two pushes in the same breath.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.core.timezone import ET
from app.models import ContestWindow, Entry, Profile, PushSubscription, UserNotification
from app.models.contest import OPEN, SUBMITTED
from app.services.localtime import is_valid_zone, local_hour, resolve_zone
from app.services.notify_governor import can_send, in_quiet_hours
from app.services.push import notify_daily_reminder, notify_streak_risk
from sqlalchemy.ext.asyncio import AsyncSession

DENVER = "America/Denver"
LONDON = "Europe/London"


def _sender(sent: list[tuple[dict, dict]]):
    async def send(sub, payload):
        sent.append((sub, payload))

    return send


async def _player(
    session: AsyncSession, *, tz: str | None, streak: int, subscribed: bool = True
) -> uuid.UUID:
    from app.services.registration import register_guest

    user = await register_guest(session)
    profile = await session.get(Profile, user.id)
    assert profile is not None
    profile.timezone = tz
    profile.streak_count = streak
    if subscribed:
        session.add(
            PushSubscription(
                user_id=user.id, platform="ios", device_token="tok-" + uuid.uuid4().hex
            )
        )
    await session.flush()
    return user.id


async def _open_window(session: AsyncSession, now: datetime) -> ContestWindow:
    w = ContestWindow(
        contest_date=now.astimezone(ET).date(),
        slot="royale",
        open_at=now - timedelta(hours=2),
        close_at=now + timedelta(hours=2),
        state=OPEN,
        template_id="dr_8_trivia",
    )
    session.add(w)
    await session.flush()
    return w


# ---------------- local time ----------------


def test_an_unknown_zone_falls_back_to_et_rather_than_raising():
    # A device can report anything. Falling back is never worse than not sending at all.
    assert resolve_zone("Mars/Olympus") is ET
    assert resolve_zone(None) is ET
    assert resolve_zone("") is ET


def test_valid_zones_are_accepted_and_junk_is_not():
    assert is_valid_zone(DENVER)
    assert not is_valid_zone("Mars/Olympus")
    assert not is_valid_zone("x" * 65)


def test_local_hour_differs_by_zone_for_the_same_instant():
    # 02:00 UTC — the exact case the old ET-only gate got wrong.
    now = datetime(2026, 8, 15, 2, 0, tzinfo=UTC)
    assert local_hour(DENVER, now) == 20  # 8 PM in Denver
    assert local_hour(None, now) == 22  # 10 PM ET


# ---------------- quiet hours ----------------


def test_quiet_hours_follow_the_player_not_the_contest():
    """8 PM in Denver is 10 PM ET. Under the old ET-only rule this was silently blocked — which
    would have made the whole 8 PM local streak nudge impossible."""
    now = datetime(2026, 8, 15, 2, 0, tzinfo=UTC)
    assert in_quiet_hours(now) is True  # 10 PM ET
    assert in_quiet_hours(now, DENVER) is False  # 8 PM local — fine


# ---------------- daily reminder ----------------


@pytest.mark.parametrize(
    "hour_utc,should_send",
    [
        (17, False),  # 11:00 Denver — before the reminder hour
        (20, True),  # 14:00 Denver — 2 PM local, the reminder hour itself
        (1, True),  # 19:00 Denver — the hour is a FLOOR, so a late tick still delivers
    ],
)
async def test_reminder_fires_at_2pm_in_the_players_own_zone(
    client, db_session: AsyncSession, hour_utc: int, should_send: bool
):
    now = datetime(2026, 8, 15, hour_utc, 5, tzinfo=UTC)
    await _open_window(db_session, now)
    await _player(db_session, tz=DENVER, streak=0)
    sent: list = []

    await notify_daily_reminder(db_session, _sender(sent), now)

    assert bool(sent) is should_send


async def test_reminder_skips_a_player_who_already_played(client, db_session: AsyncSession):
    now = datetime(2026, 8, 15, 20, 5, tzinfo=UTC)  # 2 PM Denver
    window = await _open_window(db_session, now)
    user_id = await _player(db_session, tz=DENVER, streak=0)
    db_session.add(
        Entry(
            window_id=window.id,
            user_id=user_id,
            seed=1,
            round_set=[],
            started_at=now,
            submitted_at=now,
            status=SUBMITTED,
        )
    )
    await db_session.flush()
    sent: list = []

    await notify_daily_reminder(db_session, _sender(sent), now)

    assert sent == []


# ---------------- streak risk ----------------


async def test_streak_risk_fires_at_8pm_local_for_a_streak_of_three(
    client, db_session: AsyncSession
):
    now = datetime(2026, 8, 15, 2, 5, tzinfo=UTC)  # 8 PM Denver
    await _open_window(db_session, now)
    await _player(db_session, tz=DENVER, streak=3)
    sent: list = []

    await notify_streak_risk(db_session, _sender(sent), now)

    assert len(sent) == 1
    assert "streak at risk" in sent[0][1]["title"]


async def test_a_short_streak_is_left_alone(client, db_session: AsyncSession):
    """Below the floor there is nothing to mourn, and the urgency would be manufactured."""
    now = datetime(2026, 8, 15, 2, 5, tzinfo=UTC)
    await _open_window(db_session, now)
    await _player(db_session, tz=DENVER, streak=2)
    sent: list = []

    await notify_streak_risk(db_session, _sender(sent), now)

    assert sent == []


async def test_streak_risk_holds_until_the_local_hour(client, db_session: AsyncSession):
    now = datetime(
        2026, 8, 15, 1, 5, tzinfo=UTC
    )  # 7 PM Denver — past the reminder hour, not the streak hour
    await _open_window(db_session, now)
    await _player(db_session, tz=DENVER, streak=5)
    sent: list = []

    await notify_streak_risk(db_session, _sender(sent), now)

    assert sent == []


async def test_the_two_evening_pushes_never_arrive_together(client, db_session: AsyncSession):
    """A heartbeat that first sees a player after BOTH are due must not fire both at once — the
    spacing rule defers the second to a later tick."""
    now = datetime(2026, 8, 15, 2, 5, tzinfo=UTC)  # 8 PM Denver: both are due
    await _open_window(db_session, now)
    await _player(db_session, tz=DENVER, streak=4)

    reminder: list = []
    await notify_daily_reminder(db_session, _sender(reminder), now)
    risk: list = []
    await notify_streak_risk(db_session, _sender(risk), now)

    assert len(reminder) == 1
    assert risk == []  # held back by the 30-minute spacing rule

    # Half an hour later the second one is allowed through.
    later = now + timedelta(minutes=31)
    risk_later: list = []
    await notify_streak_risk(db_session, _sender(risk_later), later)
    assert len(risk_later) == 1


async def test_neither_push_repeats_within_the_day(client, db_session: AsyncSession):
    now = datetime(2026, 8, 15, 2, 5, tzinfo=UTC)
    await _open_window(db_session, now)
    await _player(db_session, tz=DENVER, streak=4)

    first: list = []
    await notify_daily_reminder(db_session, _sender(first), now)
    second: list = []
    await notify_daily_reminder(db_session, _sender(second), now + timedelta(minutes=40))

    assert len(first) == 1
    assert second == []


async def test_the_cap_allows_exactly_two_automated_pushes(client, db_session: AsyncSession):
    now = datetime(2026, 8, 15, 2, 5, tzinfo=UTC)
    user_id = await _player(db_session, tz=DENVER, streak=4)
    today = now.astimezone(ET).date()
    for kind in ("daily_reminder", "streak_risk"):
        db_session.add(UserNotification(user_id=user_id, notify_date=today, kind=kind))
    await db_session.flush()

    # Two automated already out: a third must not be allowed, whatever it is.
    assert await can_send(db_session, user_id, "winback", now + timedelta(hours=1), DENVER) is False
