"""Daily Royale format (Phase 1): one 8-trivia ranked run per ET date.

Covers the template shape, that build_round_set produces 8 rounds from a trivia bank without error
(graceful dedup fallback even on a thin bank), and that scoring an all-correct 8-round submission
yields a positive total consistent with the canonical formula — with no round-count assumptions.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import app.modules  # noqa: F401 - register modules so build_round_set/scoring can look them up
from app.core.constants import SETTLE_DELAY_MINUTES
from app.core.timezone import window_bounds_utc
from app.models import ContestWindow, Entry, User
from app.models.contest import OPEN, SCHEDULED, SETTLED, SUBMITTED
from app.modules.base import GenerationContext
from app.services.engine import build_round_set
from app.services.scheduler import (
    delete_dead_future_legacy_windows_stmt,
    delete_stale_royale_windows_stmt,
)
from app.services.scoring import compute_points, score_entry
from app.services.templates import DAILY_ROYALE
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _trivia_bank(n: int) -> list[dict]:
    """An in-memory trivia bank in the fetch_bank shape (mixed-category, difficulty present)."""
    return [
        {
            "id": f"q{i}",
            "category": "Cat",
            "icon": "❓",
            "difficulty": "medium",
            "payload": {"prompt": f"P{i}?", "options": ["a", "b", "c", "d"], "correctIndex": 0},
        }
        for i in range(n)
    ]


def test_daily_royale_is_8_trivia():
    assert DAILY_ROYALE.id == "dr_8_trivia"
    assert len(DAILY_ROYALE.rounds) == 8
    assert all(s.type == "trivia" for s in DAILY_ROYALE.rounds)
    # difficulty=None → ranked draws across all difficulties.
    assert all(s.difficulty is None for s in DAILY_ROYALE.rounds)


def test_build_round_set_yields_8_rounds_from_a_rich_bank():
    ctx = GenerationContext(bank=_trivia_bank(40), seed=2026)
    rounds = build_round_set(123, DAILY_ROYALE, ctx)
    assert len(rounds) == 8
    assert all(r.module_type == "trivia" for r in rounds)
    # Anti-cheat split holds for every round.
    for r in rounds:
        assert "correctIndex" not in r.client_spec
        assert "correctIndex" in r.server_answer


def test_build_round_set_succeeds_on_a_thin_bank():
    # A thin bank can't supply 8 unique draws; the engine's _MAX_REROLLS fallback accepts a
    # duplicate rather than erroring. Assert it still builds exactly 8 rounds with no exception
    # (NOT 8 unique) — the Daily Royale must never crash on a small dev/test bank.
    ctx = GenerationContext(bank=_trivia_bank(3), seed=7)
    rounds = build_round_set(99, DAILY_ROYALE, ctx)
    assert len(rounds) == 8
    assert all(r.module_type == "trivia" for r in rounds)


def test_scoring_an_all_correct_8_round_entry_is_positive_and_formula_consistent():
    ctx = GenerationContext(bank=_trivia_bank(40), seed=2026)
    rounds = build_round_set(123, DAILY_ROYALE, ctx)

    # Build the (idx, module_type, server_answer) list the scorer takes, plus an all-correct
    # submission picking each round's stored correctIndex. elapsed_ms=0 → time_frac=1 (max speed).
    answers = [(r.idx, r.module_type, r.server_answer) for r in rounds]
    submissions = {
        r.idx: {"choice": r.server_answer["correctIndex"], "elapsed_ms": 0} for r in rounds
    }

    scored, total = score_entry(answers, submissions)

    assert len(scored) == 8
    assert all(s.correct and s.valid for s in scored)
    assert total > 0

    # Formula consistency (no round-count assumption baked into the constant): streak increments
    # each correct round, capped at 5; time_frac=1.0 for all. Recompute the same way the service
    # does and compare.
    expected = 0
    streak = 0
    for _ in range(8):
        streak += 1
        expected += compute_points(True, 1.0, streak)
    assert total == expected
    # First correct = streak 1 → ×1.12 of (100 + 60) = 179; later rounds cap at ×1.6.
    assert scored[0].points == compute_points(True, 1.0, 1)


# ---------------- settle_at exposed = close_at + 15min (Phase 2) ----------------
def test_settle_at_is_close_plus_15min_edt_and_est():
    # EDT: close midnight ET = 2025-07-11 04:00 UTC → settle 04:15 UTC.
    _, edt_close = window_bounds_utc(date(2025, 7, 10), "royale")
    assert edt_close == datetime(2025, 7, 11, 4, 0, tzinfo=UTC)
    assert edt_close + timedelta(minutes=SETTLE_DELAY_MINUTES) == datetime(
        2025, 7, 11, 4, 15, tzinfo=UTC
    )
    # EST: close midnight ET = 2025-11-06 05:00 UTC → settle 05:15 UTC.
    _, est_close = window_bounds_utc(date(2025, 11, 5), "royale")
    assert est_close == datetime(2025, 11, 6, 5, 0, tzinfo=UTC)
    assert est_close + timedelta(minutes=SETTLE_DELAY_MINUTES) == datetime(
        2025, 11, 6, 5, 15, tzinfo=UTC
    )


async def test_current_endpoint_exposes_settle_at(client, db_session: AsyncSession):
    # /contests/current is unauthenticated; it lazily provisions today's royale window. Every
    # WindowOut must carry settle_at == close_at + SETTLE_DELAY_MINUTES.
    resp = await client.get("/contests/current")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["schedule"], "expected at least today's royale window in the schedule"
    for w in body["schedule"]:
        close = datetime.fromisoformat(w["close_at"])
        settle = datetime.fromisoformat(w["settle_at"])
        assert settle == close + timedelta(minutes=SETTLE_DELAY_MINUTES)


# ---------------- data-tidy safety predicate (Phase 2) ----------------
async def _profile_user(db_session: AsyncSession) -> User:
    from app.models import Profile

    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        Profile(
            user_id=user.id,
            username=f"u{uuid.uuid4().hex[:10]}",
            division="Bronze",
            rating=1000,
        )
    )
    await db_session.flush()
    return user


async def test_data_tidy_removes_only_dead_future_legacy_windows(db_session: AsyncSession):
    now = datetime.now(UTC)
    future = now + timedelta(days=1)
    past = now - timedelta(days=1)

    # 1. future SCHEDULED zero-entry legacy 'night' → SHOULD be deleted.
    dead = ContestWindow(
        contest_date=date(2030, 1, 2),
        slot="night",
        open_at=future,
        close_at=future + timedelta(hours=8),
        state=SCHEDULED,
        template_id="m4_night",
    )
    # 2. SETTLED legacy 'night' → preserved (not SCHEDULED).
    settled = ContestWindow(
        contest_date=date(2020, 1, 1),
        slot="night",
        open_at=past,
        close_at=past + timedelta(hours=8),
        state=SETTLED,
        template_id="m4_night",
    )
    # 3. future SCHEDULED legacy 'night' that HAS an entry → preserved.
    entered = ContestWindow(
        contest_date=date(2030, 1, 3),
        slot="night",
        open_at=future,
        close_at=future + timedelta(hours=8),
        state=SCHEDULED,
        template_id="m4_night",
    )
    # 4. future SCHEDULED 'royale' → preserved (not a legacy slot).
    royale = ContestWindow(
        contest_date=date(2030, 1, 4),
        slot="royale",
        open_at=future,
        close_at=future + timedelta(hours=24),
        state=SCHEDULED,
        template_id="dr_20_trivia",
    )
    db_session.add_all([dead, settled, entered, royale])
    await db_session.flush()

    u = await _profile_user(db_session)
    db_session.add(
        Entry(
            window_id=entered.id,
            user_id=u.id,
            seed=1,
            round_set=[],
            started_at=now,
            submitted_at=now,
            total_score=100,
            status=SUBMITTED,
        )
    )
    await db_session.flush()

    await db_session.execute(delete_dead_future_legacy_windows_stmt())
    await db_session.flush()

    surviving = set((await db_session.execute(select(ContestWindow.id))).scalars().all())
    assert dead.id not in surviving  # removed
    assert settled.id in surviving  # SETTLED preserved
    assert entered.id in surviving  # has an entry → preserved
    assert royale.id in surviving  # royale slot preserved

    # Idempotent: a second pass deletes nothing more.
    await db_session.execute(delete_dead_future_legacy_windows_stmt())
    await db_session.flush()
    again = set((await db_session.execute(select(ContestWindow.id))).scalars().all())
    assert again == surviving


async def test_data_tidy_null_window_entries_do_not_block_deletion(db_session: AsyncSession):
    """Regression: practice/campaign entries carry window_id=NULL. The tidy subquery must filter
    those out (NOT IN against a set containing NULL matches nothing) — otherwise the DELETE would
    silently no-op. This pins the `window_id IS NOT NULL` guard in the predicate."""
    now = datetime.now(UTC)
    dead = ContestWindow(
        contest_date=date(2031, 2, 2),
        slot="morning",
        open_at=now + timedelta(days=1),
        close_at=now + timedelta(days=1, hours=6),
        state=SCHEDULED,
        template_id="m4_morning",
    )
    db_session.add(dead)
    await db_session.flush()

    u = await _profile_user(db_session)
    db_session.add(  # a window-less (practice/campaign) entry → window_id NULL
        Entry(
            window_id=None,
            user_id=u.id,
            is_practice=True,
            seed=2,
            round_set=[],
            started_at=now,
            submitted_at=now,
            total_score=50,
            status=SUBMITTED,
        )
    )
    await db_session.flush()

    await db_session.execute(delete_dead_future_legacy_windows_stmt())
    await db_session.flush()
    surviving = set((await db_session.execute(select(ContestWindow.id))).scalars().all())
    assert dead.id not in surviving  # NULL-window entry did NOT poison the NOT IN → still deleted


async def test_data_tidy_preserves_past_and_today_legacy_windows(db_session: AsyncSession):
    now = datetime.now(UTC)
    # A PAST SCHEDULED legacy window (open_at <= now) must NOT be deleted — predicate is future.
    past_sched = ContestWindow(
        contest_date=date(2019, 6, 1),
        slot="midday",
        open_at=now - timedelta(hours=2),
        close_at=now - timedelta(hours=1),
        state=SCHEDULED,
        template_id="m4_midday",
    )
    db_session.add(past_sched)
    await db_session.flush()

    await db_session.execute(delete_dead_future_legacy_windows_stmt())
    await db_session.flush()
    surviving = set((await db_session.execute(select(ContestWindow.id))).scalars().all())
    assert past_sched.id in surviving


async def test_data_tidy_recreates_stale_royale_windows(db_session: AsyncSession):
    """delete_stale_royale_windows_stmt removes ONLY stale, unentered, not-yet-finished `royale`
    windows (a non-current template_id, e.g. the pre-switch dr_20_trivia) so the scheduler recreates
    them with the current 8-question / 24-hour definition. Current-template, entered, and
    CLOSED/SETTLED windows are all preserved."""
    now = datetime.now(UTC)
    cur = DAILY_ROYALE.id  # current royale template (dr_8_trivia)

    # stale OPEN today, zero entries → recreated (the live-window case this migration fixes).
    stale_open = ContestWindow(
        contest_date=date(2026, 6, 13),
        slot="royale",
        open_at=now - timedelta(hours=6),
        close_at=now + timedelta(hours=6),
        state=OPEN,
        template_id="dr_20_trivia",
    )
    # stale SCHEDULED future, zero entries → recreated.
    stale_sched = ContestWindow(
        contest_date=date(2030, 5, 5),
        slot="royale",
        open_at=now + timedelta(days=1),
        close_at=now + timedelta(days=2),
        state=SCHEDULED,
        template_id="dr_20_trivia",
    )
    # current template → preserved (already correct; must not churn).
    current_open = ContestWindow(
        contest_date=date(2026, 6, 14),
        slot="royale",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=23),
        state=OPEN,
        template_id=cur,
    )
    # stale but ENTERED → preserved (never destroy a window a player entered).
    stale_entered = ContestWindow(
        contest_date=date(2026, 6, 12),
        slot="royale",
        open_at=now - timedelta(hours=7),
        close_at=now + timedelta(hours=5),
        state=OPEN,
        template_id="dr_20_trivia",
    )
    # stale but SETTLED → preserved (history/standings stay).
    stale_settled = ContestWindow(
        contest_date=date(2026, 6, 1),
        slot="royale",
        open_at=now - timedelta(days=2),
        close_at=now - timedelta(days=1),
        state=SETTLED,
        template_id="dr_20_trivia",
    )
    db_session.add_all([stale_open, stale_sched, current_open, stale_entered, stale_settled])
    await db_session.flush()

    u = await _profile_user(db_session)
    db_session.add(
        Entry(
            window_id=stale_entered.id,
            user_id=u.id,
            seed=1,
            round_set=[],
            started_at=now,
            submitted_at=now,
            total_score=100,
            status=SUBMITTED,
        )
    )
    await db_session.flush()

    await db_session.execute(delete_stale_royale_windows_stmt())
    await db_session.flush()
    surviving = set((await db_session.execute(select(ContestWindow.id))).scalars().all())

    assert stale_open.id not in surviving  # stale OPEN, zero-entry → recreated
    assert stale_sched.id not in surviving  # stale SCHEDULED future, zero-entry → recreated
    assert current_open.id in surviving  # current template → preserved
    assert stale_entered.id in surviving  # has an entry → preserved
    assert stale_settled.id in surviving  # SETTLED → preserved (history)

    # Idempotent: a second pass deletes nothing more.
    await db_session.execute(delete_stale_royale_windows_stmt())
    await db_session.flush()
    again = set((await db_session.execute(select(ContestWindow.id))).scalars().all())
    assert again == surviving
