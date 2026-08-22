"""Live friend-duel endpoints (the social layer, now in scope).

REST covers the challenge lifecycle (create / list / respond / cancel / state); the WebSocket at
`/ws/friend-duel/{duel_id}` is the live transport for play. The WS handler is THIN — every bit of
authority (scoring, adjudication, finalize) lives in services/friend_duel.py; the socket only routes
messages and pushes the resolved outcome to both connected participants.

Protocol (JSON both ways):
  client → server:  {type:"answer", idx, result:{choice, elapsed_ms}}  ·  {type:"ping"}
  server → client:  {type:"state", …}                 — on connect (your side, scores, specs)
                    {type:"answer_ack", idx}           — your answer recorded; waiting on opponent
                    {type:"opponent_answered", idx}    — your opponent locked in their answer
                    {type:"round_result", …}           — both answered; the head-to-head outcome
                    {type:"opponent_joined"/"opponent_left"}  — presence
                    {type:"error", code}               — a rejected message (bad idx / not active)

Detail strings (REST) and `code` (WS) are machine-readable codes the frontend switches on.
"""

from __future__ import annotations

import uuid
from typing import Any

import jwt
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_locale
from app.core.db import SessionLocal, get_session
from app.core.security import decode_token
from app.models import FriendDuel, Profile, User
from app.schemas.social import (
    FriendDuelCreate,
    FriendDuelListResponse,
    FriendDuelRespondRequest,
    FriendDuelStateResponse,
    FriendDuelSummaryOut,
)
from app.services.friend_duel import (
    CannotDuelSelfError,
    ChallengeNotRespondableError,
    DuelAlreadyExistsError,
    FriendDuelNotFoundError,
    FriendDuelRoundResolution,
    FriendDuelSequenceError,
    FriendDuelStateError,
    NotFriendsError,
    cancel_challenge,
    create_challenge,
    get_friend_duel,
    list_friend_duels,
    respond_challenge,
    submit_answer,
)
from app.services.friends import UserNotFoundError

router = APIRouter(prefix="/friend-duels", tags=["friend-duels"])


# ==================== REST ====================
@router.post("", response_model=FriendDuelSummaryOut)
async def create(
    body: FriendDuelCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    locale: str = Depends(get_locale),
) -> FriendDuelSummaryOut:
    """Challenge a friend (by username) to a live duel. They must accept before play opens."""
    try:
        duel = await create_challenge(session, user.id, body.username, locale=locale)
    except UserNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user_not_found") from exc
    except CannotDuelSelfError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot_duel_self") from exc
    except NotFriendsError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not_friends") from exc
    except DuelAlreadyExistsError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "duel_already_exists") from exc

    opp = await session.get(Profile, duel.opponent_id)
    return FriendDuelSummaryOut(
        duel_id=duel.id,
        status=duel.status,
        your_side="challenger",
        opponent_id=duel.opponent_id,
        opponent_username=opp.username if opp else "",
        opponent_avatar=opp.avatar_preset if opp else "knight",
        challenger_round_wins=duel.challenger_round_wins,
        opponent_round_wins=duel.opponent_round_wins,
        created_at=duel.created_at,
    )


