"""Verify an Apple or Google ID token.

The client hands us a token it got from the provider. That token is the ENTIRE basis for believing
the person is who they say, so everything here is about refusing tokens rather than reading them.
A bug in this file is an account takeover, not a 500.

Five checks, and each blocks a specific attack:

  signature   Verified against the provider's published JWKS. Without it anyone can mint any claim
              they like. `verify_signature=False` must never appear in this file.
  issuer      Pinned per provider, so a token from some other identity service is not accepted just
              because it happens to parse.
  audience    Must be one of OUR client ids. This is the check people skip and the one that matters
              most: Google will happily issue a valid, correctly-signed token to ANY app. Without an
              audience check, a token minted for someone else's app — or an attacker's throwaway app
              the victim once signed into — is accepted here as proof of identity.
  expiry      Enforced, with no leeway beyond a small clock-skew allowance.
  nonce       When the client sent one, it must come back. This is what stops a token captured from
              one sign-in being replayed to authenticate a different one.

The email is treated as a separate question from identity. `email_verified` is checked before the
address is used for anything, because the address is what links a provider identity to an existing
account, and an unverified one would let an attacker link to any account by claiming its email.

No secrets are needed. Verification uses public keys and public client ids; we hold no provider
credential, which is why there is no provider secret anywhere in this codebase to leak.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt

from app.models.identity import PROVIDER_APPLE, PROVIDER_GOOGLE

# Where each provider publishes its signing keys, and the issuer its tokens must claim.
_PROVIDERS: dict[str, dict[str, Any]] = {
    PROVIDER_APPLE: {
        "jwks_uri": "https://appleid.apple.com/auth/keys",
        # Apple is exact. Google is the one with two spellings (below).
        "issuers": ("https://appleid.apple.com",),
    },
    PROVIDER_GOOGLE: {
        "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
        # Google has issued both forms for years and still does. Accepting only one rejects real
        # tokens intermittently, which reads as a flaky login rather than a config error.
        "issuers": ("https://accounts.google.com", "accounts.google.com"),
    },
}

# Providers sign with RSA. Listing the algorithms explicitly is what prevents the classic `alg`
# confusion attack — an attacker choosing "none", or handing us an HMAC token signed with the
# provider's PUBLIC key, which a permissive verifier would accept as valid.
_ALGORITHMS = ["RS256", "ES256"]

# Tokens are short-lived and clocks drift. Small and fixed: leeway is a window in which an expired
# token still works, so it buys reliability at a real cost and should not be generous.
_CLOCK_SKEW_SECONDS = 30

_JWKS_TTL_SECONDS = 3600
# An unknown `kid` usually means the provider rotated keys, so a refetch is correct. It is also
# attacker-controlled — a flood of junk kids would otherwise become a request amplifier pointed at
# the provider, and get us rate-limited into a total login outage. One refetch per minute, tops.
_JWKS_REFETCH_COOLDOWN_SECONDS = 60

_jwks_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_jwks_last_fetch: dict[str, float] = {}


class InvalidSocialToken(Exception):
    """The token is not acceptable proof of identity. Never distinguishes WHY to the caller."""


@dataclass(frozen=True)
class SocialIdentity:
    """What a verified token actually establishes."""

    provider: str
    subject: str
    email: str | None
    email_verified: bool


def _now() -> float:
    return time.time()


async def _fetch_jwks(provider: str) -> dict[str, Any]:
    uri = _PROVIDERS[provider]["jwks_uri"]
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(uri)
        resp.raise_for_status()
        data = resp.json()
    keys = {k["kid"]: k for k in data.get("keys", []) if k.get("kid")}
    if not keys:
        raise InvalidSocialToken("provider published no usable signing keys")
    _jwks_cache[provider] = (_now(), keys)
    _jwks_last_fetch[provider] = _now()
    return keys


async def _signing_key(provider: str, kid: str) -> Any:
    cached = _jwks_cache.get(provider)
    keys = cached[1] if cached and _now() - cached[0] < _JWKS_TTL_SECONDS else None
    if keys is None:
        keys = await _fetch_jwks(provider)

    if kid not in keys:
        # Rotation, or junk. Refetch at most once a cooldown so this cannot be used to hammer the
        # provider on our behalf.
        if _now() - _jwks_last_fetch.get(provider, 0.0) >= _JWKS_REFETCH_COOLDOWN_SECONDS:
            keys = await _fetch_jwks(provider)
        if kid not in keys:
            raise InvalidSocialToken("token was not signed by a key this provider publishes")

    return jwt.PyJWK(keys[kid]).key


def reset_jwks_cache() -> None:
    """Test seam. Never called in production — the TTL handles rotation."""
    _jwks_cache.clear()
    _jwks_last_fetch.clear()


async def verify_id_token(
    provider: str,
    token: str,
    *,
    audiences: list[str],
    nonce: str | None = None,
) -> SocialIdentity:
    """Verify, or raise InvalidSocialToken. Returns only what the token PROVES."""
    if provider not in _PROVIDERS:
        raise InvalidSocialToken(f"unsupported provider {provider!r}")
    if not audiences:
        # A provider with no configured audience is not enabled. Verifying against an empty list
        # would accept a token minted for anyone, so this fails closed rather than open — a
        # half-configured deploy must reject sign-ins, not accept every one.
        raise InvalidSocialToken(f"{provider} sign-in is not configured on this deployment")
    if not isinstance(token, str) or not token.strip():
        raise InvalidSocialToken("empty token")

    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise InvalidSocialToken("malformed token") from exc
    kid = header.get("kid")
    if not kid:
        raise InvalidSocialToken("token header carries no key id")

    key = await _signing_key(provider, kid)

    try:
        claims = jwt.decode(
            token,
            key=key,
            algorithms=_ALGORITHMS,
            audience=audiences,
            issuer=list(_PROVIDERS[provider]["issuers"]),
            leeway=_CLOCK_SKEW_SECONDS,
            options={
                "verify_signature": True,
                "verify_exp": True,
                "verify_iat": True,
                "verify_aud": True,
                "verify_iss": True,
                # A token with no expiry would be valid forever once captured.
                "require": ["exp", "iat", "sub", "aud", "iss"],
            },
        )
    except jwt.PyJWTError as exc:
        # Deliberately one flat message. Telling a caller whether the audience, the issuer or the
        # signature failed hands them a tool for probing our configuration.
        raise InvalidSocialToken("token rejected") from exc

    # Replay protection, when the client committed to a nonce.
    if nonce is not None:
        presented = claims.get("nonce")
        if not presented or not _constant_time_equals(str(presented), nonce):
            raise InvalidSocialToken("token rejected")

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise InvalidSocialToken("token carries no subject")

    email = claims.get("email")
    email = email.strip().lower() if isinstance(email, str) and email.strip() else None

    # Providers send this as a real bool or the strings "true"/"false" depending on the flow. Any
    # other shape counts as NOT verified: an unrecognised value must never be read as a yes.
    raw_verified = claims.get("email_verified")
    email_verified = raw_verified is True or (
        isinstance(raw_verified, str) and raw_verified.lower() == "true"
    )

    return SocialIdentity(
        provider=provider,
        subject=subject,
        email=email,
        email_verified=bool(email and email_verified),
    )


def _constant_time_equals(a: str, b: str) -> bool:
    import hmac

    return hmac.compare_digest(a, b)
