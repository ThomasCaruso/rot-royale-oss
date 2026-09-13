"""Sign in with Google — OpenID Connect authorization-code flow, driven from the server.

This REPLACED Google Identity Services (the `renderButton` / One Tap widget) on the web, and the
reason is worth keeping: GIS only hands a credential to a button GIS itself rendered, inside a
cross-origin iframe. Matching that iframe to the app's own three provider tiles meant drawing our
mark and putting Google's invisible button on top to take the tap — a control the player could see
but not the one they were pressing. It was brittle in exactly the way that arrangement predicts, and
it left us debugging iframe hit-boxes instead of an auth flow. Here the tile is an ordinary button:
it asks the server for a URL and navigates to it. Nothing is overlaid, nothing is forwarded.

The trade is that we now hold a client secret (config `google_client_secret`) to authenticate the
code exchange. ID-token VERIFICATION still needs no secret — `core/socialid.py` uses Google's public
keys — so the secret buys exactly one thing: swapping a code for tokens, server-side.

Three steps, and every one of them fails closed:

  start     Mint a random `state` and `nonce`, record them against the caller's (validated) guest
            identity, return Google's authorize URL. The guest comes from a bearer token we check
            ourselves; a user id supplied by the client is never trusted, or anyone could aim a
            sign-in at any account.
  callback  Google returns `code` + `state`. Consume the state exactly once, exchange the code,
            verify the resulting ID token INCLUDING the nonce we stored, resolve the account, and
            mint a one-time handoff code.
  handoff   The SPA trades that code, once, for real tokens.

**Nothing sensitive is ever logged or persisted.** Not the secret, not the authorization code, not
the ID token, not the handoff code, not the raw state. The row keeps the outcome and the two flags
the client needs; everything else dies with the request. Log lines here carry a transaction id at
most, which is meaningless to anyone who does not already have the database.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import (
    GOOGLE_OAUTH_HANDOFF_TTL_SECONDS,
    GOOGLE_OAUTH_STATE_TTL_SECONDS,
)
from app.core.socialid import InvalidSocialToken, verify_id_token
from app.models.identity import PROVIDER_GOOGLE
from app.models.oauth_transaction import OAuthTransaction
from app.models.user import User
from app.services.social_auth import SocialSignInResult, sign_in_with_identity

AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"

# openid gets us the ID token; email and profile populate it. Nothing else is requested — every
# extra scope is another consent line the player has to read and another thing to justify.
SCOPES = "openid email profile"

# The platforms a sign-in may be returned to. A request names one of THESE; it never supplies a
# URL. Anything unrecognised — an old client, a typo, someone probing — falls back to the web,
# which is the only behaviour that existed before native sign-in and is always safe.
PLATFORM_WEB = "web"
PLATFORM_NATIVE = "native"
_PLATFORMS = (PLATFORM_WEB, PLATFORM_NATIVE)


def normalize_platform(value: str | None) -> str:
    """The stored platform for a requested one. Unknown input becomes "web", never an error."""
    candidate = (value or "").strip().lower()
    return candidate if candidate in _PLATFORMS else PLATFORM_WEB


def return_url(client_platform: str, fragment: str) -> str:
    """Where the callback sends the browser, for a transaction started on `client_platform`.

    `fragment` is the part after "#" and carries either a one-time handoff code or an opaque error.
    It goes in the FRAGMENT for both platforms and for the same reason: fragments are not sent to
    servers, so the code never reaches a proxy log, a referrer header or an access log.

    Built entirely from configuration. Nothing the client sent reaches this string.
    """
    if normalize_platform(client_platform) == PLATFORM_NATIVE:
        # A custom scheme has no host to speak of; "://auth" gives the app a stable path to match
        # on, so a future second deep link cannot be confused for a sign-in return.
        return f"{settings.native_auth_scheme}://auth#{fragment}"
    return f"{settings.web_base_url.rstrip(chr(47))}/#{fragment}"


# 256 bits of urandom, hex. Both values are guessing targets, so they are sized to make guessing
# irrelevant rather than merely unlikely.
_TOKEN_BYTES = 32


class GoogleOAuthError(Exception):
    """The flow could not be completed. Deliberately carries no provider detail: the callback turns
    this into one opaque redirect, because Google's own error strings are both useless to a player
    and a description of our configuration."""


def _now() -> datetime:
    return datetime.now(UTC)


def _random_token() -> str:
    return secrets.token_hex(_TOKEN_BYTES)


@dataclass(frozen=True)
class HandoffResult:
    """What the SPA gets when it redeems a handoff code."""

    user: User
    created: bool
    password_retired: bool


def google_configured() -> bool:
    return settings.google_oauth_configured


async def start_transaction(
    session: AsyncSession,
    *,
    guest: User | None,
    client_platform: str | None = None,
) -> tuple[OAuthTransaction, str]:
    """Open a transaction and build the URL to send the browser to.

    `guest` is the ALREADY-AUTHENTICATED caller, resolved from a bearer token by the endpoint. It is
    stored here so the callback — which arrives with no Authorization header, from Google — can
    still upgrade the right account in place. This is the single reason a player who has been
    playing as a guest does not lose their streak, coins and rating by signing in.
    """
    if not google_configured():
        raise GoogleOAuthError("google sign-in is not configured")

    txn = OAuthTransaction(
        provider=PROVIDER_GOOGLE,
        state=_random_token(),
        nonce=_random_token(),
        guest_user_id=guest.id if guest is not None else None,
        client_platform=normalize_platform(client_platform),
        expires_at=_now() + timedelta(seconds=GOOGLE_OAUTH_STATE_TTL_SECONDS),
    )
    session.add(txn)
    # The row must exist before the browser leaves, or the callback races it and finds nothing.
    await session.flush()

    params = {
        "client_id": settings.google_client_id_list[0],
        "redirect_uri": settings.google_oauth_redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "state": txn.state,
        "nonce": txn.nonce,
        # Ask for the account chooser every time. Without it Google silently reuses whichever
        # account is already signed in, which on a shared machine signs the player into someone
        # else's Rot Royale account with no visible choice and no obvious way back.
        "prompt": "select_account",
    }
    return txn, f"{AUTHORIZE_ENDPOINT}?{urlencode(params)}"


async def _consume_state(session: AsyncSession, state: str) -> OAuthTransaction:
    """Claim a state exactly once, or refuse.

    The UPDATE is what makes this safe under concurrency: two callbacks carrying the same state race
    on `consumed_at IS NULL`, and the database picks a winner. Reading the row, checking it in
    Python and then writing would let both pass the check.
    """
    if not state:
        raise GoogleOAuthError("missing state")

    row = (
        await session.execute(
            select(OAuthTransaction)
            .where(
                OAuthTransaction.state == state,
                OAuthTransaction.provider == PROVIDER_GOOGLE,
                OAuthTransaction.consumed_at.is_(None),
            )
            # FOR UPDATE, so a concurrent callback blocks here rather than reading the same
            # unconsumed row and proceeding alongside us.
            .with_for_update()
        )
    ).scalar_one_or_none()

    # Forged, already spent, or from another deployment — all one answer, on purpose.
    if row is None:
        raise GoogleOAuthError("unknown or already-used state")

    # Burn FIRST, and flush it, whichever way this goes.
    #
    # The flush is not tidiness. Consumption has to survive the rest of the callback FAILING —
    # a wrong nonce, a dead token endpoint, a refused exchange — because otherwise the state is
    # still unconsumed in the database and can simply be presented again. The caller commits this
    # even on the error path for exactly that reason (see api/auth.google_callback).
    row.consumed_at = _now()
    await session.flush()

    if row.expires_at <= _now():
        raise GoogleOAuthError("state expired")
    return row


async def _exchange_code(code: str) -> str:
    """Swap the authorization code for an ID token. Server-side, always.

    The code is single-use at Google's end too, and it never leaves this function — it is not
    returned, stored or logged. On any failure the provider's message is deliberately dropped: it
    describes our client configuration and is no use to a player.
    """
    if not code:
        raise GoogleOAuthError("missing code")

    payload = {
        "code": code,
        "client_id": settings.google_client_id_list[0],
        "client_secret": settings.google_client_secret.strip(),
        "redirect_uri": settings.google_oauth_redirect_uri,
        "grant_type": "authorization_code",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(TOKEN_ENDPOINT, data=payload)
    except httpx.HTTPError as exc:
        raise GoogleOAuthError("token endpoint unreachable") from exc

    if resp.status_code != 200:
        raise GoogleOAuthError("token exchange rejected")

    try:
        id_token = resp.json().get("id_token")
    except ValueError as exc:
        raise GoogleOAuthError("token endpoint returned non-JSON") from exc

    if not id_token or not isinstance(id_token, str):
        raise GoogleOAuthError("no id_token in token response")
    return id_token


async def complete_callback(
    session: AsyncSession,
    *,
    code: str,
    state: str,
) -> tuple[OAuthTransaction, SocialSignInResult]:
    """Finish the round trip: consume the state, exchange the code, verify, resolve the account.

    The nonce check is the reason the transaction row is consulted rather than trusted from the
    request: `verify_id_token` is told the nonce WE stored at `/start`, so a token minted for some
    other sign-in — captured, or issued to a different attempt — fails even though it is genuine,
    correctly signed and has the right audience.
    """
    txn = await _consume_state(session, state)

    id_token = await _exchange_code(code)

    try:
        identity = await verify_id_token(
            PROVIDER_GOOGLE,
            id_token,
            audiences=settings.google_client_id_list,
            nonce=txn.nonce,
        )
    except InvalidSocialToken as exc:
        raise GoogleOAuthError("id token rejected") from exc

    guest: User | None = None
    if txn.guest_user_id is not None:
        guest = (
            await session.execute(select(User).where(User.id == txn.guest_user_id))
        ).scalar_one_or_none()

    result = await sign_in_with_identity(session, identity, guest=guest)

    # The outcome, plus the one-time code the browser will trade for it.
    txn.user_id = result.user.id
    txn.created_account = result.created
    txn.password_retired = result.password_retired
    txn.handoff_code = _random_token()
    txn.handoff_expires_at = _now() + timedelta(seconds=GOOGLE_OAUTH_HANDOFF_TTL_SECONDS)
    await session.flush()
    return txn, result


async def redeem_handoff(session: AsyncSession, handoff_code: str) -> HandoffResult:
    """Trade a one-time code for the finished session. Fails closed on expired, spent or unknown.

    Same single-use discipline as the state, and for the same reason: this code rides in a URL
    fragment, so it can end up in browser history. Being spendable once, briefly, is what makes that
    acceptable.
    """
    if not handoff_code:
        raise GoogleOAuthError("missing handoff code")

    row = (
        await session.execute(
            select(OAuthTransaction)
            .where(
                OAuthTransaction.handoff_code == handoff_code,
                OAuthTransaction.handoff_consumed_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()

    if row is None or row.user_id is None or row.handoff_expires_at is None:
        raise GoogleOAuthError("unknown or already-used handoff code")

    # Same discipline as the state: burn it, flush it, and only then decide. An expired code that
    # stayed unconsumed would remain probeable, and the caller commits on the error path so the burn
    # is not rolled back underneath us.
    row.handoff_consumed_at = _now()
    await session.flush()

    if row.handoff_expires_at <= _now():
        raise GoogleOAuthError("handoff code expired")

    user = (await session.execute(select(User).where(User.id == row.user_id))).scalar_one_or_none()
    if user is None:
        raise GoogleOAuthError("account no longer exists")

    return HandoffResult(
        user=user,
        created=row.created_account,
        password_retired=row.password_retired,
    )


async def purge_expired(session: AsyncSession, *, older_than_hours: int = 24) -> int:
    """Drop handshake rows nothing can use any more. Called from the maintenance tick.

    These rows are pure in-flight state with a ten-minute life; keeping them forever grows a table
    that is only ever read by primary key. Deliberately generous — a day, not ten minutes — so that
    anything still being investigated is still there.
    """
    cutoff = _now() - timedelta(hours=older_than_hours)
    stmt = select(OAuthTransaction).where(OAuthTransaction.created_at < cutoff)
    rows = (await session.execute(stmt)).scalars().all()
    for row in rows:
        await session.delete(row)
    return len(rows)


__all__ = [
    "AUTHORIZE_ENDPOINT",
    "GoogleOAuthError",
    "HandoffResult",
    "SCOPES",
    "TOKEN_ENDPOINT",
    "complete_callback",
    "google_configured",
    "purge_expired",
    "redeem_handoff",
    "start_transaction",
]
