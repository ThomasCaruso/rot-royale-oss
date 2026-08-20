"""Duel mode rules core — PURE functions, no DB and no async.

A Duel is a best-of-7 trivia match (10s/question). Each question is a round. A round is won by
KNOWLEDGE first; SPEED only breaks a meaningful both-correct tie when the time gap is clear
(>= DUEL_SPEED_GAP_MS). The match is first-to-4 round-wins, with a bounded sudden-death tail and a
fully deterministic final tiebreak so a match can never hang forever.

Everything here is a pure function of its arguments (the seed makes the final tiebreak
reproducible), so it is exhaustively unit-tested in tests/test_duel_logic.py. The DB services that
orchestrate a
live match call into these functions in the next task — this module owns the rules, not storage.
"""

from __future__ import annotations

from random import Random

from app.core.constants import (
    DUEL_NORMAL_ROUNDS,
    DUEL_QUESTION_TIME_LIMIT_MS,
    DUEL_ROUNDS_TO_WIN,
    DUEL_SPEED_GAP_MS,
    DUEL_SUDDEN_DEATH_MAX,
    DUEL_TIER_THRESHOLDS,
    DUEL_XP_COMEBACK_BONUS,
    DUEL_XP_GEM_LOSS,
    DUEL_XP_GEM_WIN,
    DUEL_XP_PERFECT_BONUS,
    DUEL_XP_TRAINING_LOSS,
    DUEL_XP_TRAINING_WIN,
)


def time_frac_to_ms(time_frac: float, limit_ms: int = DUEL_QUESTION_TIME_LIMIT_MS) -> int:
    """Convert a scoring time_frac (1.0 = instant, 0.0 = used the full limit) to elapsed ms."""
    elapsed = round(limit_ms * (1 - time_frac))
    return max(0, min(limit_ms, elapsed))


def round_outcome(
    user_correct: bool,
    user_time_ms: int,
    rival_correct: bool,
    rival_time_ms: int,
    *,
    speed_gap_ms: int = DUEL_SPEED_GAP_MS,
) -> tuple[str, str]:
    """(outcome, outcome_reason). outcome in {user_win, rival_win, no_point};
    reason in {correct_vs_wrong, speed_gap, both_wrong, near_tie_correct}.

    Knowledge first: a lone correct answer wins the round. Both correct: the faster answer wins ONLY
    if the gap is >= speed_gap_ms; a closer (or exactly equal) gap is too close to call (no point).
    """
    if user_correct and not rival_correct:
        return ("user_win", "correct_vs_wrong")
    if rival_correct and not user_correct:
        return ("rival_win", "correct_vs_wrong")
    if not user_correct and not rival_correct:
        return ("no_point", "both_wrong")
    # Both correct — speed only breaks a clear gap.
    gap = abs(user_time_ms - rival_time_ms)
    if gap >= speed_gap_ms:
        if user_time_ms < rival_time_ms:
            return ("user_win", "speed_gap")
        return ("rival_win", "speed_gap")
    return ("no_point", "near_tie_correct")


def match_decision(
    user_wins: int, rival_wins: int, normal_played: int, sd_played: int
) -> tuple[str, str | None]:
    """Total decision function. Returns (status, winner). status in
    {continue_normal, sudden_death, done, tiebreak}; winner is 'user'/'rival' only when
    status == 'done'."""
    if user_wins >= DUEL_ROUNDS_TO_WIN:
        return ("done", "user")
    if rival_wins >= DUEL_ROUNDS_TO_WIN:
        return ("done", "rival")
    if normal_played < DUEL_NORMAL_ROUNDS:
        return ("continue_normal", None)
    if user_wins != rival_wins:
        return ("done", "user" if user_wins > rival_wins else "rival")
    if sd_played < DUEL_SUDDEN_DEATH_MAX:
        return ("sudden_death", None)
    return ("tiebreak", None)


def final_tiebreak(
    user_correct_times_ms: list[int], rival_correct_times_ms: list[int], seed: int
) -> tuple[str, str]:
    """Deterministic final resolution. (winner, reason). reason in
    {tiebreak_total_correct, tiebreak_avg_speed, tiebreak_seed}.

    Order: (1) more total correct answers; (2) lower average response time on correct answers (only
    when BOTH players answered at least one correctly — otherwise the mean is undefined); (3)
    deterministic from the match seed. The seed branch guarantees a single, reproducible result.
    A near-equal (but not exactly equal) average is intentionally NOT special-cased: any difference
    decides the avg-speed branch; only an exactly-equal average falls through to the seed branch.
    """
    user_total = len(user_correct_times_ms)
    rival_total = len(rival_correct_times_ms)
    if user_total != rival_total:
        return ("user" if user_total > rival_total else "rival", "tiebreak_total_correct")
    if user_total > 0 and rival_total > 0:
        user_avg = sum(user_correct_times_ms) / user_total
        rival_avg = sum(rival_correct_times_ms) / rival_total
        if user_avg != rival_avg:
            return ("user" if user_avg < rival_avg else "rival", "tiebreak_avg_speed")
    winner = "user" if Random(seed).random() < 0.5 else "rival"
    return (winner, "tiebreak_seed")


def is_perfect_win(winner: str | None, rival_round_wins: int, user_corrects: list[bool]) -> bool:
    """A flawless user victory: user won, rival took 0 rounds, and missed no played round."""
    return (
        winner == "user" and rival_round_wins == 0 and len(user_corrects) > 0 and all(user_corrects)
    )


def is_comeback_win(winner: str | None, max_rival_lead: int) -> bool:
    """User won after trailing by >= 2 round-wins at some point. max_rival_lead = the largest
    (rival_wins - user_wins) observed during the match."""
    return winner == "user" and max_rival_lead >= 2


def xp_for_result(
    duel_type: str, won: bool, *, perfect: bool = False, comeback: bool = False
) -> int:
    """Duel XP for one match. Training is worth less than Gem duels. Perfect/comeback add bonuses
    (only meaningful on a win — callers pass them False on a loss)."""
    if duel_type == "training":
        xp = DUEL_XP_TRAINING_WIN if won else DUEL_XP_TRAINING_LOSS
    else:
        xp = DUEL_XP_GEM_WIN if won else DUEL_XP_GEM_LOSS
    if perfect:
        xp += DUEL_XP_PERFECT_BONUS
    if comeback:
        xp += DUEL_XP_COMEBACK_BONUS
    return xp


def tier_for_xp(xp: int) -> str:
    """Highest DUEL_TIER_THRESHOLDS band whose threshold <= xp (0->bronze ... 700->crown)."""
    tier = DUEL_TIER_THRESHOLDS[0][0]
    for name, threshold in DUEL_TIER_THRESHOLDS:
        if xp >= threshold:
            tier = name
        else:
            break
    return tier
