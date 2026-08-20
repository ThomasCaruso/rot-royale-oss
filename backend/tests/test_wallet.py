"""Wallet surface: gems_balance on GET /me + the GET /me/wallet two-currency endpoint.

Mirrors test_vault.py's API pattern: register over the wire, seed balances on the shared db_session
(services don't commit; the client fixture shares the same rolled-back transaction), assert via API.
"""

from __future__ import annotations

import uuid

import pytest
from app.services.gem_ledger import record_gem_delta
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register_and_login(client) -> tuple[str, uuid.UUID]:
    """Register a unique user, return (token, user_id)."""
    email = f"{uuid.uuid4().hex}@wallet.example.com"
    username = f"w{uuid.uuid4().hex[:10]}"
    r = await client.post(
        "/auth/register",
        json={"email": email, "username": username, "password": "super-secret-pw"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    me = (await client.get("/me", headers=_auth(token))).json()
    return token, uuid.UUID(me["user_id"])


@pytest.mark.asyncio
async def test_fresh_user_has_zero_gems_on_me_and_wallet(client, db_session: AsyncSession):
    token, _ = await _register_and_login(client)

    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["coins_balance"] == 0
    assert me["gems_balance"] == 0

    r = await client.get("/me/wallet", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json() == {
        "coins_balance": 0,
        "gems_balance": 0,
        "duel": {"bot_gem_duels_used": 0, "bot_gem_duels_cap": 3},
    }


@pytest.mark.asyncio
async def test_granted_gems_surface_on_me_and_wallet(client, db_session: AsyncSession):
    token, user_id = await _register_and_login(client)

    await record_gem_delta(db_session, user_id, 7, "test_grant")

    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["gems_balance"] == 7
    assert me["coins_balance"] == 0

    r = await client.get("/me/wallet", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json() == {
        "coins_balance": 0,
        "gems_balance": 7,
        "duel": {"bot_gem_duels_used": 0, "bot_gem_duels_cap": 3},
    }


@pytest.mark.asyncio
async def test_wallet_requires_auth(client):
    r = await client.get("/me/wallet")
    assert r.status_code == 401
