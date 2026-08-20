"""Web Push (M9): subscriptions + the exactly-once 'window open' notifier (mocked transport).

The notifier commits internally (it's cron/daemon orchestration), so its tests run against a
dedicated engine with committed fixtures + cleanup — like the other concurrency tests. The pure
subscribe/unsubscribe paths don't commit, so they use the rolled-back db_session.
"""

from __future__ import annotations

import contextlib
import uuid
from datetime import UTC, datetime, timedelta

from app.core.config import settings
from app.models import ContestWindow, PushSubscription, User, WindowNotification
from app.models.contest import OPEN
from app.services.push import PushExpired, notify_open_windows, subscribe_web, unsubscribe
from httpx import AsyncClient
from sqlalchemy import delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

USER_ID = uuid.UUID("00000000-0000-0000-0000-0000000009a1")
WINDOW_ID = uuid.UUID("00000000-0000-0000-0000-0000000009a2")
AAA = "https://push.example/aaa"
BBB = "https://push.example/bbb"


@contextlib.asynccontextmanager
async def _push_world(*, state: str = OPEN):
    """Committed fixtures (1 user, 1 window in `state`, 2 subscriptions) on a dedicated engine."""
    engine = create_async_engine(settings.test_database_url)
    now = datetime.now(UTC)
    try:
        async with engine.begin() as c:
            # self-heal a prior crashed run, then provision.
            await c.execute(delete(ContestWindow).where(ContestWindow.id == WINDOW_ID))
            await c.execute(delete(PushSubscription).where(PushSubscription.user_id == USER_ID))
            await c.execute(delete(User).where(User.id == USER_ID))
            await c.execute(insert(User).values(id=USER_ID, email="push@x.com", password_hash="x"))
            await c.execute(
                insert(ContestWindow).values(
                    id=WINDOW_ID,
                    contest_date=now.date(),
                    slot="morning",
                    open_at=now - timedelta(hours=1),
                    close_at=now + timedelta(hours=1),
                    state=state,
                    template_id="m2_trivia_7",
                )
            )
            for ep in (AAA, BBB):
                await c.execute(
                    insert(PushSubscription).values(
                        id=uuid.uuid4(), user_id=USER_ID, endpoint=ep, p256dh="k", auth="a"
                    )
                )
        yield engine
    finally:
        async with engine.begin() as c:
            await c.execute(delete(ContestWindow).where(ContestWindow.id == WINDOW_ID))  # cascades
            await c.execute(delete(User).where(User.id == USER_ID))  # cascades subscriptions
        await engine.dispose()


def _recorder():
    calls: list[tuple[str, dict]] = []

    async def send(sub: dict, payload: dict) -> None:
        calls.append((sub["endpoint"], payload))

    return calls, send


# --- pure subscribe/unsubscribe (rolled-back db_session) ---
async def test_subscribe_is_idempotent(db_session: AsyncSession):
    uid = uuid.uuid4()
    await db_session.execute(insert(User).values(id=uid, email="s@x.com", password_hash="x"))
    await subscribe_web(db_session, uid, "https://push/x", "p", "a")
    await subscribe_web(db_session, uid, "https://push/x", "p", "a")  # double-subscribe → one row
    count = (
        await db_session.execute(
            select(func.count())
            .select_from(PushSubscription)
            .where(PushSubscription.endpoint == "https://push/x")
        )
    ).scalar_one()
    assert count == 1


async def test_unsubscribe_removes_row(db_session: AsyncSession):
    uid = uuid.uuid4()
    await db_session.execute(insert(User).values(id=uid, email="u@x.com", password_hash="x"))
    await subscribe_web(db_session, uid, "https://push/y", "p", "a")
    await unsubscribe(db_session, uid, endpoint="https://push/y")
    count = (
        await db_session.execute(
            select(func.count())
            .select_from(PushSubscription)
            .where(PushSubscription.endpoint == "https://push/y")
        )
    ).scalar_one()
    assert count == 0


# --- notifier (committed, dedicated engine, mocked transport) ---
async def test_notify_fires_exactly_once_across_ticks():
    async with _push_world() as engine:
        calls, send = _recorder()
        # two cron ticks, each its own transaction
        async with AsyncSession(engine) as s1:
            await notify_open_windows(s1, send)
        async with AsyncSession(engine) as s2:
            await notify_open_windows(s2, send)

        mine = sorted(ep for ep, _ in calls if ep in {AAA, BBB})
        assert mine == [AAA, BBB]  # each subscriber notified exactly once (not twice)
        async with engine.connect() as c:
            rows = (
                await c.execute(
                    select(func.count())
                    .select_from(WindowNotification)
                    .where(WindowNotification.window_id == WINDOW_ID)
                )
            ).scalar_one()
        assert rows == 1  # one gate row for the window


async def test_notify_skips_non_open_windows():
    async with _push_world(state="SCHEDULED") as engine:
        calls, send = _recorder()
        async with AsyncSession(engine) as s:
            await notify_open_windows(s, send)
        assert [ep for ep, _ in calls if ep in {AAA, BBB}] == []  # SCHEDULED window → no push


async def test_notify_prunes_expired_subscription():
    async with _push_world() as engine:

        async def send(sub: dict, payload: dict) -> None:
            if sub["endpoint"] == AAA:
                raise PushExpired()  # 410/404 from the push service

        async with AsyncSession(engine) as s:
            await notify_open_windows(s, send)
        async with engine.connect() as c:
            remaining = (
                (
                    await c.execute(
                        select(PushSubscription.endpoint).order_by(PushSubscription.endpoint)
                    )
                )
                .scalars()
                .all()
            )
        assert AAA not in remaining  # expired endpoint pruned
        assert BBB in remaining  # healthy endpoint kept


async def test_notify_keeps_transient_failures():
    async with _push_world() as engine:

        async def send(sub: dict, payload: dict) -> None:
            if sub["endpoint"] == AAA:
                raise RuntimeError("temporary push-service hiccup")

        async with AsyncSession(engine) as s:
            await notify_open_windows(s, send)
        async with engine.connect() as c:
            remaining = (await c.execute(select(PushSubscription.endpoint))).scalars().all()
        assert AAA in remaining  # transient failure must NOT prune
        assert BBB in remaining


# --- API smoke (rolled-back db_session via the client override) ---
async def test_push_endpoints_subscribe_and_unsubscribe(
    client: AsyncClient, db_session: AsyncSession
):
    r = await client.post(
        "/auth/register",
        json={"email": "push-api@x.com", "username": "pushapi", "password": "super-secret-pw"},
    )
    token = r.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}

    pk = await client.get("/push/public-key", headers=auth)
    assert pk.status_code == 200
    assert "public_key" in pk.json()

    sub = await client.post(
        "/push/subscribe",
        headers=auth,
        json={"endpoint": "https://push/api", "keys": {"p256dh": "p", "auth": "a"}},
    )
    assert sub.status_code == 200, sub.text
    n = (
        await db_session.execute(
            select(func.count())
            .select_from(PushSubscription)
            .where(PushSubscription.endpoint == "https://push/api")
        )
    ).scalar_one()
    assert n == 1

    unsub = await client.post(
        "/push/unsubscribe", headers=auth, json={"endpoint": "https://push/api"}
    )
    assert unsub.status_code == 200, unsub.text
    n2 = (
        await db_session.execute(
            select(func.count())
            .select_from(PushSubscription)
            .where(PushSubscription.endpoint == "https://push/api")
        )
    ).scalar_one()
    assert n2 == 0
