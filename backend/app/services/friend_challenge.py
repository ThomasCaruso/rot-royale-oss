"""Directed "beat my Daily Royale score" friend challenge (async — NOT a live duel).

A player taps Challenge next to a friend who hasn't played today's Daily Royale. That sends the
friend a single push — "{challenger} challenged you! Beat their score?" — deep-linking into today's
game. The score comparison then surfaces naturally on the Friends-today board once they play. This
is deliberately distinct from a live friend duel (friend_duel.py): no accept step, no live match.

Anti-spam: at most one challenge push per RECIPIENT per ET day, via the shared user_notifications
exactly-once gate (kind='challenged'). The first friend to challenge someone that day sends the
nudge; later challenges that day are silently absorbed (they're already nudged to play). Services
flush, never commit — get_session commits at the request boundary (see app/core/db.py).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import ET
from app.models import Profile, UserNotification
from app.services.friends import are_friends
from app.services.push import Sender, notify_friend_challenge

# The user_notifications kind for a directed daily-score challenge (String(32) column).
CHALLENGE_KIND = "challenged"


class FriendChallengeError(Exception):
    """Base for friend-challenge failures."""


class UserNotFoundError(FriendChallengeError):
    """No user with that username."""


class CannotChallengeSelfError(FriendChallengeError):
    """You can't challenge yourself."""


class NotFriendsError(FriendChallengeError):
    """You can only challenge an accepted friend."""


async def challenge_friend_to_daily(
    session: AsyncSession,
    challenger_id: uuid.UUID,
    target_username: str,
    *,
    send: Sender | None,
    now: datetime | None = None,
) -> bool:
    """Nudge an accepted friend to beat your Daily Royale score today.

    Returns True if a push was dispatched (the recipient's once-per-day gate was newly claimed),
    False if it was already claimed for the recipient today (idempotent no-op). Raises
    CannotChallengeSelfError / NotFriendsError / UserNotFoundError for the invalid cases.
    """
    now = now or datetime.now(UTC)
    target = (
        await session.execute(
            select(Profile).where(Profile.username.ilike(target_username.strip()))
        )
    ).scalar_one_or_none()
    if target is None:
        raise UserNotFoundError(target_username)
    if target.user_id == challenger_id:
        raise CannotChallengeSelfError()
    if not await are_friends(session, challenger_id, target.user_id):
        raise NotFriendsError()

    # Claim the recipient's once-per-ET-day gate BEFORE sending (at-most-once). A conflict means
    # someone already challenged them today — silently absorb it, they're already nudged to play.
    today = now.astimezone(ET).date()
    claim = (
        pg_insert(UserNotification)
        .values(user_id=target.user_id, notify_date=today, kind=CHALLENGE_KIND)
        .on_conflict_do_nothing(index_elements=["user_id", "notify_date", "kind"])
        .returning(UserNotification.user_id)
    )
    if (await session.scalars(claim)).one_or_none() is None:
        return False

    challenger_name = (
        await session.scalar(select(Profile.username).where(Profile.user_id == challenger_id))
        or "A friend"
    )
    if send is not None:
        await notify_friend_challenge(
            session, send, recipient_id=target.user_id, challenger_username=challenger_name
        )
    return True
