"""Canonical scoring formula + per-entry streak scoring (docs/architecture.md)."""

from __future__ import annotations

import app.modules  # noqa: F401 - register modules (trivia) in the registry
from app.services.scoring import compute_points, score_entry


def test_incorrect_scores_zero():
    assert compute_points(correct=False, time_frac=1.0, streak=0) == 0


def test_first_correct_full_speed():
    # streak is incremented BEFORE the multiplier: first correct is streak=1 → 1.12x.
    assert compute_points(correct=True, time_frac=1.0, streak=1) == 179  # round((100+60)*1.12)


def test_zero_speed_correct():
    assert compute_points(correct=True, time_frac=0.0, streak=1) == 112  # round(100*1.12)


def test_streak_multiplier_caps_at_five():
    assert compute_points(correct=True, time_frac=0.0, streak=6) == 160  # round(100*1.6)


def test_score_entry_applies_running_streak_and_resets():
    answers = [(i, "trivia", {"correctIndex": 0, "question_id": f"q{i}"}) for i in range(3)]
    # full time used (elapsed == limit) → time_frac 0, so points are just 100*mult
    submissions = {
        0: {"choice": 0, "elapsed_ms": 10000},  # correct, streak 1 → 112
        1: {"choice": 0, "elapsed_ms": 10000},  # correct, streak 2 → 124
        2: {"choice": 3, "elapsed_ms": 10000},  # wrong → 0, resets streak
    }
    results, total = score_entry(answers, submissions)
    assert [r.points for r in results] == [112, 124, 0]
    assert [r.correct for r in results] == [True, True, False]
    assert total == 236


def test_missing_submission_is_incorrect():
    answers = [(0, "trivia", {"correctIndex": 1, "question_id": "q0"})]
    results, total = score_entry(answers, {})  # no submission for the round
    assert results[0].correct is False
    assert total == 0
