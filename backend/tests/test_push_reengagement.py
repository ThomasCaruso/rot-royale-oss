"""Native push subscription + the re-engagement notifiers (daily reminder, streak-saved) + the
platform-routing dispatcher. Transport is mocked; the notifiers commit internally, so those tests
use a dedicated committed engine with explicit cleanup (like test_push.py)."""

from __future__ import annotations

import contextlib
import uuid
from datetime import UTC, date, datetime

from app.core.config import settings
from app.core.timezone import ET, window_bounds_utc
from app.models import (
    ContestWindow,
    Entry,
    Profile,
    PushSubscription,
    User,
    UserNotification,
)
from app.models.contest import OPEN, SUBMITTED
from app.services.push import (
    build_sender,
    notify_daily_reminder,
    notify_streak_saved,
    subscribe_native,
)
from sqlalchemy import delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

DAY = date(2026, 6, 15)  # a Monday
# 8:30 PM ET: past the 8 PM reminder-hour gate AND before the 9 PM governor quiet cutoff, so evening
# sends stay valid once notifiers route through the frequency governor.
EVENING_UTC = datetime(2026, 6, 15, 20, 30, tzinfo=ET).astimezone(UTC)
NIGHT_UTC = datetime(2026, 6, 15, 2, 0, tzinfo=ET).astimezone(UTC)  # 2 AM ET — quiet hours
MIDDAY_UTC = datetime(2026, 6, 15, 14, 0, tzinfo=ET).astimezone(UTC)  # 2 PM ET — allowed, non-quiet
MORNING_UTC = datetime(2026, 6, 15, 10, 0, tzinfo=ET).astimezone(UTC)  # 10 AM ET (before reminder)


# ---------------- native subscribe (rolled-back db_session) ----------------
async def test_subscribe_native_is_idempotent_and_rebinds(db_session: AsyncSession):
    a = uuid.uuid4()
    b = uuid.uuid4()
    await db_session.execute(insert(User).values(id=a, email="na@x.com", password_hash="x"))
    await db_session.execute(insert(User).values(id=b, email="nb@x.com", password_hash="x"))
    await subscribe_native(db_session, a, "tok-123", "ios")
    await subscribe_native(db_session, a, "tok-123", "ios")  # same token → still one row
    rows = (
        await db_session.execute(
            select(func.count())
            .select_from(PushSubscription)
            .where(PushSubscription.device_token == "tok-123")
        )
    ).scalar_one()
    assert rows == 1
    # A different user registering the same token rebinds it (device changed hands).
    await subscribe_native(db_session, b, "tok-123", "ios")
    owner = (
        await db_session.execute(
            select(PushSubscription.user_id).where(PushSubscription.device_token == "tok-123")
        )
    ).scalar_one()
    assert owner == b


# ---------------- committed fixture world ----------------
@contextlib.asynccontextmanager
async def _world(*, streak: int, grace_date: date | None = None, played: bool = False):
    """One user+profile+native subscription, and today's OPEN royale window, committed."""
    engine = create_async_engine(settings.test_database_url)
    uid = uuid.uuid4()
    wid = uuid.uuid4()
    open_at, close_at = window_bounds_utc(DAY, "royale")
    try:
        async with engine.begin() as c:
            await c.execute(
                insert(User).values(id=uid, email=f"{uid.hex}@x.com", password_hash="x")
            )
            await c.execute(
                insert(Profile).values(
                    user_id=uid,
                    username=f"u{uid.hex[:10]}",
                    division="Bronze",
                    streak_count=streak,
                    streak_grace_used_date=grace_date,
                )
            )
            await c.execute(
                insert(PushSubscription).values(
                    id=uuid.uuid4(), user_id=uid, platform="ios", device_token=f"tok-{uid.hex}"
                )
            )
            await c.execute(
                insert(ContestWindow).values(
                    id=wid,
                    contest_date=DAY,
                    slot="royale",
                    open_at=open_at,
                    close_at=close_at,
                    state=OPEN,
                    template_id="dr_8_trivia",
                )
            )
            if played:
                await c.execute(
                    insert(Entry).values(
                        id=uuid.uuid4(),
                        window_id=wid,
                        user_id=uid,
                        seed=1,
                        round_set=[],
                        started_at=datetime.now(UTC),
                        submitted_at=datetime.now(UTC),
                        total_score=100,
                        status=SUBMITTED,
                    )
                )
        yield engine, uid
    finally:
        async with engine.begin() as c:
            await c.execute(delete(ContestWindow).where(ContestWindow.id == wid))
            await c.execute(delete(User).where(User.id == uid))  # cascades profile/sub/notifs
        await engine.dispose()


def _recorder():
    calls: list[tuple[str, dict]] = []

    async def send(sub: dict, payload: dict) -> None:
        calls.append((sub["device_token"], payload))

    return calls, send


# ---------------- daily reminder ----------------
async def test_daily_reminder_fires_streak_aware_and_exactly_once():
    async with _world(streak=4) as (engine, uid):
        calls, send = _recorder()
        async with AsyncSession(engine) as s:
            await notify_daily_reminder(s, send, now=EVENING_UTC)
        assert len(calls) == 1
        assert "4-day streak" in calls[0][1]["body"]  # streak-aware copy
        # second heartbeat the same evening → no duplicate (user_notifications gate)
        async with AsyncSession(engine) as s:
            await notify_daily_reminder(s, send, now=EVENING_UTC)
        assert len(calls) == 1
        async with engine.connect() as c:
            n = (
                await c.execute(
                    select(func.count())
                    .select_from(UserNotification)
                    .where(
                        UserNotification.user_id == uid, UserNotification.kind == "daily_reminder"
                    )
                )
            ).scalar_one()
        assert n == 1


