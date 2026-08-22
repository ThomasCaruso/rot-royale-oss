"""Rapid-math round module (docs/architecture.md). Generated arithmetic MC — no content bank needed.

client_spec = {prompt, options, category, icon, time_limit_ms} (no answer).
server_answer = {correctIndex, value}.
Ported from RotRoyale.jsx makeMath; deterministic given the rng.
"""

from __future__ import annotations

from random import Random
from typing import Any

from app.modules.base import GenerationContext, RoundJudgement, clamp_elapsed_ms

RAPID_MATH_TIME_LIMIT_MS = 10000  # every question gets a flat 10s timer

# Tuned for "challenging quick mental math under ~9s" — multi-digit add/subtract, single-digit ×
# teens, and precedence-bearing two-operator expressions — but bounded (answers <= ~200) so it stays
# mental math, not a calculator problem. Generated + deterministic from the rng.
_KINDS = ["add2", "sub2", "mul2", "twoop"]


def _build_expression(rng: Random) -> tuple[str, int]:
    """Return (prompt_body, value). prompt_body has no ' = ?' suffix. Precedence is real: a two-
    operator expression evaluates ×-before-+/− exactly as displayed."""
    kind = rng.choice(_KINDS)
    if kind == "add2":  # two-digit addition
        a, b = rng.randint(11, 99), rng.randint(11, 99)
        return f"{a} + {b}", a + b
    if kind == "sub2":  # two-digit subtraction, always positive
        a = rng.randint(20, 99)
        b = rng.randint(11, a - 1)
        return f"{a} − {b}", a - b
    if kind == "mul2":  # single-digit × teens (e.g. 7 × 14)
        a, b = rng.randint(3, 9), rng.randint(11, 19)
        return f"{a} × {b}", a * b
    # twoop: a × b ± c — the × binds first (mental-math precedence)
    a, b, c = rng.randint(2, 9), rng.randint(2, 9), rng.randint(2, 20)
    op = rng.choice(["+", "−"])
    if op == "−" and a * b <= c:  # keep the answer positive
        op = "+"
    value = a * b + c if op == "+" else a * b - c
    return f"{a} × {b} {op} {c}", value


def _distractors(rng: Random, value: int) -> list[int]:
    """Three distinct, non-negative near-misses, spread proportionally to the answer's magnitude."""
    opts = {value}
    spread = max(3, round(value * 0.15))
    attempts = 0
    while len(opts) < 4 and attempts < 60:
        cand = value + rng.randint(-spread, spread)
        if cand >= 0:
            opts.add(cand)
        attempts += 1
    i = 1
    while len(opts) < 4:  # guaranteed fill for tiny answers
        opts.update(c for c in (value + i, value - i) if c >= 0)
        i += 1
    return sorted(opts - {value})[:3]


class RapidMathModule:
    type = "rapid_math"
    time_limit_ms = RAPID_MATH_TIME_LIMIT_MS

    def generate(
        self, rng: Random, difficulty: str | None, ctx: GenerationContext
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        prompt_body, value = _build_expression(rng)

        ordered = [value, *_distractors(rng, value)]
        rng.shuffle(ordered)
        str_opts = [str(v) for v in ordered]

        client_spec = {
            "prompt": f"{prompt_body} = ?",
            "options": str_opts,
            "category": "Rapid Math",
            "icon": "➗",
            "time_limit_ms": self.time_limit_ms,
        }
        server_answer = {"correctIndex": ordered.index(value), "value": value}
        return client_spec, server_answer

    def score(self, server_answer: dict[str, Any], submission: dict[str, Any]) -> RoundJudgement:
        choice = submission.get("choice")
        elapsed = clamp_elapsed_ms(
            submission.get("elapsed_ms", self.time_limit_ms), self.time_limit_ms
        )
        time_frac = (self.time_limit_ms - elapsed) / self.time_limit_ms
        return RoundJudgement(
            correct=choice == server_answer["correctIndex"],
            time_frac=time_frac,
            valid=True,
            flags=[],
        )
