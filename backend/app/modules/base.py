"""Round-module interface (docs/architecture.md). The contest engine depends only on this Protocol.

The anti-cheat split is enforced here: generate() returns (client_spec, server_answer). client_spec
goes to the client and MUST NOT contain answers; server_answer is stored server-side only and used
to score.

generate() also takes a GenerationContext carrying any loaded content a module needs (e.g. the
trivia question bank). This keeps modules stateless singletons in the registry while content flows
per-call — generated modules (rapid_math, mini-games) simply ignore the context.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from random import Random
from typing import Any, Protocol, runtime_checkable


@dataclass
class GenerationContext:
    """Content + params handed to a module at generation time. Bank is ordered for determinism."""

    bank: list[dict[str, Any]] = field(default_factory=list)
    # Content modules derive a per-question option-shuffle salt from this (kept reproducible: it is
    # the entry seed, so the same entry always shuffles a given question the same way). Generated
    # modules ignore it. See trivia.trivia_spec for the anti-cheat + reproducibility contract.
    seed: int = 0


@dataclass
class RoundJudgement:
    """A module's verdict on a submission. Points are NOT set here — the scoring service applies
    the contest-wide streak multiplier (the points formula lives in one place, services/scoring.py).
    """

    correct: bool
    time_frac: float
    valid: bool
    flags: list[str] = field(default_factory=list)


def clamp_elapsed_ms(raw: Any, time_limit_ms: int) -> int:
    """Coerce a client-asserted `elapsed_ms` to a safe int in [0, time_limit_ms].

    `result` is an opaque `dict[str, Any]` straight off the wire (schemas/contest.py), so `raw` can
    be anything the client sends. Besides the obvious TypeError/ValueError, JSON permits `1e999`,
    which pydantic parses to float `inf` — and `int(inf)` raises OverflowError, which the modules'
    original `except (TypeError, ValueError)` did NOT catch, turning a crafted submit into an
    unhandled 500 with a rolled-back transaction. Any unparseable value falls back to the full limit
    (time_frac 0), the least-favourable reading, so garbage never earns a time bonus.
    """
    try:
        return max(0, min(int(raw), time_limit_ms))
    except (TypeError, ValueError, OverflowError):
        return time_limit_ms


@runtime_checkable
class RoundModule(Protocol):
    type: str  # e.g. "trivia", "rapid_math", "memory_flash"
    time_limit_ms: int  # server-authoritative per-round time budget

    def generate(
        self, rng: Random, difficulty: str | None, ctx: GenerationContext
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Return (client_spec, server_answer). client_spec must NOT leak answers.

        `difficulty` is the requested question difficulty (easy/medium/hard) or None = any; content
        modules honor it, generated modules ignore it.
        """
        ...

    def score(self, server_answer: dict[str, Any], submission: dict[str, Any]) -> RoundJudgement:
        """Judge a submission against server_answer. Computes correctness + time_frac + validity."""
        ...
