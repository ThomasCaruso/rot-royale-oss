"""Global rank in GET /me: competition ranking by rating desc (#1 = best), real players only."""

from __future__ import annotations

import uuid

from app.models import Profile
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, name: str) -> str:
    r = await client.post(
        "/auth/register",
        json={"email": f"{name}@r.com", "username": f"rank{name}", "password": "super-secret-pw"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def test_global_rank_with_ties(client: AsyncClient, db_session: AsyncSession):
    tokens = {n: await _register(client, n) for n in ("a", "b", "c", "d")}

    # Set ratings: a=1200, b=c=1100 (tie), d=1000 → competition ranks 1, 2, 2, 4.
    ratings = {"a": 1200, "b": 1100, "c": 1100, "d": 1000}
    for name, rating in ratings.items():
        me = (await client.get("/me", headers=_auth(tokens[name]))).json()
        profile = await db_session.get(Profile, uuid.UUID(me["user_id"]))
        assert profile is not None
        profile.rating = rating
    await db_session.flush()

    async def me(name: str) -> dict:
        return (await client.get("/me", headers=_auth(tokens[name]))).json()

    a, b, c, d = await me("a"), await me("b"), await me("c"), await me("d")
    assert a["rank"] == 1  # highest rating → #1
    assert b["rank"] == 2
    assert c["rank"] == 2  # tie shares the rank (standard competition ranking)
    assert d["rank"] == 4  # ...and the next rank skips 3
    assert a["total_players"] == 4
    assert a["rating"] == 1200  # rating still exposed under the hood


async def test_solo_player_is_rank_one(client: AsyncClient, db_session: AsyncSession):
    token = await _register(client, "solo")
    body = (await client.get("/me", headers=_auth(token))).json()
    assert body["rank"] == 1
    assert body["total_players"] == 1
