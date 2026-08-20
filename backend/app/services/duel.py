"""Duel config + create (Task 3.4a).

A Duel is an async best-of-7 trivia match against a server-precomputed bot rival, with an optional
Gem entry pool. The HUMAN's play reuses the contest machinery exactly like practice: a Duel is
backed by an `Entry` (window-less, `is_practice=True`) whose per-round answers live in
`RoundAnswer`, and the DuelMatch carries the head-to-head bookkeeping plus the (server-only) run.

This module covers the config surface (which tiers are unlocked, the per-day bot-gem-duel cap, the
balance) and `create_duel` (build the entry, debit the Gem entry, precompute the rival).
Adjudication and settlement land in later tasks. Server-authoritative throughout: the rival tier is
chosen server-side from the player's duel strength, the rival run never leaves the server, and the
returned round specs are answer-free.
"""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from content.loader import fetch_bank
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import (
    DUEL_BOT_GEM_CAP_PER_DAY,
    DUEL_EXPIRY_MINUTES,
    DUEL_NORMAL_ROUNDS,
    DUEL_ROUNDS_TO_WIN,
    DUEL_TOTAL_ROUNDS,
    DUEL_TYPES,
)
from app.core.timezone import ET
from app.models import DuelMatch, Entry, Profile, RoundAnswer, RoundResult
from app.models.contest import IN_PROGRESS
from app.models.duel import DuelRound, DuelUserStats
from app.modules.base import GenerationContext
from app.modules.registry import get_module
from app.services.bots import make_duel_rival
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
from app.services.gem_ledger import InsufficientGemsError, record_gem_delta
from app.services.scoring import compute_points
from app.services.taste_profile import question_id_from_server_answer, record_answer_signal
from app.services.templates import DUEL_BO7


# ---------------- errors ----------------
class DuelError(Exception):
    """Base for duel-creation failures."""


class UnknownDuelTypeError(DuelError):
    """The requested duel_type is not one of DUEL_TYPES."""

    def __init__(self, duel_type: str) -> None:
        super().__init__(f"unknown duel type {duel_type!r}")
        self.duel_type = duel_type


class DuelLockedError(DuelError):
    """The tier is not yet unlocked (the player needs more Gem-duel wins)."""

    def __init__(self, duel_type: str, wins_needed: int) -> None:
        super().__init__(f"duel type {duel_type!r} unlocks at {wins_needed} wins")
        self.duel_type = duel_type
        self.wins_needed = wins_needed


class DuelNotFoundError(DuelError):
    """No such match for this user."""


class DuelStateError(DuelError):
    """The match is not in_progress (already completed/abandoned, or never opened)."""


class DuelRoundSequenceError(DuelError):
    """Wrong / out-of-order round idx for this match."""


# ---------------- dataclasses ----------------
@dataclass
class DuelTierInfo:
    type: str
    entry_gems: int
    pool_gems: int
    unlocked: bool
    unlock_wins: int


@dataclass
class DuelConfig:
    tiers: list[DuelTierInfo]
    bot_gem_cap: int
    bot_gem_used: int
    gems_balance: int


@dataclass
class DuelCreateResult:
    match: DuelMatch
    rounds: list[dict[str, Any]]  # answer-free client specs: {idx, type, client_spec}


@dataclass
class DuelResult:
    """The final settled outcome of a duel (surfaced once, on the deciding round / cleanup)."""

    winner: str  # user|rival
    result_reason: str
    user_round_wins: int
    rival_round_wins: int
    gem_delta: int  # net gems to the user (pool win minus entry, or -entry on a loss)
    xp_awarded: int
    perfect: bool
    comeback: bool
    duel_tier: str


@dataclass
class DuelRoundReveal:
    """One duel round's post-lock reveal: the head-to-head outcome + the (now-safe) server answer.

    `result` is populated ONLY on the deciding round (when `finished` is True)."""

    idx: int
    outcome: str  # user_win|rival_win|no_point
    outcome_reason: str
    your_correct: bool
    your_time_ms: int
    answer: dict[str, Any]  # the server_answer (carries correctIndex — safe post-lock)
    rival_correct: bool
    rival_time_ms: int
    user_round_wins: int
    rival_round_wins: int
    phase: str  # normal|sudden_death
    next: str  # normal|sudden_death|done
    finished: bool
    result: DuelResult | None


