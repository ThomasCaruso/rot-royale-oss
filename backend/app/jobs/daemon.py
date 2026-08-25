"""APScheduler daemon that drives window lifecycle on a timer (docs/architecture.md).

Two jobs:
  - transition tick (every `scheduler_tick_seconds`): SCHEDULED→OPEN→CLOSED by time.
  - daily window creation (00:30 ET cron): provision the next day's SCHEDULED windows.

Each job opens its own AsyncSession (it runs outside any request) and commits. The scheduler runs
inside the FastAPI event loop via the app lifespan; on Render it can alternatively be invoked as a
cron job calling these task bodies. Disable with scheduler_enabled=false (tests, one-off CLIs).

DST: every time computation flows through app.core.timezone (America/New_York → UTC), so the timer
opens/closes windows at the correct UTC instant on both sides of a DST change.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.timezone import ET
from app.jobs.tasks import (
    converge_rot_difficulties,
    ensure_upcoming_windows,
    purge_expired_share_links,
    run_season_reset,
    run_transitions,
    send_reengagement_pushes,
    settle_due_windows,
)
from app.services.duel import cleanup_expired_duels
from app.services.friend_duel import expire_stale_friend_duels
from app.services.google_oauth import purge_expired as purge_expired_oauth_transactions

log = logging.getLogger("rotroyale.scheduler")


async def _settle_due_and_commit() -> None:
    """Run the gated settle (CLOSED→SETTLED once now >= settle_at) and commit. Shared by the 60s
    tick and the targeted 8:15-ET job so both take the identical exactly-once, never-commit-
    partially path — the cron is belt-and-suspenders so settlement lands right at 8:15 even if the
    tick cadence were relaxed."""
    async with SessionLocal() as session:
        await settle_due_windows(session, now=datetime.now(UTC))
        await session.commit()


async def _converge_rot_and_commit() -> None:
    """Daily Rot Rating difficulty convergence (§5e), alongside the settle cron. Guarded exactly-
    once per ET day inside converge_difficulties (the batch is NOT idempotent), so this is safe to
    fire from the cron even if a redundant Render cron also runs it — the second is a no-op."""
    async with SessionLocal() as session:
        await converge_rot_difficulties(session, now=datetime.now(UTC))
        await session.commit()


async def _tick() -> None:
    async with SessionLocal() as session:
        await run_transitions(session)  # SCHEDULED→OPEN→CLOSED by time
        # CLOSED→SETTLED once settle_at (close_at + 15min) is reached; exactly-once guarded.
        await settle_due_windows(session, now=datetime.now(UTC))
        # Expired (unfinished past their expiry) duels are abandoned/forfeited on the tick.
        await cleanup_expired_duels(session, now=datetime.now(UTC))
        # Friend challenges never accepted, or accepted-but-unfinished live duels, expire too.
        await expire_stale_friend_duels(session, now=datetime.now(UTC))
        # Share snapshots stop RESOLVING the moment their window closes, but the rows survived
        # forever because this purge was written and never scheduled — leaving a username, score
        # and placement stored indefinitely for a link that can no longer do its job. The expiry
        # is a privacy promise (services/challenge.get_challenge), so it has to delete, not just
        # 404. Cheap: a bounded DELETE that is a no-op once caught up.
        await purge_expired_share_links(session)
        # In-flight Google sign-in handshakes. Pure handshake state with a ten-minute life, so
        # anything older than a day is unusable by definition — but rows nothing deletes still
        # accumulate forever, which is the exact shape of the share-link bug immediately above.
        # Wired in run.py too: Render runs the cron entrypoint, not this daemon.
        await purge_expired_oauth_transactions(session)
        await session.commit()
        # Monthly ladder soft-reset — exactly-once per season; a cheap no-op the rest of the month.
        await run_season_reset(session)
        # Evening daily-reminder + streak-saved nudges (exactly-once per user/day); commit inside.
        # (The old midnight 'window open' broadcast was retired — the daily Rot Check reminder,
        # targeted + evening-timed, replaces it. See docs/plans/notifications-system-design.md.)
        await send_reengagement_pushes(session)


async def _create_windows() -> None:
    async with SessionLocal() as session:
        await ensure_upcoming_windows(session)
        await session.commit()


def build_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(
        _tick,
        IntervalTrigger(seconds=settings.scheduler_tick_seconds),
        id="window_transitions",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        _create_windows,
        CronTrigger(hour=0, minute=30, timezone=ET),
        id="daily_window_creation",
    )
    # Targeted settle at 12:15 AM ET — the Daily Royale closed at 12:00 AM (midnight), so this lands
    # results right at the "Results settling" beat. Scheduled in the ET zone (app.core.timezone.ET)
    # to fire the DST-correct UTC instant on both sides of a DST change. Belt + suspenders with the
    # 60s tick (which also settles once settle_at is reached); the gate makes a double-fire a no-op.
    scheduler.add_job(
        _settle_due_and_commit,
        CronTrigger(hour=0, minute=15, timezone=ET),
        id="royale_settle",
        max_instances=1,
        coalesce=True,
    )
    # Rot Rating difficulty convergence at 12:15 AM ET — right after the day closed, alongside
    # settle. Converges the just-closed ET day's floating pools; guarded exactly-once per ET day
    # (the batch is NOT idempotent), so a redundant fire is a safe no-op.
    scheduler.add_job(
        _converge_rot_and_commit,
        CronTrigger(hour=0, minute=15, timezone=ET),
        id="rot_difficulty_converge",
        max_instances=1,
        coalesce=True,
    )
    return scheduler


async def start_scheduler() -> AsyncIOScheduler:
    """Provision today/tomorrow immediately, then start the timer."""
    await _create_windows()
    scheduler = build_scheduler()
    scheduler.start()
    log.info("scheduler started (tick=%ss)", settings.scheduler_tick_seconds)
    return scheduler
