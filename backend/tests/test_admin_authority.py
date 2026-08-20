"""Admin is granted by immutable user id, never by an unverified email claim.

Email is not proof of identity in this product: there is no verification flow, and registration is
open. An email-keyed allowlist therefore grants admin to whoever registers the listed address first
— so an allowlisted address that nobody has claimed yet is a free admin account for a stranger. A
user id is server-generated and cannot be chosen at signup, which removes the claim entirely.
"""

from __future__ import annotations

import uuid

import pytest
from app.api.deps import _admin_user_ids, get_admin_user
from app.core.config import Settings, settings
from fastapi import HTTPException


class _U:
    """Minimal stand-in — the dependency only reads id/email."""

    def __init__(self, uid: uuid.UUID, email: str = "someone@example.com"):
        self.id = uid
        self.email = email


def _cfg(**kw) -> Settings:
    return Settings(_env_file=None, **kw)


def test_no_admins_configured_means_nobody_is_admin():
    """The default. An empty allowlist must fail closed, not open."""
    assert _admin_user_ids(_cfg(admin_user_ids="")) == set()


def test_allowlist_parses_user_ids():
    a, b = uuid.uuid4(), uuid.uuid4()
    got = _admin_user_ids(_cfg(admin_user_ids=f" {a} , {b} "))
    assert got == {a, b}


def test_garbage_entries_are_ignored_not_fatal():
    """A malformed id must not take the API down, and must not widen access."""
    good = uuid.uuid4()
    assert _admin_user_ids(_cfg(admin_user_ids=f"not-a-uuid,{good},")) == {good}


async def test_listed_user_is_admin(monkeypatch):
    uid = uuid.uuid4()
    monkeypatch.setattr(settings, "admin_user_ids", str(uid))
    assert await get_admin_user(user=_U(uid)) is not None


async def test_unlisted_user_is_rejected(monkeypatch):
    monkeypatch.setattr(settings, "admin_user_ids", str(uuid.uuid4()))
    with pytest.raises(HTTPException) as e:
        await get_admin_user(user=_U(uuid.uuid4()))
    assert e.value.status_code == 403


async def test_matching_an_admins_email_grants_nothing(monkeypatch):
    """The whole point: registering the address an admin uses must not confer admin."""
    admin_id = uuid.uuid4()
    monkeypatch.setattr(settings, "admin_user_ids", str(admin_id))
    attacker = _U(uuid.uuid4(), email="admin@rotroyale.live")
    with pytest.raises(HTTPException) as e:
        await get_admin_user(user=attacker)
    assert e.value.status_code == 403


async def test_the_dependency_takes_no_non_http_parameters():
    """Regression: a settings/test seam on this signature becomes part of the REQUEST contract.

    FastAPI builds the contract from the signature, so a parameter annotated with a Pydantic model
    is read as a request BODY — which silently 422'd every admin endpoint.
    """
    import inspect

    params = set(inspect.signature(get_admin_user).parameters) - {"user"}
    assert not params, f"get_admin_user grew non-HTTP parameters: {params}"
