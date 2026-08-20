"""Avatar identity data layer: PATCH /me/avatar and GET /me fields."""

from __future__ import annotations

import uuid

import pytest

# ---------------------------------------------------------------------------
# Auth helper (mirrors test_vault.py)
# ---------------------------------------------------------------------------


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register_and_login(client) -> tuple[str, uuid.UUID]:
    """Register a unique user, return (access_token, user_id)."""
    email = f"{uuid.uuid4().hex}@identity.example.com"
    username = f"id{uuid.uuid4().hex[:10]}"
    r = await client.post(
        "/auth/register",
        json={"email": email, "username": username, "password": "test-secret-pw"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    me = (await client.get("/me", headers=_auth(token))).json()
    user_id = uuid.UUID(me["user_id"])
    return token, user_id


# ---------------------------------------------------------------------------
# GET /me — fresh registration defaults
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fresh_registration_has_default_avatar_fields(client):
    """A brand-new user /me includes avatar_preset='knight' and equipped_frame=None."""
    token, _ = await _register_and_login(client)
    r = await client.get("/me", headers=_auth(token))
    assert r.status_code == 200
    body = r.json()
    assert body["avatar_preset"] == "knight"
    assert body["equipped_frame"] is None


# ---------------------------------------------------------------------------
# PATCH /me/avatar — happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_avatar_happy_path_persists_and_reflects(client):
    """PATCH /me/avatar with a valid preset → 200, body has new preset, GET /me reflects it."""
    token, _ = await _register_and_login(client)

    r = await client.patch("/me/avatar", json={"preset_id": "rook"}, headers=_auth(token))
    assert r.status_code == 200
    assert r.json() == {"avatar_preset": "rook"}

    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["avatar_preset"] == "rook"


# ---------------------------------------------------------------------------
# PATCH /me/avatar — unknown preset → 422 detail "unknown_preset"
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_avatar_unknown_preset_returns_422(client):
    """PATCH /me/avatar with an unknown preset_id → 422 with detail 'unknown_preset'."""
    token, _ = await _register_and_login(client)

    # First set to a known value so we can verify it doesn't change on error.
    r = await client.patch("/me/avatar", json={"preset_id": "crescent"}, headers=_auth(token))
    assert r.status_code == 200

    # Bad preset.
    r = await client.patch("/me/avatar", json={"preset_id": "unicorn"}, headers=_auth(token))
    assert r.status_code == 422
    assert r.json()["detail"] == "unknown_preset"

    # Profile is unchanged.
    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["avatar_preset"] == "crescent"


# ---------------------------------------------------------------------------
# PATCH /me/avatar — auth required
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_avatar_without_auth_returns_401(client):
    """PATCH /me/avatar with no Authorization header → 401."""
    r = await client.patch("/me/avatar", json={"preset_id": "rook"})
    assert r.status_code == 401
