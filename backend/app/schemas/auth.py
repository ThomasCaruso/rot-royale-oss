"""Auth request/response schemas (docs/architecture.md)."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str


class UpgradeRequest(BaseModel):
    """Guest → saved profile ("Save your Brain Profile"): email, username and password.

    `username` mirrors RegisterRequest's constraints exactly — the same handle, claimed through a
    different door, so the rules cannot drift between the two paths.

    It is OPTIONAL rather than required: omitting it keeps the auto-generated guest handle. That
    keeps older clients (and the guest flow's original contract) working, while the current UI
    always sends it, pre-filled with the handle the player has been playing under so accepting it
    costs one tap.
    """

    email: EmailStr
    username: str | None = Field(default=None, min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)


class SocialSignInRequest(BaseModel):
    """A provider ID token, for "Continue with Apple/Google".

    `provider` is validated against the registry rather than trusted, so an unknown string cannot
    reach the verifier. `nonce` is optional only because the web flow does not always set one; when
    the client DID commit to a nonce it must be echoed here, and the server enforces the match — a
    token captured from one sign-in is otherwise replayable into another.
    """

    provider: str = Field(min_length=1, max_length=32)
    id_token: str = Field(min_length=1, max_length=8192)
    nonce: str | None = Field(default=None, max_length=256)


class SocialTokenResponse(BaseModel):
    """Tokens, plus the two things the client cannot work out for itself."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    #: First sign-in for this identity — route into onboarding rather than the daily.
    created: bool = False
    #: The account had a password and it was retired by linking a verified provider identity. The
    #: client tells the player, so they are not left to discover it at a later login.
    password_retired: bool = False


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class GoogleStartResponse(BaseModel):
    """Where to send the browser to begin Sign in with Google.

    The URL is built server-side because only the server holds the pieces that must agree with the
    Google console — the redirect URI, verbatim — and because the `state` and `nonce` inside it have
    to be recorded before the browser leaves. A client that assembled this itself could not have
    either guarantee.
    """

    authorize_url: str


class GoogleHandoffRequest(BaseModel):
    """The one-time code the callback put in the SPA's URL fragment."""

    handoff_code: str
