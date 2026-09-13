"""Auth router: register / login / refresh (docs/architecture.md)."""

from __future__ import annotations

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_optional_user
from app.core.config import settings
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
from app.core.socialid import InvalidSocialToken, verify_id_token
from app.models import User
from app.models.identity import PROVIDER_APPLE, SOCIAL_PROVIDERS
from app.schemas.auth import (
    GoogleHandoffRequest,
    GoogleStartRequest,
    GoogleStartResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    SocialSignInRequest,
    SocialTokenResponse,
    TokenResponse,
    UpgradeRequest,
)
from app.services.auth import InvalidCredentialsError, authenticate_user, issue_tokens
from app.services.google_oauth import (
    PLATFORM_WEB,
    GoogleOAuthError,
    complete_callback,
    google_configured,
    redeem_handoff,
    return_url,
    start_transaction,
)
from app.services.registration import (
    EmailAlreadyExistsError,
    NotAGuestError,
    UsernameAlreadyExistsError,
    register_guest,
    register_user,
    upgrade_guest,
)
from app.services.social_auth import sign_in_with_identity

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


@router.get("/providers")
async def social_providers() -> dict[str, object]:
    """Which provider buttons to render, and what the browser needs to start the flow.

    Derived from configured audiences, never a separate flag. A button for a provider the server
    cannot verify is a guaranteed dead end, and the player would blame the app rather than the
    missing config. An unconfigured deployment shows none and the email form carries the screen.

    `google_client_id` is served rather than baked into the bundle at build time. It is public by
    nature — it travels in every OAuth flow and is visible in the page source — so this is not a
    secret being exposed. It is served because it means ONE source of truth (the environment
    variable) instead of two that can disagree, and rotating it takes an env change rather than a
    frontend rebuild and redeploy. Only the FIRST audience is offered: the extra entries exist so
    tokens minted for the iOS and Android clients also verify, but a browser can only start a flow
    with the web one.
    """
    google_ids = settings.google_client_id_list
    apple_ids = settings.apple_client_id_list
    return {
        "providers": settings.social_sign_in_providers,
        "google_client_id": google_ids[0] if google_ids else None,
        # Apple's WEB audience is a Services identifier, distinct from the native bundle id. Both
        # are valid audiences for the same product, which is why the setting is a list; the browser
        # is handed the first, which is the one a web flow can actually start with.
        "apple_client_id": apple_ids[0] if apple_ids else None,
        # The ONE origin Apple will accept a return to.
        #
        # Apple matches the Return URL exactly against what is registered on the Service ID, and
        # this app is reachable on more than one origin: the custom domain, and the platform's
        # default *.onrender.com hostname. On the second, a sign-in would open the popup and then
        # fail with a generic `invalid_request` the player cannot act on. Publishing the canonical
        # origin lets the client show the button only where it can actually succeed, instead of
        # hardcoding a domain into the bundle.
        "apple_redirect_uri": settings.web_base_url if apple_ids else None,
    }


@router.post("/social", response_model=SocialTokenResponse)
async def social_sign_in(
    body: SocialSignInRequest,
    request: Request,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> SocialTokenResponse:
    """Sign in (or up) with a verified Apple/Google identity.

    Auth is OPTIONAL on purpose. An anonymous visitor is signing in; a GUEST is upgrading, and
    passing their token means the identity attaches to the row they have been playing on, so the
    streak, coins and rating they already earned carry over instead of being stranded on an account
    they can no longer reach.

    Rate-limited per IP like the other account-creating routes: this one can mint accounts, and
    verification does an RSA signature check plus a possible JWKS fetch.
    """
    if not check_rate_limit(f"social:{client_ip(request)}", limit=REGISTER_MAX_PER_IP_PER_HOUR):
        raise ApiErrorCode("rate_limited")

    provider = body.provider.strip().lower()
    if provider not in SOCIAL_PROVIDERS:
        raise ApiErrorCode("social_provider_unsupported")

    audiences = (
        settings.apple_client_id_list
        if provider == PROVIDER_APPLE
        else settings.google_client_id_list
    )
    try:
        identity = await verify_id_token(
            provider, body.id_token, audiences=audiences, nonce=body.nonce
        )
    except InvalidSocialToken as exc:
        # One flat code for every rejection reason. Distinguishing "bad audience" from "bad
        # signature" tells an attacker which part of our configuration they are probing.
        raise ApiErrorCode("social_token_invalid") from exc

    result = await sign_in_with_identity(session, identity, guest=user)
    tokens = issue_tokens(result.user)
    return SocialTokenResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        created=result.created,
        password_retired=result.password_retired,
    )


# ── Sign in with Google: OIDC authorization-code flow (app/services/google_oauth.py) ─────────────
#
# Three endpoints, and the split is not arbitrary. `/start` needs the caller's bearer token (to
# preserve a guest's progress) and cannot be a redirect the browser follows blindly, so it is a POST
# that returns a URL. `/callback` is a GET because Google navigates the browser to it, and it must
# answer with a redirect rather than JSON — a human is looking at it. `/handoff` is the SPA trading
# the one-time code for a session.


