"""The Brain Score — the single 300..900 measure of a player's sharpness (correctness + speed +
streak + difficulty spice). Pure maths, shared by the Brain Boost (per-check) and growth (rolling
daily) so there is exactly one definition."""

from __future__ import annotations

SCORE_MIN, SCORE_MAX = 300, 900
_ACCURACY_WEIGHT = 400
_SPEED_WEIGHT = 120
_STREAK_WEIGHT = 15
_HARD_BONUS = 5  # per hard question answered correctly


def brain_score(
    *, accuracy: float, avg_time_frac: float, best_streak: int, hard_correct: int
) -> int:
    """accuracy/avg_time_frac in 0..1 (higher = faster). Clamped to [SCORE_MIN, SCORE_MAX]."""
    raw = (
        SCORE_MIN
        + accuracy * _ACCURACY_WEIGHT
        + avg_time_frac * _SPEED_WEIGHT
        + best_streak * _STREAK_WEIGHT
        + hard_correct * _HARD_BONUS
    )
    return max(SCORE_MIN, min(SCORE_MAX, round(raw)))
