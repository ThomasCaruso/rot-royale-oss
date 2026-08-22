"""Live friend-duel service (the social layer, now in scope).

A friend duel is a LIVE best-of-7 trivia match between two real humans who are friends: challenger
vs opponent, same shared seeded question set, played in real time over a WebSocket
(app/api/friend_duel.py). It is free (no Gems/stakes) and rolls into the same DuelUserStats training
counters as a bot training duel.

Lifecycle: create_challenge (pending) → respond_challenge (active) → both clients submit each
round's answer. A round RESOLVES only when BOTH players have answered it; resolution adjudicates the
head-to-head exactly like the bot duel (knowledge first, speed breaks a clear both-correct tie),
advances the match, and finalizes when decided. All answers are scored by the canonical
module.score() — the server is the only authority; client-sent correctness/scores are never trusted.

State is DB-backed (friend_duel_submissions records a single player's answer before the opponent
answers) so a reconnect never loses progress. The pure rules live in services/duel_logic.py and are
reused verbatim; this module owns the storage + the two-human orchestration.
"""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from content.loader import fetch_bank
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import (
    DUEL_NORMAL_ROUNDS,
    DUEL_ROUNDS_TO_WIN,
    DUEL_TOTAL_ROUNDS,
    FRIEND_DUEL_CHALLENGE_EXPIRY_MINUTES,
    FRIEND_DUEL_PLAY_EXPIRY_MINUTES,
)
from app.core.timezone import ET
from app.models import (
    FriendDuel,
    FriendDuelRound,
    FriendDuelSubmission,
    Profile,
)
from app.modules.base import GenerationContext
from app.modules.registry import get_module
from app.services.duel import _get_or_create_stats  # training-style stats roll-up reuse
from app.services.duel_logic import (
    final_tiebreak,
    is_comeback_win,
    is_perfect_win,
    match_decision,
    round_outcome,
    tier_for_xp,
    time_frac_to_ms,
    xp_for_result,
)
from app.services.engine import build_round_set
from app.services.friends import are_friends
from app.services.taste_profile import question_id_from_server_answer, record_answer_signal
from app.services.templates import DUEL_BO7

# Statuses a duel is in BEFORE it terminates (one live duel per friend pair at a time).
_OPEN_STATUSES = ("pending", "active")


# ---------------- errors ----------------
class FriendDuelError(Exception):
    """Base for friend-duel failures."""


class NotFriendsError(FriendDuelError):
    """You can only challenge an accepted friend."""


class CannotDuelSelfError(FriendDuelError):
    """A player cannot challenge themselves."""


class DuelAlreadyExistsError(FriendDuelError):
    """An open (pending/active) duel between these two already exists."""


class FriendDuelNotFoundError(FriendDuelError):
    """No such duel for this user."""


class ChallengeNotRespondableError(FriendDuelError):
    """The challenge is not a pending one addressed to this user."""


class FriendDuelStateError(FriendDuelError):
    """The duel is not active (not accepted yet, or already finished)."""


class FriendDuelSequenceError(FriendDuelError):
    """Wrong / out-of-order round idx for this duel."""


# ---------------- dataclasses ----------------
@dataclass
class FriendDuelSummary:
    duel_id: uuid.UUID
    status: str
    your_side: str  # challenger|opponent
    opponent_id: uuid.UUID
    opponent_username: str
    opponent_avatar: str
    challenger_round_wins: int
    opponent_round_wins: int
    created_at: datetime


@dataclass
class FriendDuelList:
    incoming: list[FriendDuelSummary]  # challenges others sent ME (I can accept/decline)
    outgoing: list[FriendDuelSummary]  # challenges I sent (awaiting their response)
    active: list[FriendDuelSummary]  # accepted, in-progress


@dataclass
class FriendDuelSideResult:
    won: bool
    perfect: bool
    comeback: bool
    xp_awarded: int
    duel_tier: str


@dataclass
class FriendDuelRoundResolution:
    """The outcome of one submitted answer. When `resolved` is False the opponent has not answered
    this round yet (the submitter just waits). When True the round adjudicated head-to-head."""

    resolved: bool
    idx: int
    phase: str  # normal|sudden_death
    # populated only when resolved:
    outcome: str | None = None  # challenger_win|opponent_win|no_point
    outcome_reason: str | None = None
    challenger_correct: bool = False
    challenger_time_ms: int = 0
    challenger_answer: int | None = None
    opponent_correct: bool = False
    opponent_time_ms: int = 0
    opponent_answer: int | None = None
    challenger_round_wins: int = 0
    opponent_round_wins: int = 0
    answer: dict[str, Any] | None = None  # server answer (carries correctIndex — safe post-resolve)
    next: str = "normal"  # normal|sudden_death|done
    finished: bool = False
    winner_side: str | None = None  # challenger|opponent
    result_reason: str | None = None
    challenger_result: FriendDuelSideResult | None = None
    opponent_result: FriendDuelSideResult | None = None


