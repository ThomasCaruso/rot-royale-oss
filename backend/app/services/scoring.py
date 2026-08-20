"""Canonical scoring (PLAN.md §5). The points formula lives ONLY here.

points = correct ? round((100 + time_frac*60) * (1 + min(streak,5)*0.12)) : 0
where `streak` is the count of consecutive correct rounds WITHIN the contest, incremented before the
multiplier is applied (so the first correct answer is streak=1 → 1.12x). The client may mirror this
for a provisional display, but the server total is canonical.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.modules.registry import get_module


def compute_points(correct: bool, time_frac: float, streak: int, *, half: bool = False) -> int:
    """Canonical points. `half=True` halves the result — a Daily Royale trivia round salvaged on the
    second-chance retry (§5f) scores half of what the same answer would have earned first try (speed
    + streak included); it still counts as correct for the streak and Rot Rating, only the points
    are reduced."""
    if not correct:
        return 0
    multiplier = 1 + min(streak, 5) * 0.12
    points = (100 + time_frac * 60) * multiplier
    if half:
        points /= 2
    return round(points)


@dataclass
class ScoredRound:
    idx: int
    module_type: str
    points: int
    correct: bool
    time_frac: float
    valid: bool
    flags: list[str]
    # The server answer, surfaced for the post-submit results reveal (the entry is already locked,
    # so this is not an anti-cheat exposure). Not used by the points formula.
    server_answer: dict[str, Any]


def score_entry(
    answers: list[tuple[int, str, dict[str, Any]]],
    submissions_by_idx: dict[int, dict[str, Any]],
) -> tuple[list[ScoredRound], int]:
    """Score every round against its stored server_answer, applying the running contest streak.

    `answers` is (idx, module_type, server_answer). `submissions_by_idx` maps round idx → the
    client's per-round result. A missing submission scores as incorrect.
    """
    streak = 0
    results: list[ScoredRound] = []
    for idx, module_type, server_answer in sorted(answers, key=lambda a: a[0]):
        module = get_module(module_type)
        judgement = module.score(server_answer, submissions_by_idx.get(idx, {}))
        counts = judgement.correct and judgement.valid
        if counts:
            streak += 1
            points = compute_points(True, judgement.time_frac, streak)
        else:
            streak = 0
            points = 0
        results.append(
            ScoredRound(
                idx=idx,
                module_type=module_type,
                points=points,
                correct=judgement.correct,
                time_frac=judgement.time_frac,
                valid=judgement.valid,
                flags=judgement.flags,
                server_answer=server_answer,
            )
        )
    return results, sum(r.points for r in results)