@router.post("/google/start", response_model=GoogleStartResponse)
async def google_start(
    request: Request,
    body: GoogleStartRequest | None = None,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> GoogleStartResponse:
    """Open a Google sign-in and hand back the URL to navigate to.

    Auth is OPTIONAL and load-bearing when present: a GUEST who has been playing is upgrading, and
    binding their (server-validated) identity to the transaction is the only reason their streak,
    coins and rating survive the sign-in. It is taken from the bearer token and never from the
    request body — a client-supplied user id would let anyone aim a sign-in at any account.

    Rate-limited per IP: this mints rows and, downstream, accounts.
    """
    if not check_rate_limit(
        f"google_start:{client_ip(request)}", limit=REGISTER_MAX_PER_IP_PER_HOUR
    ):
        raise ApiErrorCode("rate_limited")
    if not google_configured():
        raise ApiErrorCode("social_provider_unsupported")

    try:
        # The body is OPTIONAL: every client shipped before native sign-in posts none, and must keep
        # working untouched (§7c). Absent body -> absent platform -> normalised to "web".
        _txn, authorize_url = await start_transaction(
            session, guest=user, client_platform=body.platform if body else None
        )
    except GoogleOAuthError as exc:
        raise ApiErrorCode("social_provider_unsupported") from exc
    return GoogleStartResponse(authorize_url=authorize_url)


@router.get("/google/callback")
async def google_callback(
    request: Request,
    session: AsyncSession = Depends(get_session),
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Where Google returns the browser. Always answers with a redirect into the SPA.

    **No provider error, code, token or raw state is ever echoed into the redirect.** Google's error
    strings describe our client configuration and mean nothing to a player; the parameters are
    secrets in their own right. Every failure — the player pressing cancel, a forged state, a dead
    token endpoint — lands on the same opaque `#auth_error=google`, which the SPA renders as one
    localized line. The detail stays server-side.

    On success the only thing in the URL is a one-time handoff code with a 60-second life, so no
    access, refresh or ID token is ever exposed to browser history, a referrer header or a proxy
    log.
    """
    # WHERE to return is a property of the TRANSACTION, not of this request: Google sends the
    # browser back with nothing that distinguishes the app from the website. Until the state
    # resolves we cannot know which this was, so the failures below that happen BEFORE that point
    # can only go to the web. That is the right fallback regardless — they carry no session to lose.

    # The player pressed Cancel, or Google refused. Not an error worth alarming anyone about.
    if error or not code or not state:
        return RedirectResponse(
            url=return_url(PLATFORM_WEB, "auth_error=google"), status_code=status.HTTP_302_FOUND
        )

    try:
        txn, _result = await complete_callback(session, code=code, state=state)
    except GoogleOAuthError:
        # COMMIT, even though this failed. The state was consumed before the step that blew up, and
        # that consumption is the replay protection — rolling it back here would leave the state
        # unspent in the database, so anything that fails AFTER the state check (a wrong nonce, a
        # refused token exchange, a dead endpoint) would hand the same state back for another go.
        # Nothing else is pending on this session at this point but the burn.
        await session.commit()
        # The error itself is deliberately swallowed: `GoogleOAuthError` never carries provider
        # detail, and even its own message stays out of the redirect.
        #
        # Still the web target: `complete_callback` raised, so there is no transaction in hand to
        # read a platform off. A native player lands on the website showing the same opaque error
        # they would have seen in the app — not ideal, but this path only runs when the sign-in
        # already failed, and guessing a destination is worse than a known-safe one.
        return RedirectResponse(
            url=return_url(PLATFORM_WEB, "auth_error=google"), status_code=status.HTTP_302_FOUND
        )

    await session.commit()
    # The SUCCESS path is the one that must honour the platform: this fragment carries the handoff
    # code, and sending it to the website would strand a native player one step from a session.
    return RedirectResponse(
        url=return_url(txn.client_platform, f"handoff={txn.handoff_code}"),
        status_code=status.HTTP_302_FOUND,
    )


@router.post("/google/handoff", response_model=SocialTokenResponse)
async def google_handoff(
    body: GoogleHandoffRequest,
    session: AsyncSession = Depends(get_session),
) -> SocialTokenResponse:
    """Trade the one-time code for a real session. Single-use, fails closed."""
    try:
        result = await redeem_handoff(session, body.handoff_code.strip())
    except GoogleOAuthError as exc:
        # Same reason as the callback: the code is burned before the expiry decision, and that burn
        # has to survive the rejection or an expired code stays redeemable on the next attempt.
        await session.commit()
        raise ApiErrorCode("oauth_handoff_invalid") from exc

    await session.commit()

    tokens = issue_tokens(result.user)
    return SocialTokenResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        created=result.created,
        password_retired=result.password_retired,
    )
