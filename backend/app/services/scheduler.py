"""Window scheduling + state transitions (docs/architecture.md).

All window times are computed in America/New_York via app.core.timezone (DST-correct) and stored
UTC. `transition_windows` is also invoked lazily on read (GET /contests/current, enter) so the app
is self-correcting without requiring a running daemon in M2.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import PROVISIONED_SLOTS, window_bounds_utc
from app.models import ContestWindow, Entry
from app.models.contest import CLOSED, OPEN, SCHEDULED
from app.services.templates import SLOT_TEMPLATES

# Legacy slots no longer provisioned (Daily Royale provisions only `royale`). Kept here so the
# data-tidy of dead future windows targets exactly these and nothing else.
LEGACY_SLOTS: tuple[str, ...] = ("morning", "midday", "night")


async def create_windows_for_date(session: AsyncSession, contest_date: date) -> list[ContestWindow]:
    """Create the day's Daily Royale window for a date; return the ones actually created.

    Provisions only PROVISIONED_SLOTS (currently the single `royale` slot) — exactly one window per
    ET date going forward. The legacy morning/midday/night slots are no longer created (they remain
    in WINDOW_SLOTS only so old data/history/tests still compute via window_bounds_utc).

    Concurrency-safe and idempotent: each slot is an INSERT … ON CONFLICT (contest_date, slot) DO
    NOTHING, so a slot already created by a racing writer (another web request, or the cron) is
    skipped at the database level rather than raising. This is what lets GET /contests/current
    provision windows lazily under concurrent first-of-day traffic without 500ing the loser.

    Note: ON CONFLICT DO NOTHING absorbs a concurrent conflict cleanly only at READ COMMITTED (the
    app's default isolation); under REPEATABLE READ/SERIALIZABLE a concurrent conflict raises a
    serialization error instead. Don't raise the engine's isolation level without revisiting this.
    """
    created: list[ContestWindow] = []
    for slot in PROVISIONED_SLOTS:
        open_at, close_at = window_bounds_utc(contest_date, slot)
        stmt = (
            pg_insert(ContestWindow)
            .values(
                id=uuid.uuid4(),
                contest_date=contest_date,
                slot=slot,
                open_at=open_at,
                close_at=close_at,
                state=SCHEDULED,
                template_id=SLOT_TEMPLATES[slot],
            )
            .on_conflict_do_nothing(index_elements=["contest_date", "slot"])
            .returning(ContestWindow)
        )
        window = (await session.scalars(stmt)).one_or_none()  # None when the slot already existed
        if window is not None:
            created.append(window)
    await session.flush()
    return created


def delete_dead_future_legacy_windows_stmt():  # type: ignore[no-untyped-def]
    """SQLAlchemy core DELETE that removes ONLY dead future legacy windows. The safety predicate —
    tested in tests/test_daily_royale.py and reused by the data-tidy Alembic migration — deletes a
    window only if ALL hold:

      - state = SCHEDULED                    (never CLOSED/SETTLED — history/in-flight stay)
      - slot in (morning|midday|night)       (never the live `royale` slot)
      - open_at > now()                      (future only — never a past/today legacy window)
      - the window has NO entries            (never destroy a window a player entered)

    Idempotent: a re-run matches nothing. Returns the statement so the migration (frozen schema) and
    the test (ORM) can both execute it.
    """
    from sqlalchemy import delete

    entered_window_ids = (
        select(Entry.window_id).where(Entry.window_id.is_not(None)).scalar_subquery()
    )
    return delete(ContestWindow).where(
        ContestWindow.state == SCHEDULED,
        ContestWindow.slot.in_(LEGACY_SLOTS),
        ContestWindow.open_at > func.now(),
        ContestWindow.id.not_in(entered_window_ids),
    )


def delete_stale_royale_windows_stmt():  # type: ignore[no-untyped-def]
    """SQLAlchemy core DELETE that removes ONLY stale, unentered, not-yet-finished `royale` windows
    whose stored `template_id` is no longer the current one.

    A window stores its `template_id` AND its open/close bounds at PROVISION time, and an entry's
    round-set resolves from that STORED `template_id` (services.contest), so a window provisioned
    before a definition change keeps serving the OLD format. create_windows_for_date is idempotent
    (ON CONFLICT DO NOTHING), so it will NOT overwrite the existing row — the stale window must be
    deleted for the scheduler (cron + the lazy provision on GET /contests/current) to recreate it
    with the current definition.

    For `royale` the current template (dr_8_trivia — 8 questions) only exists AFTER the 24-hour
    window switch, so a non-current `template_id` is a reliable proxy for BOTH the old question
    count AND the old 12-hour bounds: recreating the window fixes both at once.

    SAFETY PREDICATE (deletes a window only if ALL hold):
      - slot = 'royale'                            (only the live ranked slot)
      - state in (SCHEDULED, OPEN)                 (never CLOSED/SETTLED — history/in-flight stay)
      - template_id != current royale template     (only stale, non-current rows)
      - the window has NO entries                  (never destroy a window a player entered)

    Idempotent: a re-run matches nothing (recreated rows carry the current template_id). Deleting
    an OPEN zero-entry window is safe — it has no entries/standings to lose, and the next read
    recreates + re-opens it. Returns the statement so the migration (frozen schema) and the test
    (ORM) can both execute it.
    """
    from sqlalchemy import delete

    entered_window_ids = (
        select(Entry.window_id).where(Entry.window_id.is_not(None)).scalar_subquery()
    )
    return delete(ContestWindow).where(
        ContestWindow.slot == "royale",
        ContestWindow.state.in_([SCHEDULED, OPEN]),
        ContestWindow.template_id != SLOT_TEMPLATES["royale"],
        ContestWindow.id.not_in(entered_window_ids),
    )


async def transition_windows(session: AsyncSession, now: datetime | None = None) -> None:
    """Flip SCHEDULED→OPEN and (SCHEDULED|OPEN)→CLOSED by time. SETTLED is handled in M4."""
    now = now or datetime.now(UTC)

    # Close first so a window that blew past close in one tick goes straight to CLOSED.
    await session.execute(
        update(ContestWindow)
        .where(ContestWindow.state.in_([SCHEDULED, OPEN]), ContestWindow.close_at <= now)
        .values(state=CLOSED)
    )
    await session.execute(
        update(ContestWindow)
        .where(
            ContestWindow.state == SCHEDULED,
            ContestWindow.open_at <= now,
            ContestWindow.close_at > now,
        )
        .values(state=OPEN)
    )
    await session.flush()
