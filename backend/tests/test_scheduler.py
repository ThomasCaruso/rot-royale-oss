"""Window scheduler + state transitioner (docs/architecture.md). ET/DST correctness is critical."""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime

from app.core.config import settings
from app.core.timezone import window_bounds_utc
from app.models import ContestWindow
from app.models.contest import CLOSED, OPEN, SCHEDULED
from app.services.scheduler import create_windows_for_date, transition_windows
from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine


# --- ET/DST window boundaries (pure) ---
def test_window_bounds_est_winter():
    # Jan 15 2025 is EST (UTC-5). Morning opens 05:00 ET = 10:00 UTC.
    open_at, close_at = window_bounds_utc(date(2025, 1, 15), "morning")
    assert open_at == datetime(2025, 1, 15, 10, 0, tzinfo=UTC)
    assert close_at == datetime(2025, 1, 15, 16, 0, tzinfo=UTC)  # 11:00 ET


def test_window_bounds_edt_summer():
    # Jul 1 2025 is EDT (UTC-4). Morning opens 05:00 ET = 09:00 UTC.
    open_at, close_at = window_bounds_utc(date(2025, 7, 1), "morning")
    assert open_at == datetime(2025, 7, 1, 9, 0, tzinfo=UTC)
    assert close_at == datetime(2025, 7, 1, 15, 0, tzinfo=UTC)


def test_night_window_closes_next_day_and_tracks_dst():
    # Night closes 00:00 ET the NEXT day. EST: +5h → 05:00 UTC; EDT: +4h → 04:00 UTC.
    # Legacy slot: window_bounds_utc must STILL compute these instants (preserved parsing).
    _, close_winter = window_bounds_utc(date(2025, 1, 15), "night")
    assert close_winter == datetime(2025, 1, 16, 5, 0, tzinfo=UTC)
    _, close_summer = window_bounds_utc(date(2025, 7, 1), "night")
    assert close_summer == datetime(2025, 7, 2, 4, 0, tzinfo=UTC)


def test_royale_window_bounds_track_dst():
    # Daily Royale: opens 12:00 AM ET (midnight), closes 12:00 AM ET next day — a 24-hour window.
    # EDT (UTC-4): midnight ET = 04:00 UTC; next midnight ET = 04:00 UTC next day.
    open_edt, close_edt = window_bounds_utc(date(2025, 7, 1), "royale")
    assert open_edt == datetime(2025, 7, 1, 4, 0, tzinfo=UTC)
    assert close_edt == datetime(2025, 7, 2, 4, 0, tzinfo=UTC)
    # EST (UTC-5): midnight ET = 05:00 UTC; next midnight ET = 05:00 UTC next day.
    open_est, close_est = window_bounds_utc(date(2025, 1, 15), "royale")
    assert open_est == datetime(2025, 1, 15, 5, 0, tzinfo=UTC)
    assert close_est == datetime(2025, 1, 16, 5, 0, tzinfo=UTC)


# --- scheduler (DB) ---
async def test_create_windows_creates_one_royale_slot(db_session: AsyncSession):
    created = await create_windows_for_date(db_session, date(2025, 7, 1))
    assert {w.slot for w in created} == {"royale"}  # one Daily Royale window per ET date
    assert all(w.state == SCHEDULED for w in created)
    assert all(w.template_id for w in created)
    # Opens midnight ET / closes midnight ET next day (EDT instants — a full 24-hour window).
    (w,) = created
    assert w.open_at == datetime(2025, 7, 1, 4, 0, tzinfo=UTC)
    assert w.close_at == datetime(2025, 7, 2, 4, 0, tzinfo=UTC)


