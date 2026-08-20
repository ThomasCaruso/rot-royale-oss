"""Auth API end-to-end (register / login / refresh / me)."""

from __future__ import annotations

import app.services.registration as reg
import pytest
from httpx import AsyncClient

REG = {"email": "api@example.com", "username": "apiuser", "password": "super-secret-pw"}


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_register_then_me_returns_seeded_profile(client: AsyncClient):
    r = await client.post("/auth/register", json=REG)
    assert r.status_code == 200, r.text
    tokens = r.json()
    assert tokens["access_token"] and tokens["refresh_token"]
    assert tokens["token_type"] == "bearer"

    me = await client.get("/me", headers=_auth(tokens["access_token"]))
    assert me.status_code == 200, me.text
    body = me.json()
    assert body["email"] == "api@example.com"
    assert body["username"] == "apiuser"
    assert body["rating"] == 1000
    assert body["division"] == "Bronze"
    assert body["streak_count"] == 0
    assert body["sharpness"] == 0
    assert body["coins_balance"] == 0
    assert body["equipped_theme"] == "starter"


async def test_register_duplicate_email_conflicts(client: AsyncClient):
    await client.post("/auth/register", json=REG)
    r = await client.post("/auth/register", json={**REG, "username": "different"})
    assert r.status_code == 409, r.text


async def test_register_duplicate_username_conflicts(client: AsyncClient):
    await client.post("/auth/register", json=REG)
    r = await client.post("/auth/register", json={**REG, "email": "other@example.com"})
    assert r.status_code == 409, r.text


async def test_register_concurrent_collision_returns_409_not_500(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    # Simulate the TOCTOU race at the HTTP boundary: the pre-check passes (another signup committed
    # the email after our check), so the INSERT hits the unique index. The endpoint must answer 409,
    # not 500.
    await client.post("/auth/register", json=REG)

    async def _exists_false(*_args: object, **_kwargs: object) -> bool:
        return False

    monkeypatch.setattr(reg, "_exists", _exists_false)
    r = await client.post("/auth/register", json={**REG, "username": "different"})
    assert r.status_code == 409, r.text


async def test_register_invalid_payload_unprocessable(client: AsyncClient):
    r = await client.post(
        "/auth/register", json={"email": "not-an-email", "username": "x", "password": "short"}
    )
    assert r.status_code == 422


async def test_login_succeeds_and_wrong_password_rejected(client: AsyncClient):
    await client.post("/auth/register", json=REG)

    ok = await client.post("/auth/login", json={"email": REG["email"], "password": REG["password"]})
    assert ok.status_code == 200, ok.text
    assert ok.json()["access_token"]

    bad = await client.post("/auth/login", json={"email": REG["email"], "password": "wrong-pw!!"})
    assert bad.status_code == 401


async def test_me_requires_auth(client: AsyncClient):
    r = await client.get("/me")
    assert r.status_code == 401


async def test_refresh_issues_working_access_token(client: AsyncClient):
    reg = (await client.post("/auth/register", json=REG)).json()
    r = await client.post("/auth/refresh", json={"refresh_token": reg["refresh_token"]})
    assert r.status_code == 200, r.text
    new_access = r.json()["access_token"]
    assert new_access

    me = await client.get("/me", headers=_auth(new_access))
    assert me.status_code == 200


async def test_access_token_rejected_on_refresh_endpoint(client: AsyncClient):
    reg = (await client.post("/auth/register", json=REG)).json()
    # an access token must not be usable as a refresh token
    r = await client.post("/auth/refresh", json={"refresh_token": reg["access_token"]})
    assert r.status_code == 401
