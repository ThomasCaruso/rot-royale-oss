"""Daily friends leaderboard — the friends cut of a window's submitted entries."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.models import Entry, Profile, RoundResult, User
from app.models.contest import OPEN, SUBMITTED, ContestWindow
from app.services.contest import friends_board
from app.services.friends import send_friend_request
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
    await send_friend_request(session, b.id, ap.username)  # mutual add → auto-accept


async def _submit_entry(
    session: AsyncSession, window: ContestWindow, user: User, score: int
) -> Entry:
    e = Entry(
        window_id=window.id,
        user_id=user.id,
        is_practice=False,
        seed=1,
        round_set=[],
        started_at=datetime.now(UTC),
        submitted_at=datetime.now(UTC),
        total_score=score,
        status=SUBMITTED,
    )
    session.add(e)
    await session.flush()
    session.add(
        RoundResult(
            entry_id=e.id,
            idx=0,
            module_type="trivia",
            points=score,
            correct=True,
            time_frac=0.5,
            valid=True,
            flags=[],
        )
    )
    await session.flush()
    return e


async def _open_window(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    w = ContestWindow(
        contest_date=now.date(),
        slot="royale",
        template_id="dr_8_trivia",
        state=OPEN,
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
    )
    session.add(w)
    await session.flush()
    return w


async def test_friends_board_ranks_and_lists_yet_to_play(db_session: AsyncSession) -> None:
    me = await _user(db_session, "me")
    alice = await _user(db_session, "alice")
    bob = await _user(db_session, "bob")
    carol = await _user(db_session, "carol")  # friend who has NOT played
    for f in (alice, bob, carol):
        await _befriend(db_session, me, f)

    window = await _open_window(db_session)
    await _submit_entry(db_session, window, me, 900)
    await _submit_entry(db_session, window, alice, 940)
    await _submit_entry(db_session, window, bob, 800)

    board = await friends_board(db_session, window.id, me.id)

    assert [r.score for r in board.played] == [940, 900, 800]
    assert [r.rank for r in board.played] == [1, 2, 3]
    assert board.my_rank == 2
    assert board.friend_field_size == 3
    assert next(r for r in board.played if r.is_me).score == 900
    assert {y.user_id for y in board.yet_to_play} == {carol.id}


async def test_yet_to_play_ordered_by_recent_activity(db_session: AsyncSession) -> None:
    """Friends who haven't played today are ordered most-recently-active first (their latest
    submitted run, any window); friends who have never played sort last."""
    me = await _user(db_session, "me")
    recent = await _user(db_session, "recent")  # submitted a run 1 min ago
    older = await _user(db_session, "older")  # submitted a run a day ago
    never = await _user(db_session, "never")  # never submitted a run
    for f in (recent, older, never):
        await _befriend(db_session, me, f)

    window = await _open_window(db_session)
    await _submit_entry(db_session, window, me, 500)  # only I play the current window

    # recent/older have prior activity in an EARLIER window (so they're not "played today"), at
    # controlled submitted_at times; `never` has no entries at all.
    now = datetime.now(UTC)
    prior = ContestWindow(
        contest_date=(now - timedelta(days=2)).date(),
        slot="royale",
        template_id="dr_8_trivia",
        state=OPEN,
        open_at=now - timedelta(days=2),
        close_at=now - timedelta(days=2, hours=-1),
    )
    db_session.add(prior)
    await db_session.flush()
    for user, ago in ((recent, timedelta(minutes=1)), (older, timedelta(days=1))):
        db_session.add(
            Entry(
                window_id=prior.id,
                user_id=user.id,
                is_practice=False,
                seed=1,
                round_set=[],
                started_at=now - ago - timedelta(minutes=5),
                submitted_at=now - ago,
                total_score=100,
                status=SUBMITTED,
            )
        )
    await db_session.flush()

    board = await friends_board(db_session, window.id, me.id)
    assert [y.user_id for y in board.yet_to_play] == [recent.id, older.id, never.id]


async def test_friends_board_excludes_non_friends(db_session: AsyncSession) -> None:
    me = await _user(db_session, "me")
    stranger = await _user(db_session, "stranger")
    window = await _open_window(db_session)
    await _submit_entry(db_session, window, me, 500)
    await _submit_entry(db_session, window, stranger, 999)

    board = await friends_board(db_session, window.id, me.id)
    assert [r.user_id for r in board.played] == [me.id]
    assert board.yet_to_play == []


async def test_friends_board_endpoint_shape(client: AsyncClient, db_session: AsyncSession) -> None:
    r = await client.post(
        "/auth/register",
        json={
            "email": f"{uuid.uuid4().hex[:8]}@example.com",
            "username": f"me{uuid.uuid4().hex[:5]}",
            "password": "super-secret-pw",
        },
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    window = await _open_window(db_session)
    resp = await client.get(
        f"/contests/{window.id}/friends", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"my_rank", "friend_field_size", "played", "yet_to_play"}
    assert body["played"] == [] and body["yet_to_play"] == []


async def test_friends_board_carries_equipped_title_and_frame(db_session: AsyncSession) -> None:
    """A friend's row wears their equipped identity — title included, not just the frame.

    The friends podium renders the same seats as the global one, so anything the global field
    exposes about a player's earned identity has to come down this path too. `equipped_title` was
    missing here while `equipped_frame` was present, which silently blanked titles on the Friends
    tab only.
    """
    me = await _user(db_session, "me")
    mate = await _user(db_session, "mate")
    await _befriend(db_session, me, mate)

    mate_profile = await db_session.get(Profile, mate.id)
    mate_profile.equipped_title = "champion"
    mate_profile.equipped_frame = "gold_crown"
    await db_session.flush()

    window = await _open_window(db_session)
    await _submit_entry(db_session, window, mate, 900)
    await _submit_entry(db_session, window, me, 100)

    board = await friends_board(db_session, window.id, me.id)
    top = next(r for r in board.played if r.user_id == mate.id)
    assert top.equipped_title == "champion"
    assert top.equipped_frame == "gold_crown"
    # A player wearing nothing stays null rather than becoming a blank string.
    mine = next(r for r in board.played if r.user_id == me.id)
    assert mine.equipped_title is None
