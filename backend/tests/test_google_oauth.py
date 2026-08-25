"""Sign in with Google: the OIDC authorization-code flow.

This flow REPLACED Google Identity Services, whose credential could only come from a button Google
rendered inside a cross-origin iframe. On the front door that meant showing our own mark with
Google's invisible button on top of it, so the control the player saw was not the control they
pressed — and it failed in exactly the way that predicts: taps that did nothing at all, with nothing
in any log. The tile is an ordinary button now and every decision happens here, on the server, where
it can be tested.

Almost everything below is an ATTACK rather than a happy path, because the happy path is the part
that gets exercised by hand anyway. The state and the handoff code are each single-use, and the
tests that matter are the ones that try to use them twice.

The one non-security test that must never be deleted is the guest upgrade. A player who plays first
and signs in later must land on the SAME account, keeping their coins, streak and rating. Getting
that wrong does not throw — it silently creates a second account and strands the first, which is
invisible in every log and reported as "the app lost my progress".

Nothing here touches the network: the provider JWKS is served from a locally generated key and the
token endpoint is monkeypatched.
"""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from app.core import socialid
from app.core.config import settings
from app.models.oauth_transaction import OAuthTransaction
from app.models.profile import Profile
from app.models.user import GUEST_STATUS
from app.services import google_oauth
from app.services.google_oauth import (
    GoogleOAuthError,
    complete_callback,
    redeem_handoff,
    start_transaction,
)
from app.services.registration import register_guest, register_user
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio

GOOGLE_AUD = "111-rot-royale.apps.googleusercontent.com"
CLIENT_SECRET = "test-client-secret-never-real"

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_KID = "google-oauth-test-key"


def _jwk() -> dict:
    from jwt.algorithms import RSAAlgorithm

    data = RSAAlgorithm.to_jwk(_KEY.public_key(), as_dict=True)
    data.update({"kid": _KID, "use": "sig", "alg": "RS256"})
    return data


@pytest.fixture(autouse=True)
def _offline_jwks(monkeypatch):
    async def fake_fetch(provider: str) -> dict:
        keys = {_KID: _jwk()}
        socialid._jwks_cache[provider] = (time.time(), keys)
        socialid._jwks_last_fetch[provider] = time.time()
        return keys

    monkeypatch.setattr(socialid, "_fetch_jwks", fake_fetch)
    socialid.reset_jwks_cache()
    yield
    socialid.reset_jwks_cache()


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    """A deployment with Google fully set up. Both halves — audience AND secret."""
    monkeypatch.setattr(settings, "google_client_ids", GOOGLE_AUD)
    monkeypatch.setattr(settings, "google_client_secret", CLIENT_SECRET)
    monkeypatch.setattr(settings, "google_redirect_uri", "https://api.test/auth/google/callback")


def _id_token(nonce: str, **over) -> str:
    now = int(time.time())
    claims = {
        "iss": "https://accounts.google.com",
        "aud": GOOGLE_AUD,
        "sub": "google-subject-oauth-001",
        "email": "player@example.com",
        "email_verified": True,
        "nonce": nonce,
        "iat": now,
        "exp": now + 600,
    }
    claims.update(over)
    return jwt.encode(claims, _KEY, algorithm="RS256", headers={"kid": _KID})


def _serve_token(monkeypatch, id_token: str | None, *, status: int = 200) -> None:
    """Stand in for Google's token endpoint. The authorization code never leaves the server, so this
    is the only place a test can inject one."""

    class _Resp:
        status_code = status

        def json(self) -> dict:
            return {"id_token": id_token} if id_token is not None else {}

    class _Client:
        def __init__(self, *a, **k) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a) -> None:
            return None

        async def post(self, *a, **k):
            return _Resp()

    monkeypatch.setattr(google_oauth.httpx, "AsyncClient", _Client)


# ── The URL we send the browser to ───────────────────────────────────────────────────────────────


async def test_start_builds_a_code_flow_url_and_records_the_handshake(
    db_session: AsyncSession,
) -> None:
    txn, url = await start_transaction(db_session, guest=None)
    q = parse_qs(urlparse(url).query)

    assert q["response_type"] == ["code"], "authorization-code flow, never implicit"
    assert q["client_id"] == [GOOGLE_AUD]
    assert q["redirect_uri"] == ["https://api.test/auth/google/callback"]
    assert "openid" in q["scope"][0]
    # Both are recorded server-side so the callback can check them against what we actually sent.
    assert q["state"] == [txn.state]
    assert q["nonce"] == [txn.nonce]
    # The account chooser every time: without it Google silently reuses whoever is signed in, which
    # on a shared machine signs the player into someone else's Rot Royale account.
    assert q["prompt"] == ["select_account"]


