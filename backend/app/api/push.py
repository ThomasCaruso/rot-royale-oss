"""Web Push endpoints (M9): expose the VAPID public key, (un)subscribe a browser."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.db import get_session
from app.models import User
from app.schemas.push import (
    NativeSubscribeRequest,
    PublicKeyResponse,
    PushAck,
    SubscribeRequest,
    UnsubscribeRequest,
)
from app.services.push import subscribe_native, subscribe_web, unsubscribe

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/public-key", response_model=PublicKeyResponse)
async def public_key(_user: User = Depends(get_current_user)) -> PublicKeyResponse:
    # Public by nature (the browser's applicationServerKey); empty string when push is disabled.
    return PublicKeyResponse(public_key=settings.vapid_public_key)


@router.post("/subscribe", response_model=PushAck)
async def subscribe_endpoint(
    body: SubscribeRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PushAck:
    await subscribe_web(session, user.id, body.endpoint, body.keys.p256dh, body.keys.auth)
    return PushAck(ok=True)


@router.post("/subscribe-native", response_model=PushAck)
async def subscribe_native_endpoint(
    body: NativeSubscribeRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PushAck:
    await subscribe_native(
        session, user.id, body.device_token, body.platform, provisional=body.provisional
    )
    return PushAck(ok=True)


@router.post("/unsubscribe", response_model=PushAck)
async def unsubscribe_endpoint(
    body: UnsubscribeRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PushAck:
    await unsubscribe(session, user.id, endpoint=body.endpoint, device_token=body.device_token)
    return PushAck(ok=True)
