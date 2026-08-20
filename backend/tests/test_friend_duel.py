"""Live friend duel — challenge lifecycle (REST) + the head-to-head round resolution (service).

The WebSocket is a thin transport over services/friend_duel.py, so the authority is tested by
driving the service directly: two friends, a shared seeded set, each round resolves only once BOTH
have answered. `client` registers users; `db_session` drives the services in the same transaction.
"""

from __future__ import annotations

import uuid

import pytest
from app.models import DuelUserStats, FriendDuel, User
from app.services.friend_duel import (
    DuelAlreadyExistsError,
    FriendDuelError,
    FriendDuelSequenceError,
    create_challenge,
    respond_challenge,
    submit_answer,
)
from app.services.friends import respond_friend_request, send_friend_request
from content.loader import load_trivia
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


async def _make_friends(
    session: AsyncSession, a_id: uuid.UUID, b_id: uuid.UUID, b_username: str
) -> None:
    fr = await send_friend_request(session, a_id, b_username)
    await respond_friend_request(session, b_id, fr.id, True)


def _correct_index(duel: FriendDuel, idx: int) -> int:
    for row in duel.server_answers:
        if row["idx"] == idx:
            return int(row["server_answer"]["correctIndex"])
    raise AssertionError(f"no server answer for idx {idx}")


