"""Scheduler task bodies (PLAN.md §9). Pure-ish: take a session + optional now, no scheduling here.

These wrap the ET/DST-correct services so the daemon and tests share identical logic.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import GEM_STARTER_DAILY_ROYALE, SETTLE_DELAY_MINUTES
from app.core.timezone import ET
from app.models import ContestWindow, Entry, GemLedger
from app.models.contest import CLOSED, SUBMITTED
from app.services.challenge import purge_expired_challenges
from app.services.gem_ledger import record_gem_delta
from app.services.push import (
    build_sender,
    notify_daily_reminder,
    notify_streak_risk,
    notify_streak_saved,
)
from app.services.rot_rating_store import converge_difficulties
from app.services.scheduler import create_windows_for_date, transition_windows
from app.services.seasons import apply_season_reset
from app.services.settlement import settle_window


async def ensure_upcoming_windows(session: AsyncSession, now: datetime | None = None) -> None:
    """Create today's and tomorrow's SCHEDULED windows (idempotent). The daily cron keeps the
    next day provisioned in advance; startup calls this so windows exist immediately."""
    now = now or datetime.now(UTC)
    today = now.astimezone(ET).date()
    await create_windows_for_date(session, today)
    await create_windows_for_date(session, today + timedelta(days=1))


async def run_transitions(session: AsyncSession, now: datetime | None = None) -> None:
    await transition_windows(session, now or datetime.now(UTC))


async def converge_rot_difficulties(session: AsyncSession, now: datetime | None = None) -> bool:
    """Daily: converge the FLOATING Rot Rating difficulty pools (estimate/notice) on the just-
    completed ET day's attempts, then re-centre them to their seed means (the anchor). Trivia is
    the fixed anchor and is untouched. The batch is NOT idempotent (per-difficulty game counts
    accumulate), so `converge_difficulties` guards it EXACTLY-ONCE per ET day — this is safe to
    schedule from both the daemon cron and a redundant Render cron; the second fire is a no-op.
    Returns True iff it converged. Does not commit — the caller does.

    Targets `now_ET - 1 day`, which is always a CLOSED royale day: at 12:15 AM ET (alongside settle)
    it converges the day that just closed; an early dual-UTC cron fire on the prior ET date targets
    a day already converged, so the guard no-ops it."""
    now = now or datetime.now(UTC)
    day = (now.astimezone(ET) - timedelta(days=1)).date()  # the just-completed ET day
    return await converge_difficulties(session, day)


async def settle_due_windows(session: AsyncSession, now: datetime | None = None) -> int:
    """Settle every CLOSED window whose settle_at (= close_at + SETTLE_DELAY_MINUTES) has passed;
    returns the count settled.

    The settle_at gate keeps results from landing the instant a window closes — Daily Royale closes
    at 12:00 AM ET (midnight) and settles 15 minutes later (the "Results settling" beat). A CLOSED
    window is skipped until now >= close_at + SETTLE_DELAY_MINUTES. settle_window is exactly-once
    guarded.
    Caller commits — the settlement transaction is atomic.
    """
    now = now or datetime.now(UTC)
    settle_cutoff = now - timedelta(minutes=SETTLE_DELAY_MINUTES)
    # Settle in chronological order — streaks are day-sequential, so an unordered catch-up batch
    # spanning a day boundary would corrupt them (rating/coins are order-independent).
    window_ids = (
        (
            await session.execute(
                select(ContestWindow.id)
                .where(
                    ContestWindow.state == CLOSED,
                    ContestWindow.close_at <= settle_cutoff,  # settle_at reached
                )
                .order_by(ContestWindow.contest_date, ContestWindow.open_at)
            )
        )
        .scalars()
        .all()
    )
    settled = 0
    for wid in window_ids:
        if await settle_window(session, wid):
            settled += 1
    return settled


async def backfill_starter_gems(session: AsyncSession) -> int:
    """Grant the one-time +5 starter Gem (key starter:{user_id}) to every user with >=1 completed
    Daily Royale who hasn't received it yet. Idempotent: re-running grants 0. Does NOT commit.

    Phase 2A made settlement grant this on a player's first settled Daily Royale; this retroactively
    grants it to players who finished Daily Royales before Gems launched. The idempotency key is the
    real guard — computing the to-grant set just yields an accurate count and skips no-op work.
    """
    eligible = set(
        (
            await session.execute(
                select(Entry.user_id)
                .join(ContestWindow, Entry.window_id == ContestWindow.id)
                .where(Entry.status == SUBMITTED, ContestWindow.slot == "royale")
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    already = set(
        (
            await session.execute(
                select(GemLedger.user_id).where(GemLedger.reason == "starter_daily_royale")
            )
        )
        .scalars()
        .all()
    )
    to_grant = eligible - already
    for user_id in to_grant:
        await record_gem_delta(
            session,
            user_id,
            GEM_STARTER_DAILY_ROYALE,
            "starter_daily_royale",
            idempotency_key=f"starter:{user_id}",
        )
    return len(to_grant)


async def run_season_reset(session: AsyncSession) -> int:
    """Close + soft-reset the just-ended season exactly once (claim + batch in one transaction).
    Run on the heartbeat; a no-op (cheap claim check) except right after an ET month rollover."""
    result = await apply_season_reset(session)
    await session.commit()
    return result.reset if result.applied else 0


async def send_reengagement_pushes(session: AsyncSession) -> int:
    """The re-engagement heartbeat: the evening daily-reminder nudge + the streak-saved ping. Both
    are exactly-once (user_notifications gate) and no-op when push isn't configured. Run on the
    heartbeat cron/daemon alongside transitions; each notifier commits itself."""
    send = build_sender(settings)
    if send is None:
        return 0
    total = await notify_daily_reminder(session, send)
    # Ordered after the reminder on purpose: within one heartbeat the reminder claims its slot
    # first, and the governor's spacing rule then defers this one to a later tick rather than
    # firing both in the same breath.
    total += await notify_streak_risk(session, send)
    total += await notify_streak_saved(session, send)
    return total


async def purge_expired_share_links(session: AsyncSession) -> int:
    """Delete share snapshots whose Daily Royale has closed. Data minimisation, run on the
    heartbeat: `get_challenge` already refuses to serve them, this removes the stored copy."""
    removed = await purge_expired_challenges(session)
    if removed:
        await session.commit()
    return removed