# ---------------- helpers ----------------
def _et_date(now: datetime) -> date:
    return now.astimezone(ET).date()


def _side(duel: FriendDuel, user_id: uuid.UUID) -> str:
    return "challenger" if duel.challenger_id == user_id else "opponent"


async def _open_duel_between(
    session: AsyncSession, a: uuid.UUID, b: uuid.UUID
) -> FriendDuel | None:
    return (
        await session.execute(
            select(FriendDuel).where(
                FriendDuel.status.in_(_OPEN_STATUSES),
                or_(
                    and_(FriendDuel.challenger_id == a, FriendDuel.opponent_id == b),
                    and_(FriendDuel.challenger_id == b, FriendDuel.opponent_id == a),
                ),
            )
        )
    ).scalar_one_or_none()


async def get_friend_duel(
    session: AsyncSession, user_id: uuid.UUID, duel_id: uuid.UUID
) -> FriendDuel:
    """Load a duel the user is a participant in (or raise FriendDuelNotFoundError)."""
    duel = await session.get(FriendDuel, duel_id)
    if duel is None or user_id not in (duel.challenger_id, duel.opponent_id):
        raise FriendDuelNotFoundError()
    return duel


def _server_answer_for(duel: FriendDuel, idx: int) -> dict[str, Any] | None:
    for row in duel.server_answers:
        if row["idx"] == idx:
            return row
    return None


# ---------------- create / respond ----------------
async def create_challenge(
    session: AsyncSession,
    challenger_id: uuid.UUID,
    username: str,
    now: datetime | None = None,
    locale: str = "en",
) -> FriendDuel:
    """Challenge a friend (by username) to a live duel. Builds the shared seeded question set + the
    server-only answer copy and opens a PENDING duel the friend must accept. One open duel per pair.

    `locale` is the CHALLENGER's language, and both duellists get that one set. This is deliberate:
    a live duel is decided partly on answer SPEED, so the two players must read a byte-identical
    question — serving each their own translation would make the matchup turn on which rendering
    happened to be shorter or clearer. Fairness beats per-player preference here.
    """
    now = now or datetime.now(UTC)

    from app.services.friends import _profile_by_username  # local import: avoid a cycle at load

    target = await _profile_by_username(session, username)
    if target is None:
        from app.services.friends import UserNotFoundError

        raise UserNotFoundError(username)
    opponent_id = target.user_id
    if opponent_id == challenger_id:
        raise CannotDuelSelfError()
    if not await are_friends(session, challenger_id, opponent_id):
        raise NotFriendsError()
    if await _open_duel_between(session, challenger_id, opponent_id) is not None:
        raise DuelAlreadyExistsError()

    seed = secrets.randbits(63)
    bank = await fetch_bank(session, "trivia", locale=locale)
    ctx = GenerationContext(bank=bank, seed=seed)
    rounds = build_round_set(seed, DUEL_BO7, ctx)

    duel = FriendDuel(
        challenger_id=challenger_id,
        opponent_id=opponent_id,
        status="pending",
        seed=seed,
        round_set=[
            {"idx": r.idx, "type": r.module_type, "client_spec": r.client_spec} for r in rounds
        ],
        server_answers=[
            {"idx": r.idx, "module_type": r.module_type, "server_answer": r.server_answer}
            for r in rounds
        ],
        current_round=0,
        contest_date=_et_date(now),
        expires_at=now + timedelta(minutes=FRIEND_DUEL_CHALLENGE_EXPIRY_MINUTES),
        updated_at=now,
    )
    session.add(duel)
    await session.flush()
    return duel


