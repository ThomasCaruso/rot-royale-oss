"""Async "beat my Daily Royale score" friend challenge — the directed push nudge.

Uses the `client` fixture to register users (User+Profile) and `db_session` to drive the service in
the same rolled-back transaction. Transport is a fake recorder; the service never self-commits and
the fake sender never prunes devices, so everything stays inside the test transaction.
"""

from __future__ import annotations

import pytest
from app.models import User, UserNotification
from app.services.friend_challenge import (
    CannotChallengeSelfError,
    NotFriendsError,
    UserNotFoundError,
    challenge_friend_to_daily,
)
from app.services.friends import respond_friend_request, send_friend_request
from app.services.push import subscribe_native
from httpx import AsyncClient
from sqlalchemy import func, select
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


async def _uid(session: AsyncSession, email: str):
    return (await session.execute(select(User).where(User.email == email))).scalar_one().id


async def _make_friends(session: AsyncSession, a_id, b_id, b_username: str) -> None:
    fr = await send_friend_request(session, a_id, b_username)
    await respond_friend_request(session, b_id, fr.id, True)


def _recorder():
    calls: list[tuple[str, dict]] = []

    async def send(sub: dict, payload: dict) -> None:
        calls.append((sub.get("device_token") or sub.get("endpoint"), payload))

    return calls, send


async def _gate_rows(session: AsyncSession, uid) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(UserNotification)
            .where(UserNotification.user_id == uid, UserNotification.kind == "challenged")
        )
    ).scalar_one()


async def test_challenge_pushes_the_friend_exactly_once_per_day(
    client: AsyncClient, db_session: AsyncSession
):
    await _register(client, "fc_a@example.com", "Hank67")
    await _register(client, "fc_b@example.com", "targetB")
    a_id = await _uid(db_session, "fc_a@example.com")
    b_id = await _uid(db_session, "fc_b@example.com")
    await _make_friends(db_session, a_id, b_id, "targetB")
    await subscribe_native(db_session, b_id, "tok-b", "ios")

    calls, send = _recorder()
    sent = await challenge_friend_to_daily(db_session, a_id, "targetB", send=send)
    assert sent is True
    assert len(calls) == 1
    # The exact copy the product asked for, with the challenger's username.
    assert calls[0][1]["body"] == "Hank67 challenged you! Beat their score?"
    assert calls[0][1]["url"] == "/"  # deep-links into today's Daily Royale

    # A second challenge the same ET day is a silent, idempotent no-op — one gate row, no 2nd push.
    sent_again = await challenge_friend_to_daily(db_session, a_id, "targetB", send=send)
    assert sent_again is False
    assert len(calls) == 1
    assert await _gate_rows(db_session, b_id) == 1


async def test_challenge_with_no_push_transport_still_claims_and_reports_sent(
    client: AsyncClient, db_session: AsyncSession
):
    # send=None models push not being configured (dev): the gate is still claimed, sent is True,
    # and nothing is dispatched — the button reads "Challenge sent" regardless.
    await _register(client, "fc_np_a@example.com", "npA")
    await _register(client, "fc_np_b@example.com", "npB")
    a_id = await _uid(db_session, "fc_np_a@example.com")
    b_id = await _uid(db_session, "fc_np_b@example.com")
    await _make_friends(db_session, a_id, b_id, "npB")

    sent = await challenge_friend_to_daily(db_session, a_id, "npB", send=None)
    assert sent is True
    assert await _gate_rows(db_session, b_id) == 1


async def test_challenge_non_friend_rejected(client: AsyncClient, db_session: AsyncSession):
    await _register(client, "fc_nf1@example.com", "nfa")
    await _register(client, "fc_nf2@example.com", "nfb")
    a_id = await _uid(db_session, "fc_nf1@example.com")
    calls, send = _recorder()
    with pytest.raises(NotFriendsError):
        await challenge_friend_to_daily(db_session, a_id, "nfb", send=send)
    assert calls == []


async def test_challenge_self_rejected(client: AsyncClient, db_session: AsyncSession):
    await _register(client, "fc_self@example.com", "selfie")
    a_id = await _uid(db_session, "fc_self@example.com")
    _calls, send = _recorder()
    with pytest.raises(CannotChallengeSelfError):
        await challenge_friend_to_daily(db_session, a_id, "selfie", send=send)


async def test_challenge_unknown_username(client: AsyncClient, db_session: AsyncSession):
    await _register(client, "fc_u@example.com", "knownuser")
    a_id = await _uid(db_session, "fc_u@example.com")
    _calls, send = _recorder()
    with pytest.raises(UserNotFoundError):
        await challenge_friend_to_daily(db_session, a_id, "ghost_nobody", send=send)


async def test_challenge_endpoint_ok(client: AsyncClient, db_session: AsyncSession):
    a = await _register(client, "fc_e_a@example.com", "epA")
    await _register(client, "fc_e_b@example.com", "epB")
    a_id = await _uid(db_session, "fc_e_a@example.com")
    b_id = await _uid(db_session, "fc_e_b@example.com")
    await _make_friends(db_session, a_id, b_id, "epB")

    r = await client.post("/friend-challenges", json={"username": "epB"}, headers=_auth(a))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["sent"] is True  # gate newly claimed (push transport off in tests → no dispatch)


async def test_challenge_endpoint_non_friend_403(client: AsyncClient, db_session: AsyncSession):
    a = await _register(client, "fc_e_nf1@example.com", "epNfA")
    await _register(client, "fc_e_nf2@example.com", "epNfB")
    r = await client.post("/friend-challenges", json={"username": "epNfB"}, headers=_auth(a))
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == "not_friends"
