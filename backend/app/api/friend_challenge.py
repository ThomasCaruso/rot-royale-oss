"""Async "beat my Daily Royale score" friend challenge (see services/friend_challenge.py).

One endpoint: challenge a friend (by username) to today's Daily Royale. Fires a single push to the
friend and is idempotent per recipient per ET day. Distinct from the live friend-duel router.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.db import get_session
from app.models import User
from app.schemas.social import FriendChallengeCreate, FriendChallengeResult
from app.services.friend_challenge import (
    CannotChallengeSelfError,
    NotFriendsError,
    UserNotFoundError,
    challenge_friend_to_daily,
)
from app.services.push import build_sender

router = APIRouter(prefix="/friend-challenges", tags=["friend-challenges"])


@router.post("", response_model=FriendChallengeResult)
async def create(
    body: FriendChallengeCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FriendChallengeResult:
    """Challenge an accepted friend to beat your Daily Royale score today — sends them a push."""
    try:
        sent = await challenge_friend_to_daily(
            session, user.id, body.username, send=build_sender(settings)
        )
    except UserNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user_not_found") from exc
    except CannotChallengeSelfError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot_challenge_self") from exc
    except NotFriendsError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not_friends") from exc
    return FriendChallengeResult(sent=sent)
