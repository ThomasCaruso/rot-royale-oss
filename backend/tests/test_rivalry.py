"""Living rivalries — per-friend streak/last-result/14-day stats + 'hottest' rival selection."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.models import Profile, User
from app.models.social import FriendDuel
from app.services.friends import list_friends, send_friend_request
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


async def _user(session: AsyncSession, name: str) -> User:
    u = User(email=f"{name}-{uuid.uuid4().hex[:6]}@example.com", password_hash="x")
    session.add(u)
    await session.flush()
    session.add(Profile(user_id=u.id, username=f"{name}{uuid.uuid4().hex[:5]}", division="bronze"))
    await session.flush()
    return u


async def _befriend(session: AsyncSession, a: User, b: User) -> None:
    ap = await session.get(Profile, a.id)
    bp = await session.get(Profile, b.id)
    await send_friend_request(session, a.id, bp.username)
    await send_friend_request(session, b.id, ap.username)


async def _duel(session, challenger, opponent, winner_side, days_ago: float) -> None:
    ts = datetime.now(UTC) - timedelta(days=days_ago)
    session.add(
        FriendDuel(
            challenger_id=challenger.id,
            opponent_id=opponent.id,
            status="completed",
            seed=1,
            round_set=[],
            server_answers=[],
            contest_date=ts.date(),
            winner_side=winner_side,
            challenger_round_wins=4,
            opponent_round_wins=2,
            completed_at=ts,
        )
    )
    await session.flush()


async def test_rivalry_streak_and_last_result(db_session: AsyncSession) -> None:
    me = await _user(db_session, "me")
    ava = await _user(db_session, "ava")
    await _befriend(db_session, me, ava)
    await _duel(db_session, me, ava, "challenger", 10)
    await _duel(db_session, me, ava, "challenger", 9)
    await _duel(db_session, me, ava, "opponent", 8)
    await _duel(db_session, me, ava, "challenger", 2)
    await _duel(db_session, me, ava, "challenger", 1)
    await _duel(db_session, me, ava, "challenger", 0.1)

    friends = (await list_friends(db_session, me.id)).friends
    f = next(x for x in friends if x.user_id == ava.id)
    assert (f.wins, f.losses) == (5, 1)
    assert f.streak == 3
    assert f.last_result == "won"
    assert f.duels_14d == 6


async def test_rival_is_hottest_in_last_14_days(db_session: AsyncSession) -> None:
    me = await _user(db_session, "me")
    ava = await _user(db_session, "ava")
    bob = await _user(db_session, "bob")
    for f in (ava, bob):
        await _befriend(db_session, me, f)
    for _ in range(5):
        await _duel(db_session, me, ava, "challenger", 40)
    await _duel(db_session, me, bob, "opponent", 1)
    await _duel(db_session, me, bob, "challenger", 0.5)

    fl = await list_friends(db_session, me.id)
    assert fl.rival_user_id == bob.id


async def test_no_duels_means_no_rival(db_session: AsyncSession) -> None:
    me = await _user(db_session, "me")
    ava = await _user(db_session, "ava")
    await _befriend(db_session, me, ava)
    fl = await list_friends(db_session, me.id)
    assert fl.rival_user_id is None
    f = next(x for x in fl.friends if x.user_id == ava.id)
    assert f.streak == 0 and f.last_result is None and f.duels_14d == 0


async def _register(client: AsyncClient, name: str) -> tuple[str, str]:
    uname = f"{name}{uuid.uuid4().hex[:5]}"
    r = await client.post(
        "/auth/register",
        json={
            "email": f"{uuid.uuid4().hex[:8]}@example.com",
            "username": uname,
            "password": "super-secret-pw",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"], uname


async def test_friends_endpoint_exposes_rivalry_fields(client: AsyncClient) -> None:
    ta, ua = await _register(client, "a")
    tb, ub = await _register(client, "b")
    await client.post(
        "/friends/requests", json={"username": ub}, headers={"Authorization": f"Bearer {ta}"}
    )
    await client.post(
        "/friends/requests", json={"username": ua}, headers={"Authorization": f"Bearer {tb}"}
    )
    r = await client.get("/friends", headers={"Authorization": f"Bearer {ta}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "rival_user_id" in body
    assert set(body["friends"][0]) >= {"streak", "last_result", "last_played", "duels_14d"}
