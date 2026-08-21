"""Push schemas — web-push (M9) + native iOS/Android device tokens."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, field_validator


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeRequest(BaseModel):
    """Web-push subscription (browser / installed PWA)."""

    endpoint: str
    keys: PushKeys

    @field_validator("endpoint")
    @classmethod
    def _endpoint_is_not_an_ssrf_primitive(cls, v: str) -> str:
        """The server POSTs to this URL from inside its own network, so it cannot be arbitrary.

        Rejected here rather than at send time: an invalid endpoint should never be stored, and a
        subscriber gets a clear 422 instead of a notification that silently never arrives.
        """
        from app.core.pushurl import InvalidPushEndpoint, validate_push_endpoint

        try:
            return validate_push_endpoint(v)
        except InvalidPushEndpoint as exc:
            raise ValueError(str(exc)) from exc


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
