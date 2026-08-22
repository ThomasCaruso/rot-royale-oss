"""Fermi-estimation round module (cognition).

client_spec = {prompt, unit, difficulty, max_guesses, time_limit_ms} — never the answer, the
tolerance, or the component quantities (the components alone would let a client derive the
answer). server_answer = {item_id, answer, acceptable_pct} — held server-side; per-guess feedback
is only {direction, band}, and the full reveal (answer + arithmetic) comes at resolution.

Unlike span there is NO reveal endpoint: the hidden value never reaches the client at all until
the round resolves. The turn-by-turn state (up to 3 guesses) is driven by services/cognition.py
against the attempt table; score()/points() judge a full transcript for the protocol/gauntlet.
"""

from __future__ import annotations

import math
from decimal import Decimal
from random import Random
from typing import Any

from app.modules.base import GenerationContext, RoundJudgement

ESTIMATE_MAX_GUESSES = 3
ESTIMATE_GUESS_LIMIT_MS = 30000  # per-guess client display budget; scoring is per-attempt, not time

# Default correctness tolerance by difficulty, applied at content-creation time when an item
# doesn't set its own acceptable_pct (the column default covers 'direct').
DEFAULT_ACCEPTABLE_PCT: dict[str, int] = {"direct": 20, "two_step": 30, "counterintuitive": 40}
# Default proximity band = 2× the correctness threshold (an item may override via close_pct).
DEFAULT_CLOSE_PCT: dict[str, int] = {k: 2 * v for k, v in DEFAULT_ACCEPTABLE_PCT.items()}


def decade_bounds(answer: float) -> tuple[float, float]:
    """Log-slider bounds from the answer's MAGNITUDE only:
        decade = 10 ** floor(log10(answer)); min = decade / 10; max = decade * 10.
    Every answer in the same decade gets identical bounds, so the bounds leak only the order of
    magnitude — which the player needs to reason at all — and never the answer. The range spans
    exactly two decades, so a log slider gives each decade equal track width."""
    decade = 10.0 ** math.floor(math.log10(answer))
    return decade / 10.0, decade * 10.0


def narrow_bounds(answer: float, wrong_guesses: list[float]) -> tuple[float, float]:
    """The surviving [min, max] after a run of WRONG guesses: a too-low guess raises the floor to
    it ("go higher"), a too-high guess drops the ceiling to it ("go lower"). Clamped to the decade
    bounds. The server owns this — the client renders the bounds it is handed, never computes them.
    Only wrong guesses are passed: a correct guess ends the round, so it never narrows."""
    lo, hi = decade_bounds(answer)
    for g in wrong_guesses:
        if g < answer:
            lo = max(lo, g)
        elif g > answer:
            hi = min(hi, g)
    return lo, hi


def effective_close_pct(acceptable_pct: float, close_pct: float | Decimal | None) -> float:
    """Unset close_pct → 2× acceptable_pct. Explicit None check — 0 would be a real value.
    Accepts float or Decimal (the ORM column is Numeric)."""
    return float(close_pct) if close_pct is not None else 2.0 * float(acceptable_pct)


def judge_guess(
    answer: float, acceptable_pct: float, close_pct: float, guess: float
) -> tuple[bool, str | None, str | None]:
    """Judge one guess → (correct, direction, band).

    Correct means within acceptable_pct — the round resolves, so no direction or band. A wrong
    guess gets a direction (which way to MOVE: too low → "higher", too high → "lower") and a
    proximity band: "close" within close_pct, "far" beyond — a near-miss should feel different
    from a wild miss.
    """
    delta = abs(guess - answer)
    if delta <= abs(answer) * acceptable_pct / 100.0:
        return True, None, None
    band = "close" if delta <= abs(answer) * close_pct / 100.0 else "far"
    return False, ("higher" if guess < answer else "lower"), band


class EstimateModule:
    type = "estimate"
    time_limit_ms = ESTIMATE_GUESS_LIMIT_MS

    def generate(
        self, rng: Random, difficulty: str | None, ctx: GenerationContext
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        # ctx.bank carries estimate-item dicts (services/cognition.py builds them). Prefer the
        # requested difficulty, fall back to the whole bank — same thin-pool contract as trivia.
        pool = ctx.bank
        if difficulty is not None:
            pool = [i for i in ctx.bank if i.get("difficulty") == difficulty] or ctx.bank
        if not pool:
            raise ValueError("estimate bank is empty")
        item = rng.choice(pool)
        # Log-slider bounds from magnitude only (never the answer) — see decade_bounds.
        slider_min, slider_max = decade_bounds(float(item["answer"]))
        client_spec = {
            "prompt": item["prompt"],
            "unit": item.get("unit"),
            "difficulty": item.get("difficulty"),
            "max_guesses": ESTIMATE_MAX_GUESSES,
            "time_limit_ms": self.time_limit_ms,
            "slider_min": slider_min,
            "slider_max": slider_max,
        }
        acceptable = float(item["acceptable_pct"])
        server_answer = {
            "item_id": str(item["id"]),
            "answer": float(item["answer"]),
            "acceptable_pct": acceptable,
            "close_pct": effective_close_pct(acceptable, item.get("close_pct")),
        }
        return client_spec, server_answer

    def points(self, server_answer: dict[str, Any], submission: dict[str, Any]) -> int:
        """3 / 2 / 1 points by the attempt that landed within acceptable_pct; 0 on failure."""
        answer = float(server_answer["answer"])
        pct = float(server_answer["acceptable_pct"])
        close = float(server_answer.get("close_pct", 2 * pct))
        guesses = submission.get("guesses") or []
        for i, guess in enumerate(guesses[:ESTIMATE_MAX_GUESSES]):
            correct, _direction, _band = judge_guess(answer, pct, close, float(guess))
            if correct:
                return ESTIMATE_MAX_GUESSES - i
        return 0

    def score(self, server_answer: dict[str, Any], submission: dict[str, Any]) -> RoundJudgement:
        """Judge a full guess transcript (validated, not trusted — docs/architecture.md §4):
        honest play stops at the first correct guess and never exceeds the guess budget."""
        answer = float(server_answer["answer"])
        pct = float(server_answer["acceptable_pct"])
        close = float(server_answer.get("close_pct", 2 * pct))
        guesses = submission.get("guesses") or []
        flags: list[str] = []
        valid = True
        if len(guesses) > ESTIMATE_MAX_GUESSES:
            valid = False
            flags.append("too_many_guesses")
        first_correct = next(
            (
                i
                for i, g in enumerate(guesses[:ESTIMATE_MAX_GUESSES])
                if judge_guess(answer, pct, close, float(g))[0]
            ),
            None,
        )
        if first_correct is not None and len(guesses) > first_correct + 1:
            valid = False
            flags.append("guess_after_resolve")
        correct = first_correct is not None
        return RoundJudgement(correct=correct, time_frac=0.0, valid=valid, flags=flags)