async def respond_challenge(
    session: AsyncSession,
    user_id: uuid.UUID,
    duel_id: uuid.UUID,
    accept: bool,
    now: datetime | None = None,
) -> FriendDuel:
    """The opponent accepts (→ active) or declines a pending challenge."""
    now = now or datetime.now(UTC)
    duel = await session.get(FriendDuel, duel_id)
    if duel is None or duel.opponent_id != user_id or duel.status != "pending":
        raise ChallengeNotRespondableError()
    if accept:
        duel.status = "active"
        duel.accepted_at = now
        duel.expires_at = now + timedelta(minutes=FRIEND_DUEL_PLAY_EXPIRY_MINUTES)
    else:
        duel.status = "declined"
        duel.completed_at = now
    duel.updated_at = now
    await session.flush()
    return duel


async def cancel_challenge(
    session: AsyncSession, user_id: uuid.UUID, duel_id: uuid.UUID, now: datetime | None = None
) -> FriendDuel:
    """The challenger cancels their own still-pending challenge."""
    now = now or datetime.now(UTC)
    duel = await session.get(FriendDuel, duel_id)
    if duel is None or duel.challenger_id != user_id or duel.status != "pending":
        raise ChallengeNotRespondableError()
    duel.status = "cancelled"
    duel.completed_at = now
    duel.updated_at = now
    await session.flush()
    return duel