async def test_state_and_nonce_are_unguessable_and_never_reused(
    db_session: AsyncSession,
) -> None:
    a, _ = await start_transaction(db_session, guest=None)
    b, _ = await start_transaction(db_session, guest=None)
    assert a.state != b.state and a.nonce != b.nonce
    assert a.state != a.nonce
    # 32 bytes as hex. Sized so guessing is irrelevant rather than merely unlikely.
    assert len(a.state) == 64 and len(a.nonce) == 64


async def test_start_refuses_when_google_is_half_configured(
    db_session: AsyncSession, monkeypatch
) -> None:
    """An audience with no secret can VERIFY a token it has no way to obtain. Offering the button
    then would put the failure at the very end, after the player had already picked an account."""
    monkeypatch.setattr(settings, "google_client_secret", "")
    assert settings.google_oauth_configured is False
    assert "google" not in settings.social_sign_in_providers
    with pytest.raises(GoogleOAuthError):
        await start_transaction(db_session, guest=None)


# ── State: forged, expired, replayed ─────────────────────────────────────────────────────────────


async def test_a_forged_state_is_refused(db_session: AsyncSession, monkeypatch) -> None:
    _serve_token(monkeypatch, _id_token("whatever"))
    with pytest.raises(GoogleOAuthError):
        await complete_callback(db_session, code="code", state="not-a-state-we-minted")


async def test_an_expired_state_is_refused_and_burned(
    db_session: AsyncSession, monkeypatch
) -> None:
    txn, _ = await start_transaction(db_session, guest=None)
    txn.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.flush()
    _serve_token(monkeypatch, _id_token(txn.nonce))

    with pytest.raises(GoogleOAuthError):
        await complete_callback(db_session, code="code", state=txn.state)

    # Burned rather than left lying around: an expired state must not stay probeable.
    await db_session.refresh(txn)
    assert txn.consumed_at is not None


async def test_a_state_cannot_be_replayed(db_session: AsyncSession, monkeypatch) -> None:
    """The reason this flow keeps a row instead of a signed, stateless `state`. A signature proves
    we minted the value; it can never prove we have not already honoured it."""
    txn, _ = await start_transaction(db_session, guest=None)
    _serve_token(monkeypatch, _id_token(txn.nonce))

    await complete_callback(db_session, code="code", state=txn.state)
    with pytest.raises(GoogleOAuthError):
        await complete_callback(db_session, code="code", state=txn.state)


async def test_a_state_that_failed_downstream_still_cannot_be_reused(
    db_session: AsyncSession, monkeypatch
) -> None:
    """A state must be spent the moment it is presented — not only when the flow SUCCEEDS.

    This was a real hole. The state was consumed and the exception from a later step (wrong nonce,
    refused exchange, dead endpoint) propagated out of an endpoint that did not commit, so the burn
    rolled back and the state was unspent again in the database. An attacker who could make the
    exchange fail once got unlimited further attempts with the same state.
    """
    txn, _ = await start_transaction(db_session, guest=None)

    # Fail at the nonce check, well past the state check.
    _serve_token(monkeypatch, _id_token("a-nonce-from-somewhere-else"))
    with pytest.raises(GoogleOAuthError):
        await complete_callback(db_session, code="code", state=txn.state)

    # The burn is durable, so the SECOND attempt is refused at the state check — even though this
    # one carries a perfectly good token.
    _serve_token(monkeypatch, _id_token(txn.nonce))
    with pytest.raises(GoogleOAuthError):
        await complete_callback(db_session, code="code", state=txn.state)


# ── The ID token that comes back ─────────────────────────────────────────────────────────────────


async def test_a_token_with_the_wrong_nonce_is_refused(
    db_session: AsyncSession, monkeypatch
) -> None:
    """Genuine, correctly signed, right audience — and minted for a DIFFERENT sign-in. The nonce is
    the only thing that ties a token to this particular round trip."""
    txn, _ = await start_transaction(db_session, guest=None)
    _serve_token(monkeypatch, _id_token("a-nonce-from-some-other-attempt"))
    with pytest.raises(GoogleOAuthError):
        await complete_callback(db_session, code="code", state=txn.state)


async def test_a_token_for_another_app_is_refused(db_session: AsyncSession, monkeypatch) -> None:
    txn, _ = await start_transaction(db_session, guest=None)
    _serve_token(monkeypatch, _id_token(txn.nonce, aud="someone-elses.apps.googleusercontent.com"))
    with pytest.raises(GoogleOAuthError):
        await complete_callback(db_session, code="code", state=txn.state)


