"""Shared API dependencies."""

from __future__ import annotations

import uuid

import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings
from app.core.db import get_session
from app.core.security import decode_token
from app.models import User

_bearer = HTTPBearer(auto_error=False)

_UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    if creds is None:
        raise _UNAUTHENTICATED
    try:
        claims = decode_token(creds.credentials)
    except jwt.PyJWTError as exc:
        raise _UNAUTHENTICATED from exc
    if claims.get("type") != "access":
        raise _UNAUTHENTICATED
    try:
        user_id = uuid.UUID(claims["sub"])
    except (KeyError, ValueError) as exc:
        raise _UNAUTHENTICATED from exc
    user = await session.get(User, user_id)
    if user is None:
        raise _UNAUTHENTICATED
    return user


_FORBIDDEN = HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")


def _admin_user_ids(settings_override: Settings | None = None) -> set[uuid.UUID]:
    """Env-driven admin allowlist (ADMIN_USER_IDS, comma-separated UUIDs). Empty = no admins.

    A malformed entry is skipped rather than raised: one typo must not take the API down, and
    skipping can only ever NARROW access.
    """
    cfg = settings_override or settings
    out: set[uuid.UUID] = set()
    for raw in cfg.admin_user_ids.split(","):
        raw = raw.strip()
        if not raw:
            continue
        try:
            out.add(uuid.UUID(raw))
        except ValueError:
            continue
    return out


async def get_admin_user(user: User = Depends(get_current_user)) -> User:
    """The current user, but only if their USER ID is on the admin allowlist.

    Keyed on id rather than email because email is an unverified claim here (no verification flow,
    open registration) — an allowlisted address that nobody had registered was claimable by anyone.

    Takes NO settings parameter on purpose. FastAPI reads a dependency's signature to build the
    request contract, so a non-HTTP argument here becomes part of the API: an earlier version
    carried a `settings_override` test seam, and once its annotation resolved to a real Pydantic
    model FastAPI began demanding it as a REQUEST BODY, 422-ing every admin call. Unit tests reach
    the allowlist through `_admin_user_ids(...)` or by patching `settings` — never through the
    dependency's own signature.
    """
    if user.id not in _admin_user_ids():
        raise _FORBIDDEN
    return user


async def get_optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> User | None:
    """The current user when a valid access token is present, else None (never a 401).

    For endpoints that serve BOTH anonymous visitors and signed-in players — currently the funnel
    analytics beacon, whose top-of-funnel events fire before any account exists. Do not use for
    anything gameplay- or profile-authoritative.
    """
    if creds is None:
        return None
    try:
        claims = decode_token(creds.credentials)
        if claims.get("type") != "access":
            return None
        user_id = uuid.UUID(claims["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
    return await session.get(User, user_id)


# --- Content language -------------------------------------------------------------------------
# The player's chosen UI language, sent by the client on every request as `X-Locale` (the app's own
# setting — NOT the browser's Accept-Language, which is a different preference and frequently
# disagrees with what the player picked in-app). Anything unrecognised degrades to English rather
# than erroring: serving English is always a valid answer.
SUPPORTED_CONTENT_LOCALES = frozenset({"en", "es", "fr", "tr"})


def get_locale(x_locale: str | None = Header(default=None)) -> str:
    """Resolve the request's content locale, defaulting to English."""
    if not x_locale:
        return "en"
    base = x_locale.strip()[:2].lower()
    return base if base in SUPPORTED_CONTENT_LOCALES else "en"