# ---------------- pure tier chooser ----------------
def choose_rival_tier(duel_type: str, wins: int, losses: int) -> str:
    """Server-side rival difficulty: base index from the duel type, bumped one step for a strong
    player (so a stronger player faces a sharper rival). Never client-controlled."""
    base = {"training": 0, "spark": 1, "crown": 2, "royal": 3}.get(duel_type, 0)
    total = wins + losses
    winrate = wins / total if total else 0.0
    if total >= 5 and winrate > 0.6:
        base = min(3, base + 1)
    return ("rookie", "solid", "sharp", "elite")[base]


# ---------------- helpers ----------------
async def _get_or_create_stats(session: AsyncSession, user_id: uuid.UUID) -> DuelUserStats:
    stats = await session.get(DuelUserStats, user_id)
    if stats is None:
        stats = DuelUserStats(user_id=user_id)
        session.add(stats)
        await session.flush()
    return stats


def _et_date(now: datetime) -> date:
    return now.astimezone(ET).date()


async def get_duel(session: AsyncSession, user_id: uuid.UUID, match_id: uuid.UUID) -> DuelMatch:
    """Load a match the user owns (or raise DuelNotFoundError)."""
    match = await session.get(DuelMatch, match_id)
    if match is None or match.user_id != user_id:
        raise DuelNotFoundError()
    return match


async def duel_stats(session: AsyncSession, user_id: uuid.UUID) -> DuelUserStats:
    """The user's duel stats (get-or-create)."""
    return await _get_or_create_stats(session, user_id)


