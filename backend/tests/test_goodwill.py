"""Outage remediation: reset the runs the §5f protocol break stranded, and pay the goodwill grant.

Both operations touch every player, so both are written to be safe to run TWICE — a job that can't
be re-run is a job nobody dares run at all.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from app.models import ContestWindow, Entry, RoundAnswer
from app.models.contest import IN_PROGRESS, OPEN
from app.models.profile import Profile
from app.services.goodwill import (
    GOODWILL_COINS,
    GOODWILL_GEMS,
    STRANDED_GRACE_MINUTES,
    grant_goodwill,
    reset_stranded_entries,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def _royale_window(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    w = ContestWindow(
        contest_date=now.date(),
        slot="royale",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=OPEN,
        template_id="dr_8_trivia",
    )
    session.add(w)
    await session.flush()
    return w


async def _entry(
    session: AsyncSession,
    window: ContestWindow,
    user_id: uuid.UUID,
    *,
    retry_age_minutes: float | None,
    status: str = IN_PROGRESS,
) -> Entry:
    """An entry with one answered round; `retry_age_minutes` sets a pending offer of that age."""
    e = Entry(
        window_id=window.id,
        user_id=user_id,
        seed=1,
        round_set=[{"idx": 0, "type": "trivia", "client_spec": {}}],
        started_at=datetime.now(UTC),
        status=status,
    )
    session.add(e)
    await session.flush()
    retry = None
    if retry_age_minutes is not None:
        at = datetime.now(UTC) - timedelta(minutes=retry_age_minutes)
        retry = {"choice": 2, "at": at.isoformat()}
    session.add(
        RoundAnswer(
            entry_id=e.id,
            idx=0,
            module_type="trivia",
            server_answer={"correctIndex": 1},
            retry=retry,
        )
    )
    await session.flush()
    return e


async def _user(session: AsyncSession, n: int) -> uuid.UUID:
    from app.services.registration import register_guest

    u = await register_guest(session)
    return u.id


async def _coins(session: AsyncSession, user_id: uuid.UUID) -> int:
    p = await session.get(Profile, user_id)
    assert p is not None
    return int(p.coins_balance)


# ---------------- reset ----------------


async def test_reset_removes_only_the_wedged_runs(client, db_session: AsyncSession):
    window = await _royale_window(db_session)
    wedged = await _entry(db_session, window, await _user(db_session, 1), retry_age_minutes=90)
    healthy = await _entry(db_session, window, await _user(db_session, 2), retry_age_minutes=None)

    report = await reset_stranded_entries(db_session)

    assert report.deleted == 1
    assert await db_session.get(Entry, wedged.id) is None
    # A run with no pending offer was never wedged — it must survive untouched. Note this is the
    # CONSUMED case too: attempt 2 clears the offer with `retry = None`, which JSONB writes as JSON
    # `null`, so a completed second chance still satisfies `retry IS NOT NULL` in SQL. Deleting on
    # the SQL predicate alone would destroy the runs that worked perfectly.
    assert await db_session.get(Entry, healthy.id) is not None


async def test_reset_spares_a_retry_still_in_its_window(client, db_session: AsyncSession):
    """A player mid-second-chance RIGHT NOW has a pending offer too. Deleting their entry would
    make the remediation its own outage, so a fresh offer is inside the grace period and is left
    alone."""
    window = await _royale_window(db_session)
    live = await _entry(db_session, window, await _user(db_session, 3), retry_age_minutes=0.1)
    stale = await _entry(
        db_session, window, await _user(db_session, 4), retry_age_minutes=STRANDED_GRACE_MINUTES + 1
    )

    report = await reset_stranded_entries(db_session)

    assert report.deleted == 1
    assert await db_session.get(Entry, live.id) is not None
    assert await db_session.get(Entry, stale.id) is None


async def test_reset_lets_the_player_enter_again(client, db_session: AsyncSession):
    """The point of the reset: uq_entry_window_user no longer blocks a fresh entry."""
    window = await _royale_window(db_session)
    user_id = await _user(db_session, 5)
    await _entry(db_session, window, user_id, retry_age_minutes=90)

    await reset_stranded_entries(db_session)

    remaining = await db_session.scalar(
        select(Entry.id).where(Entry.window_id == window.id, Entry.user_id == user_id)
    )
    assert remaining is None  # the unique constraint is clear, so /enter will succeed


async def test_reset_is_a_no_op_on_a_dry_run(client, db_session: AsyncSession):
    window = await _royale_window(db_session)
    wedged = await _entry(db_session, window, await _user(db_session, 6), retry_age_minutes=90)

    report = await reset_stranded_entries(db_session, dry_run=True)

    assert report.deleted == 1  # reports what it WOULD do
    assert await db_session.get(Entry, wedged.id) is not None  # but changes nothing


# ---------------- goodwill grant ----------------


async def test_grant_pays_every_account_once(client, db_session: AsyncSession):
    a = await _user(db_session, 10)
    b = await _user(db_session, 11)

    report = await grant_goodwill(db_session, key="outage-aug14")

    assert report.granted == 2
    assert report.gems == GOODWILL_GEMS and report.coins == GOODWILL_COINS
    for uid in (a, b):
        assert await _coins(db_session, uid) >= GOODWILL_COINS


async def test_grant_run_twice_pays_nothing_extra(client, db_session: AsyncSession):
    uid = await _user(db_session, 12)

    first = await grant_goodwill(db_session, key="outage-aug14")
    after_first = await _coins(db_session, uid)
    second = await grant_goodwill(db_session, key="outage-aug14")

    assert first.granted == 1
    assert second.granted == 0  # idempotency key already recorded
    assert second.already_paid == 1
    assert await _coins(db_session, uid) == after_first


async def test_a_different_key_is_a_different_grant(client, db_session: AsyncSession):
    """The key scopes the payout, so a SECOND incident can still be paid to the same players."""
    uid = await _user(db_session, 13)

    await grant_goodwill(db_session, key="outage-aug14")
    before = await _coins(db_session, uid)
    report = await grant_goodwill(db_session, key="outage-sep01")

    assert report.granted == 1
    assert await _coins(db_session, uid) == before + GOODWILL_COINS