# ---------------- listing ----------------
async def list_friend_duels(session: AsyncSession, user_id: uuid.UUID) -> FriendDuelList:
    """All of a user's open duels: incoming challenges, outgoing challenges, and active matches."""
    duels = (
        (
            await session.execute(
                select(FriendDuel).where(
                    FriendDuel.status.in_(_OPEN_STATUSES),
                    or_(
                        FriendDuel.challenger_id == user_id,
                        FriendDuel.opponent_id == user_id,
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    other_ids = [d.opponent_id if d.challenger_id == user_id else d.challenger_id for d in duels]
    profiles: dict[uuid.UUID, Profile] = {}
    if other_ids:
        rows = (
            await session.execute(select(Profile).where(Profile.user_id.in_(other_ids)))
        ).scalars()
        profiles = {p.user_id: p for p in rows}

    incoming: list[FriendDuelSummary] = []
    outgoing: list[FriendDuelSummary] = []
    active: list[FriendDuelSummary] = []
    for d in duels:
        side = _side(d, user_id)
        other_id = d.opponent_id if side == "challenger" else d.challenger_id
        prof = profiles.get(other_id)
        summary = FriendDuelSummary(
            duel_id=d.id,
            status=d.status,
            your_side=side,
            opponent_id=other_id,
            opponent_username=prof.username if prof else "",
            opponent_avatar=prof.avatar_preset if prof else "knight",
            challenger_round_wins=d.challenger_round_wins,
            opponent_round_wins=d.opponent_round_wins,
            created_at=d.created_at,
        )
        if d.status == "active":
            active.append(summary)
        elif side == "opponent":
            incoming.append(summary)
        else:
            outgoing.append(summary)

    incoming.sort(key=lambda s: s.created_at, reverse=True)
    outgoing.sort(key=lambda s: s.created_at, reverse=True)
    active.sort(key=lambda s: s.created_at, reverse=True)
    return FriendDuelList(incoming=incoming, outgoing=outgoing, active=active)


# ---------------- round submit + resolve ----------------
async def submit_answer(
    session: AsyncSession,
    user_id: uuid.UUID,
    duel_id: uuid.UUID,
    idx: int,
    result: dict[str, Any],
    now: datetime | None = None,
) -> FriendDuelRoundResolution:
    """Record one player's answer to round `idx`. Resolves the round head-to-head once BOTH players
    have answered it. Locks the duel row so concurrent submits from the two clients serialize."""
    now = now or datetime.now(UTC)

    duel = await session.get(FriendDuel, duel_id, with_for_update=True)
    if duel is None or user_id not in (duel.challenger_id, duel.opponent_id):
        raise FriendDuelNotFoundError()
    if duel.status != "active":
        raise FriendDuelStateError()
    if idx != duel.current_round or idx >= DUEL_TOTAL_ROUNDS:
        raise FriendDuelSequenceError()

    answer_row = _server_answer_for(duel, idx)
    if answer_row is None:
        raise FriendDuelSequenceError()

    phase = "normal" if idx < DUEL_NORMAL_ROUNDS else "sudden_death"

    # Idempotent: a re-sent answer for a round this user already answered just waits (or, if the
    # round already resolved while the message was in flight, returns its resolved view).
    existing = (
        await session.execute(
            select(FriendDuelSubmission).where(
                FriendDuelSubmission.duel_id == duel_id,
                FriendDuelSubmission.round_index == idx,
                FriendDuelSubmission.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        judgement = get_module(answer_row["module_type"]).score(answer_row["server_answer"], result)
        correct = judgement.correct and judgement.valid
        session.add(
            FriendDuelSubmission(
                duel_id=duel_id,
                round_index=idx,
                user_id=user_id,
                answer=result.get("choice"),
                correct=correct,
                time_ms=time_frac_to_ms(judgement.time_frac),
            )
        )
        await session.flush()
        await record_answer_signal(
            session,
            user_id,
            question_id=question_id_from_server_answer(answer_row["server_answer"]),
            mode="friend_duel",
            is_correct=bool(correct),
            time_frac=judgement.time_frac,
            limit_ms=get_module(answer_row["module_type"]).time_limit_ms,
            streak_before=None,
            streak_after=None,
            session_id=duel_id,
            difficulty=answer_row["server_answer"].get("difficulty"),
        )

    subs = list(
        (
            await session.execute(
                select(FriendDuelSubmission).where(
                    FriendDuelSubmission.duel_id == duel_id,
                    FriendDuelSubmission.round_index == idx,
                )
            )
        )
        .scalars()
        .all()
    )
    if len(subs) < 2:
        return FriendDuelRoundResolution(resolved=False, idx=idx, phase=phase)

    # Both answered → resolve, unless a concurrent caller already wrote the round.
    already = (
        await session.execute(
            select(FriendDuelRound).where(
                FriendDuelRound.duel_id == duel_id, FriendDuelRound.round_index == idx
            )
        )
    ).scalar_one_or_none()
    if already is None:
        chal = next(s for s in subs if s.user_id == duel.challenger_id)
        opp = next(s for s in subs if s.user_id == duel.opponent_id)
        raw_outcome, reason = round_outcome(chal.correct, chal.time_ms, opp.correct, opp.time_ms)
        outcome = {
            "user_win": "challenger_win",
            "rival_win": "opponent_win",
            "no_point": "no_point",
        }[raw_outcome]
        if outcome == "challenger_win":
            duel.challenger_round_wins += 1
        elif outcome == "opponent_win":
            duel.opponent_round_wins += 1
        session.add(
            FriendDuelRound(
                duel_id=duel_id,
                round_index=idx,
                phase=phase,
                challenger_answer=chal.answer,
                challenger_correct=chal.correct,
                challenger_time_ms=chal.time_ms,
                opponent_answer=opp.answer,
                opponent_correct=opp.correct,
                opponent_time_ms=opp.time_ms,
                outcome=outcome,
                outcome_reason=reason,
            )
        )
        duel.current_round = idx + 1
        duel.updated_at = now
        await session.flush()
    else:
        outcome, reason = already.outcome, already.outcome_reason
        chal = next(s for s in subs if s.user_id == duel.challenger_id)
        opp = next(s for s in subs if s.user_id == duel.opponent_id)

    # Decide the match.
    played_after = idx + 1
    normal_played = min(played_after, DUEL_NORMAL_ROUNDS)
    sd_played = max(0, played_after - DUEL_NORMAL_ROUNDS)
    status, decided = match_decision(
        duel.challenger_round_wins, duel.opponent_round_wins, normal_played, sd_played
    )

    res = FriendDuelRoundResolution(
        resolved=True,
        idx=idx,
        phase=phase,
        outcome=outcome,
        outcome_reason=reason,
        challenger_correct=chal.correct,
        challenger_time_ms=chal.time_ms,
        challenger_answer=chal.answer,
        opponent_correct=opp.correct,
        opponent_time_ms=opp.time_ms,
        opponent_answer=opp.answer,
        challenger_round_wins=duel.challenger_round_wins,
        opponent_round_wins=duel.opponent_round_wins,
        answer=answer_row["server_answer"],
    )

    if status == "done":
        if sd_played > 0:
            rr = "sudden_death"
        elif (
            duel.challenger_round_wins >= DUEL_ROUNDS_TO_WIN
            or duel.opponent_round_wins >= DUEL_ROUNDS_TO_WIN
        ):
            rr = "first_to_4"
        else:
            rr = "higher_round_wins"
        winner_side = "challenger" if decided == "user" else "opponent"
        await _finalize(session, duel, winner_side, rr, now, res)
        res.next, res.finished = "done", True
    elif status == "tiebreak":
        rounds = await _duel_rounds(session, duel_id)
        tb_winner, tb_reason = final_tiebreak(
            [r.challenger_time_ms for r in rounds if r.challenger_correct],
            [r.opponent_time_ms for r in rounds if r.opponent_correct],
            duel.seed,
        )
        winner_side = "challenger" if tb_winner == "user" else "opponent"
        await _finalize(session, duel, winner_side, tb_reason, now, res)
        res.next, res.finished = "done", True
    elif status == "sudden_death":
        res.next = "sudden_death"
    else:
        res.next = "normal"

    await session.flush()
    return res


async def _duel_rounds(session: AsyncSession, duel_id: uuid.UUID) -> list[FriendDuelRound]:
    return list(
        (
            await session.execute(
                select(FriendDuelRound)
                .where(FriendDuelRound.duel_id == duel_id)
                .order_by(FriendDuelRound.round_index)
            )
        )
        .scalars()
        .all()
    )


async def _apply_stats(
    session: AsyncSession,
    user_id: uuid.UUID,
    won: bool,
    perfect: bool,
    comeback: bool,
    now: datetime,
) -> FriendDuelSideResult:
    """Roll a finished friend duel into the user's DuelUserStats — training-style (free, no Gems):
    training_wins/losses + duel XP/tier + the perfect/comeback honor counters."""
    stats = await _get_or_create_stats(session, user_id)
    if won:
        stats.training_wins += 1
    else:
        stats.training_losses += 1
    if perfect:
        stats.perfect_wins += 1
    if comeback:
        stats.comeback_wins += 1
    xp = xp_for_result("training", won, perfect=perfect, comeback=comeback)
    stats.duel_xp += xp
    stats.duel_tier = tier_for_xp(stats.duel_xp)
    stats.updated_at = now
    return FriendDuelSideResult(
        won=won, perfect=perfect, comeback=comeback, xp_awarded=xp, duel_tier=stats.duel_tier
    )


async def _finalize(
    session: AsyncSession,
    duel: FriendDuel,
    winner_side: str,
    result_reason: str,
    now: datetime,
    res: FriendDuelRoundResolution,
) -> None:
    """Settle a decided duel: stamp the winner, roll BOTH players' training stats, and attach each
    side's result to the resolution. Idempotent — a completed duel is left untouched."""
    if duel.status == "completed":
        return

    rounds = await _duel_rounds(session, duel.id)
    chal_corrects = [r.challenger_correct for r in rounds]
    opp_corrects = [r.opponent_correct for r in rounds]

    cw = ow = 0
    max_opp_lead = max_chal_lead = 0
    for r in rounds:
        if r.outcome == "challenger_win":
            cw += 1
        elif r.outcome == "opponent_win":
            ow += 1
        max_opp_lead = max(max_opp_lead, ow - cw)
        max_chal_lead = max(max_chal_lead, cw - ow)

    chal_won = winner_side == "challenger"
    chal_perfect = is_perfect_win(
        "user" if chal_won else None, duel.opponent_round_wins, chal_corrects
    )
    chal_comeback = is_comeback_win("user" if chal_won else None, max_opp_lead)
    opp_perfect = is_perfect_win(
        "user" if not chal_won else None, duel.challenger_round_wins, opp_corrects
    )
    opp_comeback = is_comeback_win("user" if not chal_won else None, max_chal_lead)

    res.challenger_result = await _apply_stats(
        session, duel.challenger_id, chal_won, chal_perfect, chal_comeback, now
    )
    res.opponent_result = await _apply_stats(
        session, duel.opponent_id, not chal_won, opp_perfect, opp_comeback, now
    )

    duel.winner_side = winner_side
    duel.result_reason = result_reason
    duel.status = "completed"
    duel.completed_at = now
    duel.updated_at = now
    res.winner_side = winner_side
    res.result_reason = result_reason
    await session.flush()


# ---------------- expiry cleanup ----------------
async def expire_stale_friend_duels(session: AsyncSession, now: datetime | None = None) -> int:
    """Expire challenges never accepted and accepted-but-unfinished live duels past their deadline.
    No winner, no stats — an expired duel simply closes (so a half-played match never lingers)."""
    now = now or datetime.now(UTC)
    duels = (
        (
            await session.execute(
                select(FriendDuel).where(
                    FriendDuel.status.in_(_OPEN_STATUSES),
                    FriendDuel.expires_at.is_not(None),
                    FriendDuel.expires_at <= now,
                )
            )
        )
        .scalars()
        .all()
    )
    for duel in duels:
        duel.status = "expired"
        duel.completed_at = now
        duel.updated_at = now
    await session.flush()
    return len(duels)