async def test_a_dead_token_endpoint_fails_closed(db_session: AsyncSession, monkeypatch) -> None:
    txn, _ = await start_transaction(db_session, guest=None)
    _serve_token(monkeypatch, None, status=500)
    with pytest.raises(GoogleOAuthError):
        await complete_callback(db_session, code="code", state=txn.state)


async def test_a_token_response_without_an_id_token_fails_closed(
    db_session: AsyncSession, monkeypatch
) -> None:
    txn, _ = await start_transaction(db_session, guest=None)
    _serve_token(monkeypatch, None)
    with pytest.raises(GoogleOAuthError):
        await complete_callback(db_session, code="code", state=txn.state)


# ── Which account it lands on ────────────────────────────────────────────────────────────────────


async def test_a_new_identity_creates_an_account(db_session: AsyncSession, monkeypatch) -> None:
    txn, _ = await start_transaction(db_session, guest=None)
    _serve_token(monkeypatch, _id_token(txn.nonce))
    _txn, result = await complete_callback(db_session, code="code", state=txn.state)
    assert result.created is True
    assert result.user.id is not None


async def test_a_known_identity_signs_into_the_same_account(
    db_session: AsyncSession, monkeypatch
) -> None:
    first, _ = await start_transaction(db_session, guest=None)
    _serve_token(monkeypatch, _id_token(first.nonce))
    _t1, r1 = await complete_callback(db_session, code="code", state=first.state)

    second, _ = await start_transaction(db_session, guest=None)
    _serve_token(monkeypatch, _id_token(second.nonce))
    _t2, r2 = await complete_callback(db_session, code="code", state=second.state)

    assert r2.created is False
    assert r2.user.id == r1.user.id, "the same Google subject must never mint a second account"


async def test_a_guest_keeps_their_progress(db_session: AsyncSession, monkeypatch) -> None:
    """THE test in this file. A player plays first and signs in later; the identity must attach to
    the row they have been playing on. Getting this wrong throws nothing — it silently creates a
    second account and strands the first, which surfaces only as "the app lost my progress"."""
    guest = await register_guest(db_session)
    guest_id = guest.id
    await db_session.flush()

    # Loaded explicitly rather than via `guest.profile`: a lazy relationship load is blocking IO,
    # which async SQLAlchemy refuses outright (MissingGreenlet).
    profile = (
        await db_session.execute(select(Profile).where(Profile.user_id == guest_id))
    ).scalar_one()
    profile.coins_balance = 250
    profile.streak_count = 7
    profile.rating = 1180
    await db_session.flush()

    txn, _ = await start_transaction(db_session, guest=guest)
    # The binding lives server-side, resolved from a validated token — never named by the client.
    assert txn.guest_user_id == guest_id

    _serve_token(monkeypatch, _id_token(txn.nonce))
    _t, result = await complete_callback(db_session, code="code", state=txn.state)

    assert result.user.id == guest_id, "signed in onto a NEW account — the guest was stranded"
    assert result.user.status != GUEST_STATUS
    await db_session.refresh(profile)
    assert profile.coins_balance == 250
    assert profile.streak_count == 7
    assert profile.rating == 1180


async def test_the_client_cannot_choose_whose_account_to_attach_to(
    db_session: AsyncSession, monkeypatch
) -> None:
    """`/start` takes the guest from a validated bearer token and nothing else. If a caller could
    name a user id, anyone could aim a Google sign-in at any account and take it over."""
    victim = await register_user(db_session, "victim@example.com", "victim", "pw-victim-123")
    await db_session.flush()

    # The only channel into the transaction is the `guest` argument, which the endpoint fills from
    # `get_optional_user`. There is no field for a caller-supplied id — assert that stays true.
    txn, _ = await start_transaction(db_session, guest=None)
    assert txn.guest_user_id is None

    _serve_token(monkeypatch, _id_token(txn.nonce))
    _t, result = await complete_callback(db_session, code="code", state=txn.state)
    assert result.user.id != victim.id


# ── The handoff ──────────────────────────────────────────────────────────────────────────────────


async def _completed(db_session: AsyncSession, monkeypatch) -> OAuthTransaction:
    txn, _ = await start_transaction(db_session, guest=None)
    _serve_token(monkeypatch, _id_token(txn.nonce))
    done, _r = await complete_callback(db_session, code="code", state=txn.state)
    return done


async def test_a_handoff_code_is_minted_and_carries_no_token(
    db_session: AsyncSession, monkeypatch
) -> None:
    txn = await _completed(db_session, monkeypatch)
    assert txn.handoff_code and len(txn.handoff_code) == 64
    # The row keeps the OUTCOME, never a credential: no id_token, no code, no secret anywhere on it.
    stored = {c.name: getattr(txn, c.name) for c in txn.__table__.columns}
    for value in stored.values():
        assert CLIENT_SECRET not in str(value)
    assert not any(k in stored for k in ("id_token", "code", "access_token", "refresh_token"))


