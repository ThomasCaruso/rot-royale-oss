"""Friends graph — request by username, accept/decline, list, auto-accept on mutual, remove.

Drives the /friends API. `client` + `db_session` share ONE rolled-back transaction.
"""

from __future__ import annotations

import uuid

from app.models import User
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register",
        json={"email": email, "username": username, "password": "super-secret-pw"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _uid(session: AsyncSession, email: str) -> uuid.UUID:
    return (await session.execute(select(User).where(User.email == email))).scalar_one().id


async def test_request_accept_flow(client: AsyncClient, db_session: AsyncSession):
    a = await _register(client, "f_a@example.com", "alice")
    await _register(client, "f_b@example.com", "bob")

    # alice → bob.
    r = await client.post("/friends/requests", json={"username": "bob"}, headers=_auth(a))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending"
    request_id = r.json()["request_id"]

    # bob sees it as incoming; alice as outgoing.
    b = (
        await client.post(
            "/auth/login", json={"email": "f_b@example.com", "password": "super-secret-pw"}
        )
    ).json()["access_token"]
    incoming = (await client.get("/friends", headers=_auth(b))).json()
    assert len(incoming["incoming"]) == 1
    assert incoming["incoming"][0]["username"] == "alice"
    outgoing = (await client.get("/friends", headers=_auth(a))).json()
    assert len(outgoing["outgoing"]) == 1

    # bob accepts.
    acc = await client.post(
        f"/friends/requests/{request_id}/respond", json={"accept": True}, headers=_auth(b)
    )
    assert acc.status_code == 200, acc.text
    assert acc.json()["status"] == "accepted"

    # both now list one friend.
    a_friends = (await client.get("/friends", headers=_auth(a))).json()
    b_friends = (await client.get("/friends", headers=_auth(b))).json()
    assert [f["username"] for f in a_friends["friends"]] == ["bob"]
    assert [f["username"] for f in b_friends["friends"]] == ["alice"]
    assert a_friends["outgoing"] == [] and b_friends["incoming"] == []


async def test_unknown_username(client: AsyncClient, db_session: AsyncSession):
    a = await _register(client, "f_u@example.com", "userA")
    r = await client.post("/friends/requests", json={"username": "ghost"}, headers=_auth(a))
    assert r.status_code == 404
    assert r.json()["detail"] == "user_not_found"


async def test_cannot_friend_self(client: AsyncClient, db_session: AsyncSession):
    a = await _register(client, "f_self@example.com", "selfie")
    r = await client.post("/friends/requests", json={"username": "selfie"}, headers=_auth(a))
    assert r.status_code == 400
    assert r.json()["detail"] == "cannot_friend_self"


async def test_mutual_request_auto_accepts(client: AsyncClient, db_session: AsyncSession):
    a = await _register(client, "f_m1@example.com", "mut1")
    b = await _register(client, "f_m2@example.com", "mut2")
    r1 = await client.post("/friends/requests", json={"username": "mut2"}, headers=_auth(a))
    assert r1.json()["status"] == "pending"
    # mut2 "adds" mut1 back → the pending request flips to accepted (no duplicate edge).
    r2 = await client.post("/friends/requests", json={"username": "mut1"}, headers=_auth(b))
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "accepted"
    a_friends = (await client.get("/friends", headers=_auth(a))).json()
    assert [f["username"] for f in a_friends["friends"]] == ["mut2"]


async def test_duplicate_request_conflicts(client: AsyncClient, db_session: AsyncSession):
    a = await _register(client, "f_d1@example.com", "dup1")
    await _register(client, "f_d2@example.com", "dup2")
    await client.post("/friends/requests", json={"username": "dup2"}, headers=_auth(a))
    again = await client.post("/friends/requests", json={"username": "dup2"}, headers=_auth(a))
    assert again.status_code == 409
    assert again.json()["detail"] == "request_exists"


async def test_decline_and_remove(client: AsyncClient, db_session: AsyncSession):
    a = await _register(client, "f_r1@example.com", "rem1")
    b = await _register(client, "f_r2@example.com", "rem2")
    bid = await _uid(db_session, "f_r2@example.com")
    aid = await _uid(db_session, "f_r1@example.com")

    rid = (
        await client.post("/friends/requests", json={"username": "rem2"}, headers=_auth(a))
    ).json()["request_id"]
    # rem2 declines.
    dec = await client.post(
        f"/friends/requests/{rid}/respond", json={"accept": False}, headers=_auth(b)
    )
    assert dec.json()["status"] == "declined"
    assert (await client.get("/friends", headers=_auth(a))).json()["outgoing"] == []

    # Re-friend after a decline works (reopened edge) and then remove cleans it up.
    await client.post("/friends/requests", json={"username": "rem2"}, headers=_auth(a))
    rid2 = (await client.get("/friends", headers=_auth(b))).json()["incoming"][0]["request_id"]
    await client.post(f"/friends/requests/{rid2}/respond", json={"accept": True}, headers=_auth(b))
    assert len((await client.get("/friends", headers=_auth(a))).json()["friends"]) == 1

    removed = await client.delete(f"/friends/{bid}", headers=_auth(a))
    assert removed.status_code == 200 and removed.json()["ok"] is True
    assert (await client.get("/friends", headers=_auth(a))).json()["friends"] == []
    # symmetric: rem2 no longer has rem1 either.
    assert (await client.get("/friends", headers=_auth(b))).json()["friends"] == []
    _ = aid