@router.get("", response_model=FriendDuelListResponse)
async def list_duels(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FriendDuelListResponse:
    """All of the user's open duels: incoming/outgoing challenges + active matches."""
    data = await list_friend_duels(session, user.id)
    return FriendDuelListResponse(
        incoming=[FriendDuelSummaryOut(**vars(s)) for s in data.incoming],
        outgoing=[FriendDuelSummaryOut(**vars(s)) for s in data.outgoing],
        active=[FriendDuelSummaryOut(**vars(s)) for s in data.active],
    )


@router.post("/{duel_id}/respond", response_model=FriendDuelSummaryOut)
async def respond(
    duel_id: uuid.UUID,
    body: FriendDuelRespondRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FriendDuelSummaryOut:
    """Accept (→ active, play opens) or decline a pending challenge addressed to you."""
    try:
        duel = await respond_challenge(session, user.id, duel_id, body.accept)
    except ChallengeNotRespondableError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "challenge_not_found") from exc
    opp = await session.get(Profile, duel.challenger_id)
    return FriendDuelSummaryOut(
        duel_id=duel.id,
        status=duel.status,
        your_side="opponent",
        opponent_id=duel.challenger_id,
        opponent_username=opp.username if opp else "",
        opponent_avatar=opp.avatar_preset if opp else "knight",
        challenger_round_wins=duel.challenger_round_wins,
        opponent_round_wins=duel.opponent_round_wins,
        created_at=duel.created_at,
    )


@router.post("/{duel_id}/cancel", response_model=FriendDuelSummaryOut)
async def cancel(
    duel_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FriendDuelSummaryOut:
    """The challenger withdraws their own still-pending challenge."""
    try:
        duel = await cancel_challenge(session, user.id, duel_id)
    except ChallengeNotRespondableError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "challenge_not_found") from exc
    opp = await session.get(Profile, duel.opponent_id)
    return FriendDuelSummaryOut(
        duel_id=duel.id,
        status=duel.status,
        your_side="challenger",
        opponent_id=duel.opponent_id,
        opponent_username=opp.username if opp else "",
        opponent_avatar=opp.avatar_preset if opp else "knight",
        challenger_round_wins=duel.challenger_round_wins,
        opponent_round_wins=duel.opponent_round_wins,
        created_at=duel.created_at,
    )


@router.get("/{duel_id}", response_model=FriendDuelStateResponse)
async def duel_state(
    duel_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FriendDuelStateResponse:
    """Current state of a duel the user is in (resume / view result). Answer-free specs only."""
    try:
        duel = await get_friend_duel(session, user.id, duel_id)
    except FriendDuelNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "duel_not_found") from exc
    side = "challenger" if duel.challenger_id == user.id else "opponent"
    other_id = duel.opponent_id if side == "challenger" else duel.challenger_id
    opp = await session.get(Profile, other_id)
    return FriendDuelStateResponse(
        duel_id=duel.id,
        status=duel.status,
        your_side=side,
        opponent_username=opp.username if opp else "",
        opponent_avatar=opp.avatar_preset if opp else "knight",
        current_round=duel.current_round,
        challenger_round_wins=duel.challenger_round_wins,
        opponent_round_wins=duel.opponent_round_wins,
        winner_side=duel.winner_side,
        result_reason=duel.result_reason,
        rounds=list(duel.round_set),
    )


# ==================== live WebSocket ====================
class LiveDuelHub:
    """In-process registry of connected WebSockets per duel. Single-threaded asyncio, so plain dicts
    are safe. One socket per (duel, user) — a reconnect supersedes the prior socket."""

    def __init__(self) -> None:
        self._rooms: dict[str, dict[str, WebSocket]] = {}

    async def join(self, duel_id: str, user_id: str, ws: WebSocket) -> None:
        room = self._rooms.setdefault(duel_id, {})
        old = room.get(user_id)
        room[user_id] = ws
        if old is not None and old is not ws:
            try:
                await old.close(code=4408)  # superseded by a newer connection
            except Exception:
                pass

    def leave(self, duel_id: str, user_id: str, ws: WebSocket) -> None:
        room = self._rooms.get(duel_id)
        if room is None:
            return
        if room.get(user_id) is ws:
            del room[user_id]
        if not room:
            self._rooms.pop(duel_id, None)

    def is_online(self, duel_id: str, user_id: str) -> bool:
        return user_id in self._rooms.get(duel_id, {})

    async def send_to(self, duel_id: str, user_id: str, message: dict[str, Any]) -> None:
        ws = self._rooms.get(duel_id, {}).get(user_id)
        if ws is None:
            return
        try:
            await ws.send_json(message)
        except Exception:
            pass


hub = LiveDuelHub()


def _personalize(res: FriendDuelRoundResolution, side: str) -> dict[str, Any]:
    """Frame a resolved round from one side's point of view (your_* vs opp_*)."""
    if side == "challenger":
        your_correct, your_time, your_answer = (
            res.challenger_correct,
            res.challenger_time_ms,
            res.challenger_answer,
        )
        opp_correct, opp_time, opp_answer = (
            res.opponent_correct,
            res.opponent_time_ms,
            res.opponent_answer,
        )
        your_wins, opp_wins = res.challenger_round_wins, res.opponent_round_wins
        side_result = res.challenger_result
        you_won = res.outcome == "challenger_win"
        opp_won = res.outcome == "opponent_win"
    else:
        your_correct, your_time, your_answer = (
            res.opponent_correct,
            res.opponent_time_ms,
            res.opponent_answer,
        )
        opp_correct, opp_time, opp_answer = (
            res.challenger_correct,
            res.challenger_time_ms,
            res.challenger_answer,
        )
        your_wins, opp_wins = res.opponent_round_wins, res.challenger_round_wins
        side_result = res.opponent_result
        you_won = res.outcome == "opponent_win"
        opp_won = res.outcome == "challenger_win"

    outcome = "you_win" if you_won else "opp_win" if opp_won else "no_point"
    result = (
        {
            "won": side_result.won,
            "perfect": side_result.perfect,
            "comeback": side_result.comeback,
            "xp_awarded": side_result.xp_awarded,
            "duel_tier": side_result.duel_tier,
            "winner_side": res.winner_side,
            "result_reason": res.result_reason,
            "your_side": side,
        }
        if res.finished and side_result is not None
        else None
    )
    return {
        "type": "round_result",
        "idx": res.idx,
        "phase": res.phase,
        "outcome": outcome,
        "outcome_reason": res.outcome_reason,
        "your_correct": your_correct,
        "your_time_ms": your_time,
        "your_answer": your_answer,
        "opp_correct": opp_correct,
        "opp_time_ms": opp_time,
        "opp_answer": opp_answer,
        "your_round_wins": your_wins,
        "opp_round_wins": opp_wins,
        "answer": res.answer,
        "next": res.next,
        "finished": res.finished,
        "result": result,
    }


async def _authenticate_ws(websocket: WebSocket) -> uuid.UUID | None:
    """Resolve the user from the `?token=` access token, or None if missing/invalid."""
    token = websocket.query_params.get("token")
    if not token:
        return None
    try:
        claims = decode_token(token)
    except jwt.PyJWTError:
        return None
    if claims.get("type") != "access":
        return None
    try:
        return uuid.UUID(claims["sub"])
    except (KeyError, ValueError):
        return None


@router.websocket("/ws/{duel_id}")
async def live_duel_ws(websocket: WebSocket, duel_id: uuid.UUID) -> None:
    user_id = await _authenticate_ws(websocket)
    if user_id is None:
        await websocket.close(code=4401)  # unauthenticated
        return

    duel_key = str(duel_id)
    # Load participants + the answer-free round set once (these never change for a duel).
    async with SessionLocal() as session:
        duel = await session.get(FriendDuel, duel_id)
        if duel is None or user_id not in (duel.challenger_id, duel.opponent_id):
            await websocket.close(code=4404)  # not your duel
            return
        if duel.status not in ("active", "completed"):
            await websocket.close(code=4409)  # not accepted yet (or already closed)
            return
        side = "challenger" if duel.challenger_id == user_id else "opponent"
        opponent_id = duel.opponent_id if side == "challenger" else duel.challenger_id
        opp = await session.get(Profile, opponent_id)
        opponent_username = opp.username if opp else ""
        opponent_avatar = opp.avatar_preset if opp else "knight"
        round_set = list(duel.round_set)

    await websocket.accept()
    uid, oid = str(user_id), str(opponent_id)
    await hub.join(duel_key, uid, websocket)

    # Initial state snapshot.
    await websocket.send_json(
        {
            "type": "state",
            "duel_id": duel_key,
            "you": side,
            "status": duel.status,
            "current_round": duel.current_round,
            "your_round_wins": duel.challenger_round_wins
            if side == "challenger"
            else duel.opponent_round_wins,
            "opp_round_wins": duel.opponent_round_wins
            if side == "challenger"
            else duel.challenger_round_wins,
            "winner_side": duel.winner_side,
            "result_reason": duel.result_reason,
            "opponent_username": opponent_username,
            "opponent_avatar": opponent_avatar,
            "opponent_online": hub.is_online(duel_key, oid),
            "rounds": round_set,
        }
    )
    await hub.send_to(duel_key, oid, {"type": "opponent_joined"})

    try:
        while True:
            msg = await websocket.receive_json()
            mtype = msg.get("type")
            if mtype == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            if mtype != "answer":
                continue

            idx = msg.get("idx")
            result = msg.get("result") or {}
            if not isinstance(idx, int):
                await websocket.send_json({"type": "error", "code": "bad_message"})
                continue

            try:
                async with SessionLocal() as session:
                    res = await submit_answer(session, user_id, duel_id, idx, result)
                    await session.commit()
            except FriendDuelSequenceError:
                await websocket.send_json({"type": "error", "code": "round_out_of_order"})
                continue
            except FriendDuelStateError:
                await websocket.send_json({"type": "error", "code": "duel_not_active"})
                continue
            except FriendDuelNotFoundError:
                await websocket.send_json({"type": "error", "code": "duel_not_found"})
                continue

            if not res.resolved:
                await websocket.send_json({"type": "answer_ack", "idx": res.idx})
                await hub.send_to(duel_key, oid, {"type": "opponent_answered", "idx": res.idx})
            else:
                # Round resolved → push each participant their own framed view.
                await hub.send_to(duel_key, uid, _personalize(res, side))
                await hub.send_to(
                    duel_key,
                    oid,
                    _personalize(res, "opponent" if side == "challenger" else "challenger"),
                )
    except WebSocketDisconnect:
        pass
    finally:
        hub.leave(duel_key, uid, websocket)
        await hub.send_to(duel_key, oid, {"type": "opponent_left"})
