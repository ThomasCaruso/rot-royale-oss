"""Push schemas — web-push (M9) + native iOS/Android device tokens."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeRequest(BaseModel):
    """Web-push subscription (browser / installed PWA)."""

    endpoint: str
    keys: PushKeys


class NativeSubscribeRequest(BaseModel):
    """Native app subscription — an APNs (iOS) or FCM (android) device token."""

    device_token: str
    platform: Literal["ios", "android"]
    # True when the token came from iOS PROVISIONAL authorization (no prompt, quiet delivery). It
    # makes the device reachable but is not consent, so it does not retire the in-app ask.
    provisional: bool = False


class UnsubscribeRequest(BaseModel):
    # Web rows unsubscribe by endpoint; native rows by device_token. Exactly one is set.
    endpoint: str | None = None
    device_token: str | None = None


class PublicKeyResponse(BaseModel):
    public_key: str  # VAPID applicationServerKey (base64url); empty when push is disabled


class PushAck(BaseModel):
    ok: bool