async def test_daily_reminder_skips_players():
    async with _world(streak=3, played=True) as (engine, _uid):
        calls, send = _recorder()
        async with AsyncSession(engine) as s:
            await notify_daily_reminder(s, send, now=EVENING_UTC)
        assert calls == []  # already played today → no nudge


async def test_daily_reminder_holds_until_evening():
    async with _world(streak=3) as (engine, _uid):
        calls, send = _recorder()
        async with AsyncSession(engine) as s:
            await notify_daily_reminder(s, send, now=MORNING_UTC)  # 10 AM ET < reminder hour
        assert calls == []


async def test_streak_saved_deferred_out_of_the_night_by_governor():
    # streak_saved has no evening gate of its own (it fires at the 12:15 AM settle), so the
    # governor's quiet-hours retimes it out of the night: blocked at 2 AM, delivered in daytime.
    async with _world(streak=6, grace_date=DAY) as (engine, _uid):
        calls, send = _recorder()
        async with AsyncSession(engine) as s:
            await notify_streak_saved(s, send, now=NIGHT_UTC)  # 2 AM ET → governor blocks, no claim
        assert calls == []
        async with AsyncSession(engine) as s:
            await notify_streak_saved(s, send, now=MIDDAY_UTC)  # daytime → sends once
        assert len(calls) == 1


async def test_daily_reminder_suppressed_when_automated_cap_reached():
    # If an automated push (streak_saved) already went out today, the 1-automated/day cap suppresses
    # the evening reminder — the governor's cross-kind daily budget in action.
    async with _world(streak=4) as (engine, uid):
        calls, send = _recorder()
        async with engine.begin() as c:
            await c.execute(
                insert(UserNotification).values(user_id=uid, notify_date=DAY, kind="streak_saved")
            )
        async with AsyncSession(engine) as s:
            await notify_daily_reminder(s, send, now=EVENING_UTC)
        assert calls == []


async def test_daily_reminder_no_streak_uses_rot_check_drop_copy():
    async with _world(streak=0) as (engine, _uid):
        calls, send = _recorder()
        async with AsyncSession(engine) as s:
            await notify_daily_reminder(s, send, now=EVENING_UTC)  # 8:30 PM ET (allowed window)
        assert len(calls) == 1
        body = calls[0][1]["body"].lower()
        assert "brainrot" in body  # anticipatory drop framing, not a streak nag


# ---------------- streak saved ----------------
async def test_streak_saved_fires_once_when_grace_used():
    async with _world(streak=6, grace_date=DAY) as (engine, uid):
        calls, send = _recorder()
        async with AsyncSession(engine) as s:
            await notify_streak_saved(s, send, now=EVENING_UTC)
        assert len(calls) == 1
        assert "6-day streak survived" in calls[0][1]["body"]
        async with AsyncSession(engine) as s:
            await notify_streak_saved(s, send, now=EVENING_UTC)  # exactly-once
        assert len(calls) == 1


# ---------------- dispatcher routing ----------------
async def test_dispatcher_routes_by_platform(monkeypatch):
    import app.services.push as push_mod

    web_hits: list[str] = []
    apns_hits: list[str] = []
    fcm_hits: list[str] = []

    async def fake_web(sub, payload):
        web_hits.append(sub["endpoint"])

    async def fake_apns(sub, payload):
        apns_hits.append(sub["device_token"])

    async def fake_fcm(sub, payload):
        fcm_hits.append(sub["device_token"])

    monkeypatch.setattr(push_mod, "_build_web_sender", lambda s: fake_web)
    monkeypatch.setattr(push_mod, "_build_apns_sender", lambda s: fake_apns)
    monkeypatch.setattr(push_mod, "_build_fcm_sender", lambda s: fake_fcm)

    class FakeSettings:
        push_enabled = True
        apns_enabled = True
        fcm_enabled = True

    send = build_sender(FakeSettings())
    assert send is not None
    await send({"platform": "web", "endpoint": "ep1"}, {"title": "t", "body": "b"})
    await send({"platform": "ios", "device_token": "dt1"}, {"title": "t", "body": "b"})
    await send({"platform": "android", "device_token": "dt2"}, {"title": "t", "body": "b"})
    assert web_hits == ["ep1"]
    assert apns_hits == ["dt1"]
    # Android used to fall through to the skip branch and deliver nothing at all.
    assert fcm_hits == ["dt2"]


async def test_dispatcher_skips_platforms_with_no_configured_transport(monkeypatch):
    """An unconfigured transport is a config gap, not a dead device — skip, never prune."""
    import app.services.push as push_mod

    apns_hits: list[str] = []

    async def fake_apns(sub, payload):
        apns_hits.append(sub["device_token"])

    monkeypatch.setattr(push_mod, "_build_apns_sender", lambda s: fake_apns)

    class FakeSettings:
        push_enabled = False
        apns_enabled = True
        fcm_enabled = False  # e.g. Android shipped before the Firebase keys were set

    send = build_sender(FakeSettings())
    assert send is not None
    await send({"platform": "android", "device_token": "dt9"}, {"title": "t", "body": "b"})
    await send({"platform": "ios", "device_token": "dt1"}, {"title": "t", "body": "b"})
    assert apns_hits == ["dt1"]  # the android row was skipped without raising
