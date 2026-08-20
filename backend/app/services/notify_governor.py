"""Notification frequency governor — the single 'less is more' guardrail every push routes through.

Rot Royale sends a small set of notifications (docs/plans/notifications-system-design.md). To keep
them feeling valued, EVERY user-targeted send passes can_send() first:

  1. quiet hours — nothing 9 PM–8 AM in the PLAYER'S OWN zone (profiles.timezone; ET when unknown).
     This used to be ET for everyone, which quietly made an evening-local send impossible: 8 PM in
     California is 11 PM ET, so the guard blocked the very push it was meant to time. A night-time
     trigger (e.g. streak-saved at 12:15 AM) is still simply blocked and re-sent by a later morning
     heartbeat — automatic retiming, no extra job.
  2. daily caps  — ≤2 AUTOMATED and ≤2 DIRECTED (user-initiated social) pushes per user per ET day,
     with a hard ceiling of 3 total. Two automated is the deliberate ceiling for one evening: the
     daily reminder, and — only for a streak worth defending — the streak-risk nudge an hour later.
  3. spacing     — no automated push within MIN_AUTOMATED_GAP_MINUTES of the last one, so the two
     can never arrive back-to-back when a heartbeat first sees a player after both are due.

Counts are derived from the existing user_notifications rows (the per-kind exactly-once gate) via
KIND_META — no new table, no migration. can_send() is a pure read + policy check; the caller still
claims the per-kind gate when it actually sends.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import ET
from app.models import UserNotification
from app.services.localtime import local_hour

# kind -> (category, is_automated). Directed = user-initiated social (own daily budget).
KIND_META: dict[str, tuple[str, bool]] = {
    "daily_reminder": ("reminder", True),  # the daily Rot Check drop
    "streak_saved": ("reminder", True),
    "streak_risk": ("reminder", True),  # 8 PM local: a streak of 3+ is unplayed and about to lapse
    "result_recap": ("result", True),  # Phase 2
    "milestone": ("result", True),  # Phase 3
    "winback": ("reminder", True),  # Phase 3
    "challenged": ("social", False),  # friend-challenge (directed; PR #38)
    "friend_beat": ("social", False),  # Phase 2 (directed)
}

AUTOMATED_DAILY_CAP = 2
DIRECTED_DAILY_CAP = 2
TOTAL_DAILY_CAP = 3

QUIET_START_HOUR = 21  # 9 PM local — no sends at/after this hour
QUIET_END_HOUR = 8  # 8 AM local — no sends before this hour
MIN_AUTOMATED_GAP_MINUTES = 30


def _is_automated(kind: str) -> bool:
    meta = KIND_META.get(kind)
    return meta[1] if meta is not None else True  # unknown kinds: treat as automated (conservative)


def in_quiet_hours(now: datetime, tz_name: str | None = None) -> bool:
    """True during the ~9 PM–8 AM blackout in the player's own zone (ET when unknown)."""
    hour = local_hour(tz_name, now)
    return hour >= QUIET_START_HOUR or hour < QUIET_END_HOUR


async def _rows_sent_today(
    session: AsyncSession, user_id: uuid.UUID, today: date
) -> list[tuple[str, datetime | None]]:
    """(kind, sent_at) for today — the timestamp drives the spacing rule."""
    rows = (
        await session.execute(
            select(UserNotification.kind, UserNotification.created_at).where(
                UserNotification.user_id == user_id,
                UserNotification.notify_date == today,
            )
        )
    ).all()
    return [(k, ts) for k, ts in rows]


async def can_send(
    session: AsyncSession,
    user_id: uuid.UUID,
    kind: str,
    now: datetime,
    tz_name: str | None = None,
) -> bool:
    """True iff a push of `kind` to `user_id` is allowed right now.

    Quiet hours are evaluated in the player's zone; the daily gate stays on the ET day, because
    that is the day the CONTEST is scored on and the user_notifications key it shares.

    Read-only: does NOT claim anything. The caller claims the per-kind user_notifications gate when
    it actually sends.
    """
    if in_quiet_hours(now, tz_name):
        return False
    today = now.astimezone(ET).date()
    rows = await _rows_sent_today(session, user_id, today)
    if len(rows) >= TOTAL_DAILY_CAP:
        return False
    kinds = [k for k, _ in rows]
    automated = sum(1 for k in kinds if _is_automated(k))
    directed = len(kinds) - automated
    if not _is_automated(kind):
        return directed < DIRECTED_DAILY_CAP
    if automated >= AUTOMATED_DAILY_CAP:
        return False
    # Spacing: two automated pushes are allowed in a day but never in the same breath. Without this,
    # a heartbeat that first sees a player after BOTH the 7 PM reminder and the 8 PM streak nudge
    # are due would fire them back-to-back — which reads as exactly the spam this governor exists
    # to prevent.
    last = max((ts for k, ts in rows if _is_automated(k) and ts is not None), default=None)
    if last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=ET)
        if (now - last) < timedelta(minutes=MIN_AUTOMATED_GAP_MINUTES):
            return False
    return True