async def test_create_windows_is_idempotent(db_session: AsyncSession):
    await create_windows_for_date(db_session, date(2025, 7, 1))
    await create_windows_for_date(db_session, date(2025, 7, 1))  # second call must not duplicate
    rows = (
        (
            await db_session.execute(
                select(ContestWindow).where(ContestWindow.contest_date == date(2025, 7, 1))
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1  # exactly one royale window/date


async def test_create_windows_no_ops_under_concurrent_create():
    """TOCTOU race at the DB's real isolation level (READ COMMITTED, as in prod): another writer
    grabs the slot for the date in the gap between this caller's check and its INSERT. The INSERT
    would collide on uq_window_date_slot. create_windows_for_date must absorb that (ON CONFLICT DO
    NOTHING) — raising here would 500 a GET /contests/current at the daily ET rollover under real
    concurrent traffic.

    Reproduced deterministically via lock-blocking: connection B holds an UNCOMMITTED 'royale'
    insert (taking the unique-index lock); caller A blocks on it, then B commits, so A unblocks to
    find the slot already taken — the classic check-then-insert race, no internal hooks. With one
    provisioned slot per date, A finds nothing left to create.
    """
    d = date(2025, 9, 9)  # a date no other test touches
    a_engine = create_async_engine(settings.test_database_url)
    b_engine = create_async_engine(settings.test_database_url)
    a_conn = a_trans = a_session = b_conn = None
    try:
        # Self-heal: a hard-killed prior run could have left a committed row for `d`, which would
        # wedge B's seed insert below. Clear it first so the test is rerunnable.
        async with b_engine.begin() as pre:
            await pre.execute(delete(ContestWindow).where(ContestWindow.contest_date == d))

        r_open, r_close = window_bounds_utc(d, "royale")
        # B: hold an uncommitted 'royale' insert so the unique-index slot is locked.
        b_conn = await b_engine.connect()
        b_trans = await b_conn.begin()
        await b_conn.execute(
            insert(ContestWindow).values(
                contest_date=d,
                slot="royale",
                open_at=r_open,
                close_at=r_close,
                state=SCHEDULED,
                template_id="x",
            )
        )

        # A: a normal READ COMMITTED caller creating windows; its 'royale' INSERT blocks on B.
        a_conn = await a_engine.connect()
        a_trans = await a_conn.begin()
        a_session = AsyncSession(bind=a_conn, expire_on_commit=False)
        task = asyncio.create_task(create_windows_for_date(a_session, d))
        await asyncio.sleep(0.3)  # let A reach + block on the 'royale' INSERT
        await b_trans.commit()  # B wins the slot; A unblocks straight into the conflict
        created = await task  # must NOT raise

        await a_session.flush()
        assert {w.slot for w in created} == set()  # conflicting sole slot skipped cleanly
    finally:
        if a_session is not None:
            await a_session.close()
        if a_trans is not None:
            await a_trans.rollback()
        if a_conn is not None:
            await a_conn.close()
        if b_conn is not None:
            await b_conn.close()
        # B committed its row on a separate connection (outside the harness rollback) — remove it.
        async with b_engine.begin() as cleanup:
            await cleanup.execute(delete(ContestWindow).where(ContestWindow.contest_date == d))
        await a_engine.dispose()
        await b_engine.dispose()


# --- transitioner (DB, injected now) ---
async def test_transition_opens_and_closes_by_time(db_session: AsyncSession):
    d = date(2025, 7, 1)  # EDT: royale opens 04:00 UTC, closes 04:00 UTC next day (24-hour window).
    await create_windows_for_date(db_session, d)

    async def state_of(slot: str) -> str:
        w = (
            await db_session.execute(
                select(ContestWindow).where(
                    ContestWindow.contest_date == d, ContestWindow.slot == slot
                )
            )
        ).scalar_one()
        await db_session.refresh(w)
        return w.state

    # Before open (03:00 UTC = 11:00 PM ET the prior day) → SCHEDULED.
    await transition_windows(db_session, now=datetime(2025, 7, 1, 3, 0, tzinfo=UTC))
    assert await state_of("royale") == SCHEDULED

    # 04:00 UTC = 12:00 AM ET (midnight) → royale OPEN.
    await transition_windows(db_session, now=datetime(2025, 7, 1, 4, 0, tzinfo=UTC))
    assert await state_of("royale") == OPEN

    # 04:00 UTC next day = 12:00 AM ET next day → royale CLOSED.
    await transition_windows(db_session, now=datetime(2025, 7, 2, 4, 0, tzinfo=UTC))
    assert await state_of("royale") == CLOSED
