"""Third-party sign-in: token verification and which account an identity resolves to.

Two halves, and the second is the one that would cost somebody their account.

VERIFICATION (`app/core/socialid.py`) — every check is exercised by forging a token that fails
exactly one of them. A signature check that passes an unsigned token, or an audience check that
accepts a token minted for another app, is an account takeover rather than a bug, so each is tested
by attack rather than by asserting the happy path twice.

RESOLUTION (`app/services/social_auth.py`) — which account a verified identity lands on. The case
worth reading is `test_squatter_loses_the_password...`: registration has no email verification, so
pre-registering a stranger's address is free, and linking their later Google sign-in to that row
while leaving the password alive would hand the squatter a working credential for the victim's
account. The verified claim wins and the unproven one is retired.

Tokens are signed here with a locally generated RSA key and the provider JWKS is monkeypatched, so
nothing in this file touches the network or depends on Apple or Google being reachable.
"""

from __future__ import annotations

import time
import uuid

import jwt
import pytest
from app.core import socialid
from app.core.socialid import InvalidSocialToken, SocialIdentity, verify_id_token
from app.models import UserIdentity
from app.models.identity import PROVIDER_APPLE, PROVIDER_GOOGLE
from app.models.user import GUEST_STATUS
from app.services.registration import register_user
from app.services.social_auth import sign_in_with_identity
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio

GOOGLE_AUD = "111-rot-royale.apps.googleusercontent.com"
APPLE_AUD = "live.rotroyale.app"

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_KID = "test-key-1"


def _jwk() -> dict:
    from jwt.algorithms import RSAAlgorithm

    data = RSAAlgorithm.to_jwk(_KEY.public_key(), as_dict=True)
    data.update({"kid": _KID, "use": "sig", "alg": "RS256"})
    return data


@pytest.fixture(autouse=True)
def _offline_jwks(monkeypatch):
    """Serve our own key as the provider's JWKS. No network, and no dependency on Apple/Google."""

    async def fake_fetch(provider: str) -> dict:
        keys = {_KID: _jwk()}
        socialid._jwks_cache[provider] = (time.time(), keys)
        socialid._jwks_last_fetch[provider] = time.time()
        return keys

    monkeypatch.setattr(socialid, "_fetch_jwks", fake_fetch)
    socialid.reset_jwks_cache()
    yield
    socialid.reset_jwks_cache()


def _token(**over) -> str:
    now = int(time.time())
    claims = {
        "iss": "https://accounts.google.com",
        "aud": GOOGLE_AUD,
        "sub": "google-subject-001",
        "email": "player@example.com",
        "email_verified": True,
        "iat": now,
        "exp": now + 600,
    }
    claims.update(over)
    headers = {"kid": over.pop("_kid", _KID)}
    return jwt.encode(claims, _KEY, algorithm="RS256", headers=headers)


# ── Verification: one forged token per check ───────────────────────────────────────────────────


async def test_a_well_formed_token_verifies() -> None:
    ident = await verify_id_token(PROVIDER_GOOGLE, _token(), audiences=[GOOGLE_AUD])
    assert ident.subject == "google-subject-001"
    assert ident.email == "player@example.com"
    assert ident.email_verified is True


async def test_a_token_for_someone_elses_app_is_refused() -> None:
    """The check people skip. Google issues valid tokens to ANY app; only the audience ties one to
    us. Without this, a token minted for an attacker's own app authenticates as the victim here."""
    with pytest.raises(InvalidSocialToken):
        await verify_id_token(
            PROVIDER_GOOGLE,
            _token(aud="attacker-app.apps.googleusercontent.com"),
            audiences=[GOOGLE_AUD],
        )


async def test_an_unsigned_token_is_refused() -> None:
    """`alg: none` — the oldest JWT attack there is."""
    bad = jwt.encode({"sub": "x", "aud": GOOGLE_AUD}, key="", algorithm="none")
    with pytest.raises(InvalidSocialToken):
        await verify_id_token(PROVIDER_GOOGLE, bad, audiences=[GOOGLE_AUD])


async def test_a_token_signed_by_the_wrong_key_is_refused() -> None:
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = int(time.time())
    bad = jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "aud": GOOGLE_AUD,
            "sub": "s",
            "iat": now,
            "exp": now + 600,
        },
        other,
        algorithm="RS256",
        headers={"kid": _KID},  # claims OUR kid, signed with a key we never published
    )
    with pytest.raises(InvalidSocialToken):
        await verify_id_token(PROVIDER_GOOGLE, bad, audiences=[GOOGLE_AUD])


async def test_an_expired_token_is_refused() -> None:
    now = int(time.time())
    with pytest.raises(InvalidSocialToken):
        await verify_id_token(
            PROVIDER_GOOGLE, _token(iat=now - 7200, exp=now - 3600), audiences=[GOOGLE_AUD]
        )


