"""Friends endpoints (the social layer, now in scope).

Friend a player by username, accept/decline incoming requests, list the graph, and remove a friend.
Detail strings are machine-readable CODES the frontend switches on (repo convention).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_session
from app.models import User
from app.schemas.social import (
    FriendOut,
    FriendRequestCreate,
    FriendRequestOut,
    FriendRequestResult,
    FriendRespondRequest,
    FriendsResponse,
)
from app.services.friends import (
    AlreadyFriendsError,
    CannotFriendSelfError,
    FriendRequestNotFoundError,
    RequestExistsError,
    UserNotFoundError,
    cancel_or_remove,
    list_friends,
    respond_friend_request,
    send_friend_request,
)

router = APIRouter(prefix="/friends", tags=["friends"])


@router.get("", response_model=FriendsResponse)
async def get_friends(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FriendsResponse:
    """The full friend surface: accepted friends + incoming/outgoing pending requests."""
    data = await list_friends(session, user.id)
    return FriendsResponse(
        friends=[
            FriendOut(
                user_id=f.user_id,
                username=f.username,
                avatar_preset=f.avatar_preset,
                wins=f.wins,
                losses=f.losses,
                streak=f.streak,
                last_result=f.last_result,
                last_played=f.last_played,
                duels_14d=f.duels_14d,
                equipped_frame=f.equipped_frame,
                equipped_title=f.equipped_title,
            )
            for f in data.friends
        ],
        incoming=[FriendRequestOut(**vars(r)) for r in data.incoming],
        outgoing=[FriendRequestOut(**vars(r)) for r in data.outgoing],
        rival_user_id=data.rival_user_id,
    )


@router.post("/requests", response_model=FriendRequestResult)
async def create_request(
    body: FriendRequestCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FriendRequestResult:
    """Send a friend request by username (auto-accepts if they already invited you)."""
    try:
        friendship = await send_friend_request(session, user.id, body.username)
    except UserNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user_not_found") from exc
    except CannotFriendSelfError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot_friend_self") from exc
    except AlreadyFriendsError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "already_friends") from exc
    except RequestExistsError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "request_exists") from exc
    return FriendRequestResult(request_id=friendship.id, status=friendship.status)


@router.post("/requests/{request_id}/respond", response_model=FriendRequestResult)
async def respond_request(
    request_id: uuid.UUID,
    body: FriendRespondRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FriendRequestResult:
    """Accept or decline an incoming pending request."""
    try:
        friendship = await respond_friend_request(session, user.id, request_id, body.accept)
    except FriendRequestNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "request_not_found") from exc
    return FriendRequestResult(request_id=friendship.id, status=friendship.status)


@router.delete("/{other_user_id}")
async def remove_friend(
    other_user_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, bool]:
    """Remove a friend, cancel an outgoing request, or decline an incoming one (any edge)."""
    removed = await cancel_or_remove(session, user.id, other_user_id)
    return {"ok": removed}