async def test_challenge_non_friend_rejected(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    a = await _register(client, "fd_nf1@example.com", "nf1")
    await _register(client, "fd_nf2@example.com", "nf2")
    r = await client.post("/friend-duels", json={"username": "nf2"}, headers=_auth(a))
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == "not_friends"


async def test_challenge_create_respond_over_api(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    a = await _register(client, "fd_c1@example.com", "chal")
    b = await _register(client, "fd_c2@example.com", "opp")
    a_id = await _uid(db_session, "fd_c1@example.com")
    b_id = await _uid(db_session, "fd_c2@example.com")
    await _make_friends(db_session, a_id, b_id, "opp")
    await db_session.flush()

    created = await client.post("/friend-duels", json={"username": "opp"}, headers=_auth(a))
    assert created.status_code == 200, created.text
    assert created.json()["status"] == "pending"
    duel_id = created.json()["duel_id"]

    # opponent sees it incoming, challenger sees it outgoing.
    opp_list = (await client.get("/friend-duels", headers=_auth(b))).json()
    assert len(opp_list["incoming"]) == 1
    assert opp_list["incoming"][0]["opponent_username"] == "chal"
    chal_list = (await client.get("/friend-duels", headers=_auth(a))).json()
    assert len(chal_list["outgoing"]) == 1

    # opponent accepts → active.
    acc = await client.post(
        f"/friend-duels/{duel_id}/respond", json={"accept": True}, headers=_auth(b)
    )
    assert acc.status_code == 200, acc.text
    assert acc.json()["status"] == "active"

    state = (await client.get(f"/friend-duels/{duel_id}", headers=_auth(a))).json()
    assert state["status"] == "active"
    assert len(state["rounds"]) == 10
    for rnd in state["rounds"]:
        assert "correctIndex" not in rnd["client_spec"]  # answers never reach a client


async def test_one_open_duel_per_pair(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    await _register(client, "fd_o1@example.com", "open1")
    await _register(client, "fd_o2@example.com", "open2")
    a_id = await _uid(db_session, "fd_o1@example.com")
    b_id = await _uid(db_session, "fd_o2@example.com")
    await _make_friends(db_session, a_id, b_id, "open2")
    await create_challenge(db_session, a_id, "open2")
    with pytest.raises(DuelAlreadyExistsError):
        await create_challenge(db_session, a_id, "open2")


async def test_full_live_match_challenger_sweeps(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    tok_a = await _register(client, "fd_f1@example.com", "win1")
    tok_b = await _register(client, "fd_f2@example.com", "win2")
    a_id = await _uid(db_session, "fd_f1@example.com")
    b_id = await _uid(db_session, "fd_f2@example.com")
    await _make_friends(db_session, a_id, b_id, "win2")

    duel = await create_challenge(db_session, a_id, "win2")
    await respond_challenge(db_session, b_id, duel.id, True)

    final = None
    for idx in range(4):
        ci = _correct_index(duel, idx)
        # Challenger answers correctly; before the opponent answers, the round is unresolved.
        first = await submit_answer(
            db_session, a_id, duel.id, idx, {"choice": ci, "elapsed_ms": 1000}
        )
        assert first.resolved is False
        # Opponent answers WRONG → round resolves as a challenger win.
        second = await submit_answer(
            db_session, b_id, duel.id, idx, {"choice": (ci + 1) % 4, "elapsed_ms": 1000}
        )
        assert second.resolved is True
        assert second.outcome == "challenger_win"
        assert second.outcome_reason == "correct_vs_wrong"
        assert second.challenger_round_wins == idx + 1
        assert "correctIndex" in second.answer
        final = second

    assert final is not None and final.finished is True
    assert final.winner_side == "challenger"
    assert final.result_reason == "first_to_4"
    assert final.challenger_result is not None and final.challenger_result.won is True
    assert final.challenger_result.perfect is True  # 4-0 sweep, all correct
    assert final.opponent_result is not None and final.opponent_result.won is False

    # Both players' training stats rolled up (free duel → training counters, no Gems).
    chal_stats = await db_session.get(DuelUserStats, a_id)
    opp_stats = await db_session.get(DuelUserStats, b_id)
    assert chal_stats is not None and chal_stats.training_wins == 1 and chal_stats.perfect_wins == 1
    assert chal_stats.duel_xp > 0
    assert opp_stats is not None and opp_stats.training_losses == 1

    # Head-to-head score: the friends list reflects the completed duel for both sides.
    a_friends = (await client.get("/friends", headers=_auth(tok_a))).json()["friends"]
    b_friends = (await client.get("/friends", headers=_auth(tok_b))).json()["friends"]
    assert a_friends[0]["wins"] == 1 and a_friends[0]["losses"] == 0
    assert b_friends[0]["wins"] == 0 and b_friends[0]["losses"] == 1

    # The duel is completed; a further answer is rejected.
    with pytest.raises(FriendDuelError):
        await submit_answer(db_session, a_id, duel.id, 4, {"choice": 0, "elapsed_ms": 1000})


async def test_resubmit_same_round_waits(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    await _register(client, "fd_r1@example.com", "rep1")
    await _register(client, "fd_r2@example.com", "rep2")
    a_id = await _uid(db_session, "fd_r1@example.com")
    b_id = await _uid(db_session, "fd_r2@example.com")
    await _make_friends(db_session, a_id, b_id, "rep2")
    duel = await create_challenge(db_session, a_id, "rep2")
    await respond_challenge(db_session, b_id, duel.id, True)

    ci = _correct_index(duel, 0)
    r1 = await submit_answer(db_session, a_id, duel.id, 0, {"choice": ci, "elapsed_ms": 1000})
    assert r1.resolved is False
    # Re-sending the same round (idempotent) still just waits — no double submission, no advance.
    r2 = await submit_answer(db_session, a_id, duel.id, 0, {"choice": ci, "elapsed_ms": 1000})
    assert r2.resolved is False
    assert duel.current_round == 0

    # Answering a future round before the current one resolves is rejected.
    with pytest.raises(FriendDuelSequenceError):
        await submit_answer(db_session, a_id, duel.id, 1, {"choice": ci, "elapsed_ms": 1000})


async def test_friend_duel_answer_feeds_both_brain_models(db_session: AsyncSession) -> None:
    from app.models import QuestionInteractionEvent
    from sqlalchemy import select as sa_select

    await load_trivia(db_session)

    # Use the same setup pattern as test_full_live_match_challenger_sweeps but with a client-free
    # service-only approach (no HTTP client needed — same as test_resubmit_same_round_waits).
    challenger_id = (
        await db_session.execute(select(User).where(User.email == "fd_brain_c@example.com"))
    ).scalar_one_or_none()

    # Register two users via direct model insertion (mirrors service-only tests).
    from app.services.registration import register_user

    challenger_user = await register_user(
        db_session, "fd_brain_c@example.com", "brain_chal", "super-secret-pw"
    )
    opponent_user = await register_user(
        db_session, "fd_brain_o@example.com", "brain_opp", "super-secret-pw"
    )
    challenger_id = challenger_user.id
    opponent_id = opponent_user.id

    await _make_friends(db_session, challenger_id, opponent_id, "brain_opp")
    duel = await create_challenge(db_session, challenger_id, "brain_opp")
    await respond_challenge(db_session, opponent_id, duel.id, True)

    ci = _correct_index(duel, 0)
    await submit_answer(db_session, challenger_id, duel.id, 0, {"choice": ci, "elapsed_ms": 1000})
    await submit_answer(db_session, opponent_id, duel.id, 0, {"choice": ci, "elapsed_ms": 1000})

    for uid in (challenger_id, opponent_id):
        events = (
            (
                await db_session.execute(
                    sa_select(QuestionInteractionEvent).where(
                        QuestionInteractionEvent.user_id == uid
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(events) == 1, f"expected 1 event for user {uid}, got {len(events)}"
        assert events[0].mode == "friend_duel"