async def test_a_token_from_another_issuer_is_refused() -> None:
    with pytest.raises(InvalidSocialToken):
        await verify_id_token(
            PROVIDER_GOOGLE, _token(iss="https://evil.example.com"), audiences=[GOOGLE_AUD]
        )


async def test_a_replayed_token_is_refused_when_a_nonce_was_committed() -> None:
    tok = _token(nonce="nonce-from-a-different-sign-in")
    with pytest.raises(InvalidSocialToken):
        await verify_id_token(
            PROVIDER_GOOGLE, tok, audiences=[GOOGLE_AUD], nonce="the-nonce-we-sent"
        )
    ident = await verify_id_token(
        PROVIDER_GOOGLE, tok, audiences=[GOOGLE_AUD], nonce="nonce-from-a-different-sign-in"
    )
    assert ident.subject


async def test_an_unconfigured_provider_refuses_rather_than_accepting_anything() -> None:
    """Empty audiences means "not enabled". Verifying against an empty list would accept a token
    minted for anybody, so a half-configured deployment must reject sign-ins rather than accept
    every one."""
    with pytest.raises(InvalidSocialToken):
        await verify_id_token(PROVIDER_GOOGLE, _token(), audiences=[])


async def test_an_unknown_provider_never_reaches_the_verifier() -> None:
    with pytest.raises(InvalidSocialToken):
        await verify_id_token("facebook", _token(), audiences=[GOOGLE_AUD])


@pytest.mark.parametrize("raw", [False, "false", None, "yes", 1, {}])
async def test_only_a_real_yes_counts_as_a_verified_email(raw) -> None:
    """Anything unrecognised must read as NOT verified — an unverified email would let an attacker
    link to any account by claiming its address."""
    ident = await verify_id_token(
        PROVIDER_GOOGLE, _token(email_verified=raw), audiences=[GOOGLE_AUD]
    )
    assert ident.email_verified is False


async def test_apple_tokens_verify_against_apples_issuer() -> None:
    tok = _token(iss="https://appleid.apple.com", aud=APPLE_AUD, sub="apple-sub-1")
    ident = await verify_id_token(PROVIDER_APPLE, tok, audiences=[APPLE_AUD])
    assert ident.provider == PROVIDER_APPLE and ident.subject == "apple-sub-1"


# ── Resolution: which account does a verified identity land on? ────────────────────────────────


def _identity(**over) -> SocialIdentity:
    base = {
        "provider": PROVIDER_GOOGLE,
        "subject": f"sub-{uuid.uuid4().hex[:8]}",
        "email": None,
        "email_verified": False,
    }
    base.update(over)
    return SocialIdentity(**base)


async def test_a_first_sign_in_creates_a_seeded_account_with_no_password(
    db_session: AsyncSession,
) -> None:
    ident = _identity(email="new@example.com", email_verified=True)
    result = await sign_in_with_identity(db_session, ident)
    assert result.created is True
    assert result.user.password_hash is None, "a social account must hold no credential of ours"
    # Same seeding as any other account — a social user with no theme or rating is a broken player.
    await db_session.refresh(result.user, ["profile"])
    assert result.user.profile.rating == 1000
    assert result.user.profile.equipped_theme


async def test_the_same_identity_always_returns_the_same_account(db_session: AsyncSession) -> None:
    ident = _identity(email="repeat@example.com", email_verified=True)
    first = await sign_in_with_identity(db_session, ident)
    second = await sign_in_with_identity(db_session, ident)
    assert second.user.id == first.user.id
    assert second.created is False


async def test_a_guest_upgrades_in_place_and_keeps_their_progress(db_session: AsyncSession) -> None:
    """The whole point of anonymous-first. Creating a new account here would strand the streak,
    coins and rating the player already earned on a row they can never reach again."""
    from app.services.registration import register_guest

    guest = await register_guest(db_session)
    guest_id = guest.id
    await db_session.refresh(guest, ["profile"])
    guest.profile.streak_count = 7
    await db_session.flush()

    result = await sign_in_with_identity(
        db_session, _identity(email="guest@example.com", email_verified=True), guest=guest
    )
    assert result.user.id == guest_id, "must be the SAME row, not a new account"
    assert result.user.status != GUEST_STATUS
    await db_session.refresh(result.user, ["profile"])
    assert result.user.profile.streak_count == 7


async def test_a_verified_email_links_to_the_existing_account(db_session: AsyncSession) -> None:
    existing = await register_user(
        db_session, "linkme@example.com", "linkme_user", "correct horse 9"
    )
    result = await sign_in_with_identity(
        db_session, _identity(email="linkme@example.com", email_verified=True)
    )
    assert result.user.id == existing.id
    assert result.created is False