async def _bot_gem_duels_today(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> int:
    """Count this user's bot-backed GEM duels on the ET calendar date of `now` (refunded ones don't
    count toward the cap). Training (entry_gems == 0) is excluded, so it stays uncapped."""
    return (
        await session.scalar(
            select(func.count())
            .select_from(DuelMatch)
            .where(
                DuelMatch.user_id == user_id,
                DuelMatch.rival_type == "bot",
                DuelMatch.entry_gems > 0,
                DuelMatch.contest_date == _et_date(now),
                DuelMatch.status != "refunded",
            )
        )
    ) or 0


# ---------------- config ----------------
async def duel_config(
    session: AsyncSession, user_id: uuid.UUID, now: datetime | None = None
) -> DuelConfig:
    """The duel lobby surface: per-tier unlock state + the bot-gem-duel cap usage + the balance."""
    now = now or datetime.now(UTC)
    stats = await _get_or_create_stats(session, user_id)
    profile = await session.get(Profile, user_id)
    gems_balance = profile.gems_balance if profile is not None else 0

    tiers = [
        DuelTierInfo(
            type=duel_type,
            entry_gems=cfg["entry"],
            pool_gems=cfg["pool"],
            unlocked=stats.wins >= cfg["unlock_wins"],
            unlock_wins=cfg["unlock_wins"],
        )
        for duel_type, cfg in DUEL_TYPES.items()
    ]
    return DuelConfig(
        tiers=tiers,
        bot_gem_cap=DUEL_BOT_GEM_CAP_PER_DAY,
        bot_gem_used=await _bot_gem_duels_today(session, user_id, now),
        gems_balance=gems_balance,
    )


# ---------------- create ----------------
async def create_duel(
    session: AsyncSession,
    user_id: uuid.UUID,
    duel_type: str,
    now: datetime | None = None,
    locale: str = "en",
) -> DuelCreateResult:
    """Create a Duel: build the seeded play Entry (+ RoundAnswers), debit any Gem entry, precompute
    the rival run, and open the match. One transaction; never commits (the request boundary does).

    Order matters: validate → debit AFTER the match row exists (so the ledger ref_id/idempotency_key
    point at a real match) → flip to in_progress last.
    """
    now = now or datetime.now(UTC)

    if duel_type not in DUEL_TYPES:
        raise UnknownDuelTypeError(duel_type)

    stats = await _get_or_create_stats(session, user_id)
    cfg = DUEL_TYPES[duel_type]
    if stats.wins < cfg["unlock_wins"]:
        raise DuelLockedError(duel_type, cfg["unlock_wins"])

    entry_gems = cfg["entry"]
    pool_gems = cfg["pool"]
    is_gem = entry_gems > 0

    if is_gem:
        # Bot Gem duels are UNCAPPED — a player may enter as many Gem duels per day as they can
        # afford; the only gate is the Gem balance below. (The former per-ET-day cap was removed by
        # product decision; `_bot_gem_duels_today` is still surfaced as an informational counter.)
        profile = await session.get(Profile, user_id)
        if profile is None or profile.gems_balance < entry_gems:
            raise InsufficientGemsError(
                f"User {user_id} needs {entry_gems} gems to enter {duel_type!r}"
            )

    seed = secrets.randbits(63)
    contest_date = _et_date(now)
    tier = choose_rival_tier(duel_type, stats.wins, stats.losses)

    # Build the seeded play Entry + RoundAnswers (clone of practice.start_practice with DUEL_BO7).
    bank = await fetch_bank(session, "trivia", locale=locale)
    ctx = GenerationContext(bank=bank, seed=seed)
    rounds = build_round_set(seed, DUEL_BO7, ctx)

    entry = Entry(
        window_id=None,
        user_id=user_id,
        is_practice=True,
        seed=seed,
        round_set=[
            {"idx": r.idx, "type": r.module_type, "client_spec": r.client_spec} for r in rounds
        ],
        started_at=now,
        status=IN_PROGRESS,
    )
    session.add(entry)
    await session.flush()  # assign entry.id

    for r in rounds:
        session.add(
            RoundAnswer(
                entry_id=entry.id,
                idx=r.idx,
                module_type=r.module_type,
                server_answer=r.server_answer,
            )
        )
    await session.flush()

    rival_run = make_duel_rival(seed, tier, DUEL_TOTAL_ROUNDS)

    match = DuelMatch(
        user_id=user_id,
        entry_id=entry.id,
        duel_type=duel_type,
        rival_type="bot",
        bot_rival_tier=tier,
        entry_gems=entry_gems,
        pool_gems=pool_gems,
        seed=seed,
        rival_run=rival_run,
        status="created",
        contest_date=contest_date,
        started_at=now,
        expires_at=now + timedelta(minutes=DUEL_EXPIRY_MINUTES),
    )
    session.add(match)
    await session.flush()  # assign match.id

    if is_gem:
        await record_gem_delta(
            session,
            user_id,
            -entry_gems,
            "duel_entry",
            ref_type="duel",
            ref_id=match.id,
            idempotency_key=f"duel:{match.id}:entry",
        )

    match.status = "in_progress"
    await session.flush()

    return DuelCreateResult(match=match, rounds=list(entry.round_set))


# ---------------- finalize ----------------
async def _duel_rounds(session: AsyncSession, match_id: uuid.UUID) -> list[DuelRound]:
    return list(
        (
            await session.execute(
                select(DuelRound)
                .where(DuelRound.match_id == match_id)
                .order_by(DuelRound.round_index)
            )
        )
        .scalars()
        .all()
    )


async def finalize_duel(
    session: AsyncSession,
    match: DuelMatch,
    winner: str,
    result_reason: str,
    now: datetime,
) -> DuelResult:
    """Settle a decided duel: credit the Gem pool (winner only), roll up XP/stats, and stamp the
    match. Idempotent — a completed match returns its recorded result without double-crediting.

    Gems: the entry was already debited at create. On a Gem WIN we credit the full pool (net delta
    = pool − entry, e.g. +2 − 1 = +1); on a Gem LOSS no new ledger op (net delta = −entry).
    Training is gem-neutral. Never commits."""
    # These are pure reads (no side effects) so they run BEFORE the idempotent-return branch and
    # feed BOTH paths the same way — `perfect`/`comeback` are per-match facts replayed from the
    # persisted rounds, never reconstructed from lifetime per-user counters.
    rounds = await _duel_rounds(session, match.id)
    user_corrects = [r.user_correct for r in rounds]

    # Replay the round outcomes to find the largest deficit the user ever faced (comeback check).
    uw = rw = 0
    max_rival_lead = 0
    for r in rounds:
        if r.outcome == "user_win":
            uw += 1
        elif r.outcome == "rival_win":
            rw += 1
        max_rival_lead = max(max_rival_lead, rw - uw)

    # On the first call `match.winner` is unset → use the caller-supplied `winner`; on a replay it
    # is the recorded winner. Either way perfect/comeback are computed from the persisted match.
    effective_winner = match.winner or winner
    perfect = is_perfect_win(effective_winner, match.rival_round_wins, user_corrects)
    comeback = is_comeback_win(effective_winner, max_rival_lead)

    if match.status == "completed":
        stats = await _get_or_create_stats(session, match.user_id)
        # A completed match always has winner/result_reason recorded (set on the live path below).
        assert match.winner is not None and match.result_reason is not None
        return DuelResult(
            winner=match.winner,
            result_reason=match.result_reason,
            user_round_wins=match.user_round_wins,
            rival_round_wins=match.rival_round_wins,
            gem_delta=match.gem_delta,
            xp_awarded=match.xp_awarded,
            perfect=perfect,
            comeback=comeback,
            duel_tier=stats.duel_tier,
        )

    won = winner == "user"
    is_gem = match.entry_gems > 0

    # ---- Gem pool ----
    if is_gem and won:
        await record_gem_delta(
            session,
            match.user_id,
            match.pool_gems,
            "duel_pool_win",
            ref_type="duel",
            ref_id=match.id,
            idempotency_key=f"duel:{match.id}:win",
        )
        gem_delta = match.pool_gems - match.entry_gems
    elif is_gem:
        gem_delta = -match.entry_gems  # entry already debited at create — no new ledger op
    else:
        gem_delta = 0  # training is gem-neutral

    # ---- XP / stats ----
    xp = xp_for_result(match.duel_type, won, perfect=perfect, comeback=comeback)
    stats = await _get_or_create_stats(session, match.user_id)
    if is_gem:
        if won:
            stats.wins += 1
            stats.current_streak += 1
            stats.best_streak = max(stats.best_streak, stats.current_streak)
            stats.total_gems_won += match.pool_gems
        else:
            stats.losses += 1
            stats.current_streak = 0
            stats.total_gems_lost += match.entry_gems
    else:
        # Training never touches current_streak/best_streak or wins/losses.
        if won:
            stats.training_wins += 1
        else:
            stats.training_losses += 1
    if perfect:
        stats.perfect_wins += 1
    if comeback:
        stats.comeback_wins += 1
    stats.duel_xp += xp
    stats.duel_tier = tier_for_xp(stats.duel_xp)
    stats.updated_at = now

    match.winner = winner
    match.result_reason = result_reason
    match.gem_delta = gem_delta
    match.xp_awarded = xp
    match.status = "completed"
    match.completed_at = now
    match.updated_at = now
    await session.flush()

    return DuelResult(
        winner=winner,
        result_reason=result_reason,
        user_round_wins=match.user_round_wins,
        rival_round_wins=match.rival_round_wins,
        gem_delta=gem_delta,
        xp_awarded=xp,
        perfect=perfect,
        comeback=comeback,
        duel_tier=stats.duel_tier,
    )


# ---------------- per-round submit ----------------
async def submit_duel_round(
    session: AsyncSession,
    user_id: uuid.UUID,
    match_id: uuid.UUID,
    idx: int,
    result: dict[str, Any],
    now: datetime | None = None,
) -> DuelRoundReveal:
    """Score one duel round (reusing the contest scoring path for the human), adjudicate it against
    the precomputed rival run, advance the match, and settle if this round decides it.

    The human's correctness/speed come from the canonical module score(); a flagged/invalid round
    counts as NOT correct for the head-to-head. Server-authoritative throughout — the client's
    elapsed_ms is clamped by the module, the rival run never leaves the server. Never commits."""
    now = now or datetime.now(UTC)

    match = await session.get(DuelMatch, match_id)
    if match is None or match.user_id != user_id:
        raise DuelNotFoundError()
    if match.status != "in_progress":
        raise DuelStateError()

    # Strict sequence over the human's stored RoundResults (one answer per round, in order).
    prior = (
        (
            await session.execute(
                select(RoundResult)
                .where(RoundResult.entry_id == match.entry_id)
                .order_by(RoundResult.idx)
            )
        )
        .scalars()
        .all()
    )
    played = len(prior)
    if idx != played or idx >= DUEL_TOTAL_ROUNDS:
        raise DuelRoundSequenceError()

    answer = await session.get(RoundAnswer, (match.entry_id, idx))
    if answer is None:
        raise DuelRoundSequenceError()

    # ---- Human round: canonical score() + the same trailing-streak/compute_points as practice. --
    judgement = get_module(answer.module_type).score(answer.server_answer, result)
    counts = judgement.correct and judgement.valid
    streak_prev = 0
    for r in reversed(prior):
        if r.correct and r.valid:
            streak_prev += 1
        else:
            break
    points = compute_points(True, judgement.time_frac, streak_prev + 1) if counts else 0
    session.add(
        RoundResult(
            entry_id=match.entry_id,
            idx=idx,
            module_type=answer.module_type,
            points=points,
            correct=judgement.correct,
            time_frac=judgement.time_frac,
            valid=judgement.valid,
            flags=judgement.flags,
        )
    )
    await record_answer_signal(
        session,
        user_id,
        question_id=question_id_from_server_answer(answer.server_answer),
        mode="duel",
        is_correct=bool(counts),
        time_frac=judgement.time_frac,
        limit_ms=get_module(answer.module_type).time_limit_ms,
        streak_before=streak_prev,
        streak_after=streak_prev + 1 if counts else 0,
        session_id=match.entry_id,
        difficulty=answer.server_answer.get("difficulty"),
    )

    # ---- Adjudicate this round vs the rival (a flagged/invalid round = NOT correct for the duel).
    user_correct = counts
    user_time_ms = time_frac_to_ms(judgement.time_frac)
    rival = match.rival_run[idx]
    rival_correct = bool(rival["correct"])
    rival_time_ms = time_frac_to_ms(float(rival["time_frac"]))
    outcome, reason = round_outcome(user_correct, user_time_ms, rival_correct, rival_time_ms)

    phase = "normal" if idx < DUEL_NORMAL_ROUNDS else "sudden_death"
    if outcome == "user_win":
        match.user_round_wins += 1
    elif outcome == "rival_win":
        match.rival_round_wins += 1
    session.add(
        DuelRound(
            match_id=match.id,
            round_index=idx,
            phase=phase,
            user_answer=result.get("choice"),
            user_correct=user_correct,
            user_time_ms=user_time_ms,
            rival_correct=rival_correct,
            rival_time_ms=rival_time_ms,
            outcome=outcome,
            outcome_reason=reason,
        )
    )
    match.updated_at = now
    await session.flush()  # so finalize's duel_rounds query sees this round

    # ---- Decide the match. ----
    played_after = played + 1
    normal_played = min(played_after, DUEL_NORMAL_ROUNDS)
    sd_played = max(0, played_after - DUEL_NORMAL_ROUNDS)
    status, decided_winner = match_decision(
        match.user_round_wins, match.rival_round_wins, normal_played, sd_played
    )

    final: DuelResult | None = None
    if status == "done":
        # A win clinched during sudden death is labeled `sudden_death`, not `first_to_4`.
        if sd_played > 0:
            rr = "sudden_death"
        elif (
            match.user_round_wins >= DUEL_ROUNDS_TO_WIN
            or match.rival_round_wins >= DUEL_ROUNDS_TO_WIN
        ):
            rr = "first_to_4"
        else:
            rr = "higher_round_wins"
        assert decided_winner is not None
        final = await finalize_duel(session, match, decided_winner, rr, now)
        next_ = "done"
        finished = True
    elif status == "tiebreak":
        rounds = await _duel_rounds(session, match.id)
        tb_winner, tb_reason = final_tiebreak(
            [r.user_time_ms for r in rounds if r.user_correct],
            [r.rival_time_ms for r in rounds if r.rival_correct],
            match.seed,
        )
        final = await finalize_duel(session, match, tb_winner, tb_reason, now)
        next_ = "done"
        finished = True
    elif status == "sudden_death":
        next_ = "sudden_death"
        finished = False
    else:  # continue_normal
        next_ = "normal"
        finished = False

    await session.flush()
    return DuelRoundReveal(
        idx=idx,
        outcome=outcome,
        outcome_reason=reason,
        your_correct=user_correct,
        your_time_ms=user_time_ms,
        answer=answer.server_answer,
        rival_correct=rival_correct,
        rival_time_ms=rival_time_ms,
        user_round_wins=match.user_round_wins,
        rival_round_wins=match.rival_round_wins,
        phase=phase,
        next=next_,
        finished=finished,
        result=final,
    )


# ---------------- expiry cleanup ----------------
async def cleanup_expired_duels(session: AsyncSession, now: datetime | None = None) -> int:
    """Forfeit duels left unfinished past their expiry: the entry Gem was already debited at create,
    so an abandonment is a plain loss (no pool credit, no refund). Marks the match abandoned and
    rolls up the loss via the same stats path as a normal loss. Returns the count abandoned."""
    now = now or datetime.now(UTC)
    matches = (
        (
            await session.execute(
                select(DuelMatch).where(
                    DuelMatch.status.in_(("created", "in_progress")),
                    DuelMatch.expires_at.is_not(None),
                    DuelMatch.expires_at <= now,
                )
            )
        )
        .scalars()
        .all()
    )

    count = 0
    for match in matches:
        is_gem = match.entry_gems > 0
        stats = await _get_or_create_stats(session, match.user_id)
        if is_gem:
            stats.losses += 1
            stats.current_streak = 0
            stats.total_gems_lost += match.entry_gems
        else:
            stats.training_losses += 1
        stats.updated_at = now

        match.winner = "rival"
        match.result_reason = "abandoned"
        match.gem_delta = -match.entry_gems if is_gem else 0
        match.status = "abandoned"
        match.completed_at = now
        match.updated_at = now
        count += 1

    await session.flush()
    return count
