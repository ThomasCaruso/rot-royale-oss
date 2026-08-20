"""Pure Brain Score maths (shared by brain_boost + growth)."""

from app.services.brain_score import SCORE_MAX, SCORE_MIN, brain_score


def test_brain_score_matches_known_points() -> None:
    # 300 + 1.0*400 + 1.0*120 + 3*15 + 2*5 = 875
    assert brain_score(accuracy=1.0, avg_time_frac=1.0, best_streak=3, hard_correct=2) == 875


def test_brain_score_clamps_low_and_high() -> None:
    assert brain_score(accuracy=0.0, avg_time_frac=0.0, best_streak=0, hard_correct=0) == SCORE_MIN
    assert (
        brain_score(accuracy=1.0, avg_time_frac=1.0, best_streak=100, hard_correct=100) == SCORE_MAX
    )