async def test_a_squatter_loses_the_password_when_the_real_owner_signs_in(
    db_session: AsyncSession,
) -> None:
    """The attack this design exists to stop.

    Registration never verifies an email, so anyone may register a stranger's address. If linking
    left that password working, the squatter would hold a live credential for the victim's account
    the moment the victim signs in with Google.
    """
    squatted = await register_user(
        db_session, "victim@example.com", "squatter_x", "squatter pw 123"
    )
    assert squatted.password_hash is not None

    result = await sign_in_with_identity(
        db_session, _identity(email="victim@example.com", email_verified=True)
    )

    assert result.user.id == squatted.id, "the real owner takes the account and its progress"
    assert result.password_retired is True
    assert result.user.password_hash is None, "the unproven credential must not survive the link"


async def test_an_unverified_email_never_links(db_session: AsyncSession) -> None:
    """The same takeover with the roles swapped: if an unverified provider email could link, an
    attacker would claim any address and walk into the matching account."""
    victim = await register_user(db_session, "target@example.com", "target_user", "a good password")
    result = await sign_in_with_identity(
        db_session, _identity(email="target@example.com", email_verified=False)
    )
    assert result.user.id != victim.id
    assert result.created is True
    await db_session.refresh(victim)
    assert victim.password_hash is not None, "an untouched account must keep its password"


async def test_an_unverified_email_is_not_stored_as_the_account_address(
    db_session: AsyncSession,
) -> None:
    ident = _identity(email="claimed@example.com", email_verified=False)
    result = await sign_in_with_identity(db_session, ident)
    assert "claimed@example.com" not in result.user.email
    assert result.user.email.endswith(".invalid")


async def test_apple_and_google_can_both_attach_to_one_account(db_session: AsyncSession) -> None:
    first = await sign_in_with_identity(
        db_session, _identity(email="both@example.com", email_verified=True)
    )
    second = await sign_in_with_identity(
        db_session,
        _identity(provider=PROVIDER_APPLE, email="both@example.com", email_verified=True),
    )
    assert second.user.id == first.user.id
    rows = (
        (
            await db_session.execute(
                select(UserIdentity).where(UserIdentity.user_id == first.user.id)
            )
        )
        .scalars()
        .all()
    )
    assert {r.provider for r in rows} == {PROVIDER_GOOGLE, PROVIDER_APPLE}


# ── The route ──────────────────────────────────────────────────────────────────────────────────


async def test_the_endpoint_rejects_an_unverifiable_token(client: AsyncClient) -> None:
    r = await client.post("/auth/social", json={"provider": "google", "id_token": "not-a-token"})
    assert r.status_code == 401
    body = r.json()
    # One flat code — never which check failed.
    assert "audience" not in str(body).lower() and "signature" not in str(body).lower()


async def test_the_endpoint_rejects_an_unknown_provider(client: AsyncClient) -> None:
    r = await client.post("/auth/social", json={"provider": "myspace", "id_token": "x"})
    assert r.status_code == 400


async def test_providers_is_empty_when_nothing_is_configured(client: AsyncClient) -> None:
    """A button for an unconfigured provider is a guaranteed dead end the player blames on us."""
    r = await client.get("/auth/providers")
    assert r.status_code == 200
    body = r.json()
    assert body["providers"] == []  # nothing configured in the test environment
    assert body["google_client_id"] is None


async def test_providers_offers_google_once_an_audience_is_configured(
    client: AsyncClient, monkeypatch
) -> None:
    """The env var is the ONLY switch. Setting an audience is what turns the button on."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "google_client_ids", "123-web.apps.googleusercontent.com")
    r = await client.get("/auth/providers")
    body = r.json()
    assert body["providers"] == ["google"]
    assert body["google_client_id"] == "123-web.apps.googleusercontent.com"
    # Apple stays off: it has no audience, so a token for it could not be verified.
    assert "apple" not in body["providers"]


async def test_providers_offers_only_the_first_google_audience_to_the_browser(
    client: AsyncClient, monkeypatch
) -> None:
    """The extra ids exist so iOS/Android tokens also verify; a browser can only start a flow with
    the web one, and handing it three would be an invitation to pick the wrong one."""
    from app.core.config import settings

    monkeypatch.setattr(
        settings,
        "google_client_ids",
        "web.apps.googleusercontent.com,ios.apps.googleusercontent.com",
    )
    body = (await client.get("/auth/providers")).json()
    assert body["google_client_id"] == "web.apps.googleusercontent.com"


async def test_a_token_is_accepted_only_for_a_CONFIGURED_audience(monkeypatch) -> None:
    """End to end on the thing that actually gates access: our configured id verifies, and an id
    Google would happily sign for some other app does not."""
    from app.core.config import settings

    ours = "000000000000-testclientid.apps.googleusercontent.com"
    monkeypatch.setattr(settings, "google_client_ids", ours)

    ident = await verify_id_token(
        PROVIDER_GOOGLE, _token(aud=ours), audiences=settings.google_client_id_list
    )
    assert ident.subject

    with pytest.raises(InvalidSocialToken):
        await verify_id_token(
            PROVIDER_GOOGLE,
            _token(aud="someone-elses.apps.googleusercontent.com"),
            audiences=settings.google_client_id_list,
        )
