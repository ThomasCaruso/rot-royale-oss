"""Settlement (PLAN.md §7): ranking, coins, rating, streak, standings — exactly-once."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from app.core.constants import SETTLE_DELAY_MINUTES
from app.core.timezone import window_bounds_utc
from app.models import CoinLedger, ContestWindow, Entry, Profile, Standing, User
from app.models.contest import CLOSED, SETTLED, SUBMITTED
from app.services.settlement import (
    coins_for_place,
    next_streak,
    rating_delta,
    settle_window,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


# ---------------- pure helpers ----------------
def test_ranked_placement_pays_no_coins():
    # Ranked gives rank/status only — coins come from campaign/practice, never settlement.
    for place in (1, 2, 3, 4, 5, 12):
        assert coins_for_place(place, 12) == 0


def test_rating_delta_winner_positive_loser_negative():
    assert rating_delta(1, 10) > 0
    assert rating_delta(10, 10) < 0
    assert rating_delta(1, 1) == 0  # degenerate field, no change


def test_next_streak_logic():
    d = date(2025, 7, 10)
    # Third tuple element is grace_consumed; without grace it's always False
    # (see test_streak_grace).
    assert next_streak(None, d, 0) == (1, d, False)  # first ever
    assert next_streak(d - timedelta(days=1), d, 4) == (5, d, False)  # consecutive
    assert next_streak(d - timedelta(days=3), d, 4) == (1, d, False)  # gap → reset
    assert next_streak(d, d, 6) == (6, d, False)  # already counted today → unchanged


# ---------------- DB helpers ----------------
async def _user(session: AsyncSession, name: str, *, rating: int = 1000) -> User:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(
        Profile(
            user_id=user.id, username=f"u{uuid.uuid4().hex[:10]}", division="Bronze", rating=rating
        )
    )
    await session.flush()
    return user


async def _closed_window(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    w = ContestWindow(
        contest_date=date(2025, 7, 10),
        slot="midday",
        open_at=now - timedelta(hours=6),
        close_at=now - timedelta(hours=1),
        state=CLOSED,
        template_id="m4_midday",
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


async def _balance(session: AsyncSession, user_id: uuid.UUID) -> int:
    return (
        await session.execute(
            select(func.coalesce(func.sum(CoinLedger.delta), 0)).where(
                CoinLedger.user_id == user_id
            )
        )
    ).scalar_one()


# ---------------- settle_window ----------------
async def test_settle_ranks_and_marks_settled(db_session: AsyncSession):
    w = await _closed_window(db_session)
    winner = await _user(db_session, "w")
    runner = await _user(db_session, "r")
    await _entry(db_session, w, winner, 900)
    await _entry(db_session, w, runner, 400)

    await settle_window(db_session, w.id)
    await db_session.refresh(w)
    assert w.state == SETTLED

    standings = {
        s.user_id: s
        for s in (
            await db_session.execute(select(Standing).where(Standing.window_id == w.id))
        ).scalars()
    }
    # Real entries only, so two players means places 1 and 2 exactly — nothing sits between them.
    assert standings[winner.id].place == 1
    assert standings[runner.id].place == 2
    assert standings[winner.id].field_size == 2
    # ranked is coin-free: standings record 0 and the ledger stays empty
    assert standings[winner.id].coins_awarded == 0
    assert standings[runner.id].coins_awarded == 0
    assert await _balance(db_session, winner.id) == 0
    ledger_rows = (
        await db_session.execute(select(func.count()).select_from(CoinLedger))
    ).scalar_one()
    assert ledger_rows == 0
    # the better-placed player gains more rating than the worse-placed one
    winner_delta = standings[winner.id].rating_after - standings[winner.id].rating_before
    runner_delta = standings[runner.id].rating_after - standings[runner.id].rating_before
    assert winner_delta > runner_delta


async def test_settle_is_exactly_once(db_session: AsyncSession):
    w = await _closed_window(db_session)
    u = await _user(db_session, "u")
    await _entry(db_session, w, u, 500)
    # A second entrant so the winner's rating actually moves: with real-entries-only, a field of
    # one has nothing to beat and `rating_delta` returns 0 — which would make the "applied once"
    # assertion below vacuous.
    await _entry(db_session, w, await _user(db_session, "u2"), 100)

    assert await settle_window(db_session, w.id) is True
    profile = await db_session.get(Profile, u.id)
    assert profile is not None
    rating_after_first = profile.rating
    assert rating_after_first != 1000  # rating applied once

    # second settle must be a no-op (window already SETTLED) — no double rating, no extra standing
    assert await settle_window(db_session, w.id) is False
    await db_session.refresh(profile)
    assert profile.rating == rating_after_first
    standings = (
        (await db_session.execute(select(Standing).where(Standing.window_id == w.id)))
        .scalars()
        .all()
    )
    assert len(standings) == 2  # one per real entrant, written once


async def test_settle_updates_streak_and_division(db_session: AsyncSession):
    w = await _closed_window(db_session)
    u = await _user(db_session, "u", rating=1850)  # near Apex boundary
    await _entry(db_session, w, u, 1000)

    await settle_window(db_session, w.id)
    profile = await db_session.get(Profile, u.id)
    assert profile is not None
    assert profile.streak_count == 1  # first contest → streak 1
    assert profile.last_streak_date == w.contest_date  # keyed off contest_date, not now()
    assert profile.coins_balance == await _balance(db_session, u.id)  # invariant holds


async def test_only_submitted_entries_are_settled(db_session: AsyncSession):
    w = await _closed_window(db_session)
    submitted = await _user(db_session, "s")
    abandoned = await _user(db_session, "a")
    await _entry(db_session, w, submitted, 600)
    inprog = await _entry(db_session, w, abandoned, 0)
    inprog.status = "IN_PROGRESS"
    await db_session.flush()

    await settle_window(db_session, w.id)
    rows = (
        (await db_session.execute(select(Standing.user_id).where(Standing.window_id == w.id)))
        .scalars()
        .all()
    )
    assert submitted.id in rows
    assert abandoned.id not in rows  # never completed → no standing, no streak


async def test_settle_due_windows_settles_all_closed(db_session: AsyncSession):
    from app.jobs.tasks import settle_due_windows

    now = datetime.now(UTC)
    windows = []
    for slot in ("morning", "midday"):
        w = ContestWindow(
            contest_date=date(2025, 7, 11),
            slot=slot,
            open_at=now - timedelta(hours=6),
            close_at=now - timedelta(hours=1),
            state=CLOSED,
            template_id="m4_midday",
        )
        db_session.add(w)
        await db_session.flush()
        await _entry(db_session, w, await _user(db_session, slot), 500)
        windows.append(w)

    settled = await settle_due_windows(db_session)
    assert settled == 2
    for w in windows:
        await db_session.refresh(w)
        assert w.state == SETTLED


async def test_settle_due_windows_orders_by_date_for_streaks(db_session: AsyncSession):
    from app.jobs.tasks import settle_due_windows

    u = await _user(db_session, "streaker")
    now = datetime.now(UTC)
    # insert the LATER day first: an unordered batch would settle it first and break the streak
    for d in (date(2025, 8, 2), date(2025, 8, 1)):
        w = ContestWindow(
            contest_date=d,
            slot="night",
            open_at=now - timedelta(hours=6),
            close_at=now - timedelta(hours=1),
            state=CLOSED,
            template_id="m4_night",
        )
        db_session.add(w)
        await db_session.flush()
        await _entry(db_session, w, u, 500)

    await settle_due_windows(db_session)
    profile = await db_session.get(Profile, u.id)
    assert profile is not None
    assert profile.streak_count == 2  # consecutive days Aug 1 → Aug 2, settled in date order


async def test_settle_skips_non_closed_window(db_session: AsyncSession):
    w = await _closed_window(db_session)
    w.state = "OPEN"
    await db_session.flush()
    settled = await settle_window(db_session, w.id)
    assert settled is False


# ---------------- the field is REAL ENTRIES ONLY (no synthetic padding) ----------------
async def test_field_size_is_the_real_entry_count(db_session: AsyncSession):
    """A lone player settles as 1st of 1 — not 1st of 8 against seven invented opponents."""
    w = await _closed_window(db_session)
    u = await _user(db_session, "solo")
    await _entry(db_session, w, u, 500)

    await settle_window(db_session, w.id)
    s = await db_session.get(Standing, (w.id, u.id))
    assert s is not None
    assert s.place == 1
    assert s.field_size == 1, "the field must not be padded"


async def test_solo_field_moves_no_rating(db_session: AsyncSession):
    """With nobody to beat there is no information, so the rating must not drift."""
    w = await _closed_window(db_session)
    u = await _user(db_session, "alone")
    await _entry(db_session, w, u, 500)
    before = (await db_session.get(Profile, u.id)).rating

    await settle_window(db_session, w.id)
    assert (await db_session.get(Profile, u.id)).rating == before


async def test_only_real_players_get_standings_and_profiles(db_session: AsyncSession):
    w = await _closed_window(db_session)
    u = await _user(db_session, "real")
    await _entry(db_session, w, u, 500)

    await settle_window(db_session, w.id)
    standings = (
        (await db_session.execute(select(Standing).where(Standing.window_id == w.id)))
        .scalars()
        .all()
    )
    assert [s.user_id for s in standings] == [u.id]
    assert len((await db_session.execute(select(Profile))).scalars().all()) == 1
    # Ranked pays no coins either way.
    assert (await db_session.execute(select(CoinLedger.user_id))).scalars().all() == []


async def test_settlement_writes_no_ledger_rows(db_session: AsyncSession):
    """The Phase-0 economy contract: ranked settlement NEVER creates coin movements."""
    w = await _closed_window(db_session)
    users = [await _user(db_session, f"p{i}") for i in range(3)]
    for i, u in enumerate(users):
        await _entry(db_session, w, u, 900 - i * 100)

    await settle_window(db_session, w.id)
    ledger_rows = (
        await db_session.execute(select(func.count()).select_from(CoinLedger))
    ).scalar_one()
    assert ledger_rows == 0
    for u in users:
        profile = await db_session.get(Profile, u.id)
        assert profile is not None and profile.coins_balance == 0
    standings = (
        (await db_session.execute(select(Standing).where(Standing.window_id == w.id)))
        .scalars()
        .all()
    )
    assert len(standings) == 3 and all(s.coins_awarded == 0 for s in standings)


# ---------------- 12:15 AM ET settle gate (Daily Royale Phase 2) ----------------
async def _closed_royale_window(db_session: AsyncSession, d: date) -> ContestWindow:
    """A CLOSED Daily Royale window with ET-computed open_at/close_at (midnight-to-midnight ET, a
    full 24-hour window, DST-safe)."""
    open_at, close_at = window_bounds_utc(d, "royale")
    w = ContestWindow(
        contest_date=d,
        slot="royale",
        open_at=open_at,
        close_at=close_at,
        state=CLOSED,
        template_id="dr_20_trivia",
    )
    db_session.add(w)
    await db_session.flush()
    return w


async def test_settle_gate_skips_before_815_and_settles_after(db_session: AsyncSession):
    from app.jobs.tasks import settle_due_windows

    # EDT day: close_at = midnight ET = 2025-07-11 04:00 UTC; settle_at = 04:15 UTC.
    d = date(2025, 7, 10)
    w = await _closed_royale_window(db_session, d)
    u = await _user(db_session, "royale_player")
    await _entry(db_session, w, u, 1500)

    # now = 12:05 AM ET (close_at + 5 min) — BEFORE settle_at → nothing settles, stays CLOSED.
    at_1205 = w.close_at + timedelta(minutes=5)
    assert await settle_due_windows(db_session, now=at_1205) == 0
    await db_session.refresh(w)
    assert w.state == CLOSED

    # now = 12:15 AM ET (close_at + 15 min) — settle_at reached → settles.
    at_1215 = w.close_at + timedelta(minutes=SETTLE_DELAY_MINUTES)
    assert await settle_due_windows(db_session, now=at_1215) == 1
    await db_session.refresh(w)
    assert w.state == SETTLED
    standings = (
        (await db_session.execute(select(Standing).where(Standing.window_id == w.id)))
        .scalars()
        .all()
    )
    assert len(standings) == 1  # standings written for the real entrant


async def test_settle_gate_exactly_once_across_two_passes_after_815(db_session: AsyncSession):
    from app.jobs.tasks import settle_due_windows

    d = date(2025, 7, 10)
    w = await _closed_royale_window(db_session, d)
    u = await _user(db_session, "once_only")
    await _entry(db_session, w, u, 1200)

    at_1215 = w.close_at + timedelta(minutes=SETTLE_DELAY_MINUTES)
    # First pass settles exactly one window; the second is a clean no-op (already SETTLED).
    assert await settle_due_windows(db_session, now=at_1215) == 1
    assert await settle_due_windows(db_session, now=at_1215 + timedelta(minutes=30)) == 0

    # Streak keyed off contest_date (one increment), no coin ledger rows (ranked is coin-free).
    profile = await db_session.get(Profile, u.id)
    assert profile is not None
    assert profile.streak_count == 1
    assert profile.last_streak_date == d
    ledger_rows = (
        await db_session.execute(select(func.count()).select_from(CoinLedger))
    ).scalar_one()
    assert ledger_rows == 0
    standings = (
        (await db_session.execute(select(Standing).where(Standing.window_id == w.id)))
        .scalars()
        .all()
    )
    assert len(standings) == 1  # exactly one standing — no double settle


async def test_settle_gate_dst_correct_for_est_window(db_session: AsyncSession):
    """An EST Daily Royale closes at 05:00 UTC; settle_at = 05:15 UTC. The gate uses real instants,
    so the same close_at+15min rule fires correctly on the EST side of DST."""
    from app.jobs.tasks import settle_due_windows

    d = date(2025, 11, 5)  # EST (after fall-back)
    w = await _closed_royale_window(db_session, d)
    # Sanity: close_at is 05:00 UTC (midnight EST), settle_at is 05:15 UTC.
    assert w.close_at == datetime(2025, 11, 6, 5, 0, tzinfo=UTC)
    u = await _user(db_session, "est_player")
    await _entry(db_session, w, u, 800)

    before = datetime(2025, 11, 6, 5, 5, tzinfo=UTC)  # 12:05 AM EST
    assert await settle_due_windows(db_session, now=before) == 0
    after = datetime(2025, 11, 6, 5, 15, tzinfo=UTC)  # 12:15 AM EST
    assert await settle_due_windows(db_session, now=after) == 1
    await db_session.refresh(w)
    assert w.state == SETTLED