async def test_a_handoff_code_works_exactly_once(db_session: AsyncSession, monkeypatch) -> None:
    txn = await _completed(db_session, monkeypatch)
    assert txn.handoff_code is not None

    result = await redeem_handoff(db_session, txn.handoff_code)
    assert result.user.id == txn.user_id

    with pytest.raises(GoogleOAuthError):
        await redeem_handoff(db_session, txn.handoff_code)


async def test_an_expired_handoff_code_is_refused_and_burned(
    db_session: AsyncSession, monkeypatch
) -> None:
    txn = await _completed(db_session, monkeypatch)
    assert txn.handoff_code is not None
    txn.handoff_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.flush()

    with pytest.raises(GoogleOAuthError):
        await redeem_handoff(db_session, txn.handoff_code)
    await db_session.refresh(txn)
    assert txn.handoff_consumed_at is not None


async def test_an_unknown_handoff_code_is_refused(db_session: AsyncSession) -> None:
    with pytest.raises(GoogleOAuthError):
        await redeem_handoff(db_session, uuid.uuid4().hex * 2)
    with pytest.raises(GoogleOAuthError):
        await redeem_handoff(db_session, "")


async def test_a_handoff_code_from_an_unfinished_transaction_is_refused(
    db_session: AsyncSession,
) -> None:
    """A row that never completed has no user on it. Redeeming one must not hand back a session."""
    txn, _ = await start_transaction(db_session, guest=None)
    txn.handoff_code = "a" * 64
    txn.handoff_expires_at = datetime.now(UTC) + timedelta(seconds=60)
    await db_session.flush()
    with pytest.raises(GoogleOAuthError):
        await redeem_handoff(db_session, txn.handoff_code)


# ── Housekeeping ─────────────────────────────────────────────────────────────────────────────────


async def test_purge_drops_only_stale_rows(db_session: AsyncSession) -> None:
    fresh, _ = await start_transaction(db_session, guest=None)
    stale, _ = await start_transaction(db_session, guest=None)
    stale.created_at = datetime.now(UTC) - timedelta(days=3)
    await db_session.flush()

    removed = await google_oauth.purge_expired(db_session, older_than_hours=24)
    assert removed >= 1
    await db_session.flush()

    remaining = (await db_session.execute(select(OAuthTransaction.id))).scalars().all()
    assert fresh.id in remaining
    assert stale.id not in remaining


# ── The endpoints, and what the browser is actually told ─────────────────────────────────────────


async def test_the_callback_never_echoes_a_provider_error(client, monkeypatch) -> None:
    """Google's own error strings describe our client configuration and mean nothing to a player,
    and `code`/`state` are credentials in their own right. Every failure lands on one opaque marker.

    This is a redirect a human reads, so `follow_redirects=False` and inspect the Location.
    """
    resp = await client.get(
        "/auth/google/callback",
        params={"error": "access_denied", "state": "abc", "code": "secret-code-xyz"},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    location = resp.headers["location"]
    assert location.endswith("#auth_error=google")
    for leaked in ("access_denied", "secret-code-xyz", "abc"):
        assert leaked not in location


async def test_the_callback_redirects_on_a_bad_state_rather_than_500ing(client) -> None:
    resp = await client.get(
        "/auth/google/callback",
        params={"code": "some-code", "state": "forged"},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert resp.headers["location"].endswith("#auth_error=google")


async def test_the_callback_redirects_when_the_player_just_cancels(client) -> None:
    # No code, no state — the player pressed Cancel at Google. Not an error worth alarming anyone.
    resp = await client.get("/auth/google/callback", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"].endswith("#auth_error=google")


async def test_a_bad_handoff_code_is_a_clean_401(client) -> None:
    resp = await client.post("/auth/google/handoff", json={"handoff_code": "nope"})
    assert resp.status_code == 401
    assert resp.json()["detail"] == "oauth_handoff_invalid"


async def test_start_is_unavailable_when_google_is_not_configured(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "google_client_secret", "")
    resp = await client.post("/auth/google/start")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "social_provider_unsupported"


async def test_providers_offers_google_only_with_both_halves(client, monkeypatch) -> None:
    resp = await client.get("/auth/providers")
    assert "google" in resp.json()["providers"]

    monkeypatch.setattr(settings, "google_client_secret", "")
    resp = await client.get("/auth/providers")
    assert "google" not in resp.json()["providers"]
