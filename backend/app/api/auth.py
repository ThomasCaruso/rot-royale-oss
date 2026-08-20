"""Auth router: register / login / refresh (PLAN.md §8)."""

from __future__ import annotations

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.constants import (
    GUEST_CREATE_MAX_PER_IP_PER_HOUR,
    LOGIN_MAX_PER_ACCOUNT_PER_5MIN,
    LOGIN_MAX_PER_IP_PER_5MIN,
    RATE_WINDOW_5MIN_SECONDS,
    REGISTER_MAX_PER_IP_PER_HOUR,
)
from app.core.db import get_session
from app.core.errors import ApiErrorCode
from app.core.ratelimit import check_rate_limit, client_ip
from app.core.security import create_access_token, create_refresh_token, decode_token
from app.models import User
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UpgradeRequest,
)
from app.services.auth import InvalidCredentialsError, authenticate_user, issue_tokens
from app.services.registration import (
    EmailAlreadyExistsError,
    NotAGuestError,
    UsernameAlreadyExistsError,
    register_guest,
    register_user,
    upgrade_guest,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(
    body: RegisterRequest, request: Request, session: AsyncSession = Depends(get_session)
) -> TokenResponse:
    # Register runs a full argon2 hash. Cap per IP so it can't be used to flood accounts or as a
    # CPU/memory amplification DoS (see the constants note). The anonymous fast path is /auth/guest.
    if not check_rate_limit(f"register:{client_ip(request)}", limit=REGISTER_MAX_PER_IP_PER_HOUR):
        raise ApiErrorCode("rate_limited")
    try:
        user = await register_user(session, body.email, body.username, body.password)
    except EmailAlreadyExistsError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered") from exc
    except UsernameAlreadyExistsError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken") from exc
    return issue_tokens(user)


@router.post("/guest", response_model=TokenResponse)
async def guest(request: Request, session: AsyncSession = Depends(get_session)) -> TokenResponse:
    """Anonymous-first entry: a fully-seeded guest account, no form, instant play.

    The Brain Boost onboarding calls this on "Start Check" so a brand-new player is inside the
    game in one tap; the session persists via the ordinary refresh token. Saving the profile
    later goes through /auth/upgrade — same user, all progress kept.

    Guest creation is unauthenticated + free, so it's rate-limited per client IP (the share loop
    lands anonymous visitors straight here) to blunt bulk account minting.
    """
    if not check_rate_limit(f"guest:{client_ip(request)}", limit=GUEST_CREATE_MAX_PER_IP_PER_HOUR):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many guest sessions from this device — try again later.",
        )
    user = await register_guest(session)
    return issue_tokens(user)


@router.post("/upgrade", response_model=TokenResponse)
async def upgrade(
    body: UpgradeRequest,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """Save a guest profile: attach email, username and password to the SAME account.

    Nothing is merged or migrated — it is the same user row, so the run the player just finished
    (and their streak, coins and progress) carries straight over.
    """
    # Auth-gated (needs a guest token), but it still runs an argon2 hash — cap per IP so it can't be
    # driven as an amplification vector even with a pool of guest tokens.
    if not check_rate_limit(f"upgrade:{client_ip(request)}", limit=REGISTER_MAX_PER_IP_PER_HOUR):
        raise ApiErrorCode("rate_limited")
    try:
        user = await upgrade_guest(session, user, body.email, body.password, body.username)
    except NotAGuestError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Profile already saved") from exc
    except EmailAlreadyExistsError as exc:
        raise ApiErrorCode("email_taken") from exc
    except UsernameAlreadyExistsError as exc:
        raise ApiErrorCode("username_taken") from exc
    return issue_tokens(user)


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest, request: Request, session: AsyncSession = Depends(get_session)
) -> TokenResponse:
    # Two caps, both required. Per-IP blunts a single host brute-forcing / DoS-ing (each attempt
    # costs a ~50 ms + 64 MiB argon2 verify). Per-ACCOUNT (keyed on the target email, lowercased)
    # blunts a DISTRIBUTED guess against one victim that a per-IP cap alone would miss. Short 5-min
    # window so a legitimate user who mistypes a few times isn't locked out for long. A rejected hit
    # isn't recorded, so a 429 doesn't itself extend the window.
    email_key = body.email.strip().lower()
    ip = client_ip(request)
    if not check_rate_limit(
        f"login-ip:{ip}", limit=LOGIN_MAX_PER_IP_PER_5MIN, window_seconds=RATE_WINDOW_5MIN_SECONDS
    ) or not check_rate_limit(
        f"login-acct:{email_key}",
        limit=LOGIN_MAX_PER_ACCOUNT_PER_5MIN,
        window_seconds=RATE_WINDOW_5MIN_SECONDS,
    ):
        raise ApiErrorCode("rate_limited")
    try:
        user = await authenticate_user(session, body.email, body.password)
    except InvalidCredentialsError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password") from exc
    return issue_tokens(user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest) -> TokenResponse:
    try:
        claims = decode_token(body.refresh_token)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token") from exc
    if claims.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    subject = claims.get("sub")
    if not subject:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    # Sliding session: issue a fresh access + refresh pair (stateless, no server-side revocation).
    return TokenResponse(
        access_token=create_access_token(subject),
        refresh_token=create_refresh_token(subject),
    )
