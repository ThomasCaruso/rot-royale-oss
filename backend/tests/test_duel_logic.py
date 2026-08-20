"""Exhaustive unit tests for the Duel rules core (app/services/duel_logic.py).

Pure functions — no DB, no async. Every branch of every rule is covered here so the DB services in
the next task can trust the rules outright.
"""

from __future__ import annotations

from app.core.constants import (
    DUEL_NORMAL_ROUNDS,
    DUEL_QUESTION_TIME_LIMIT_MS,
    DUEL_SPEED_GAP_MS,
)
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

# --- time_frac_to_ms ---


def test_time_frac_instant_is_zero_ms():
    assert time_frac_to_ms(1.0) == 0


def test_time_frac_full_limit_is_limit_ms():
    assert time_frac_to_ms(0.0) == DUEL_QUESTION_TIME_LIMIT_MS == 10_000


def test_time_frac_half():
    assert time_frac_to_ms(0.5) == 5_000


def test_time_frac_clamps_above_one():
    # time_frac > 1.0 would give negative elapsed; clamp to 0.
    assert time_frac_to_ms(1.5) == 0


def test_time_frac_clamps_below_zero():
    # time_frac < 0.0 would give > limit; clamp to limit.
    assert time_frac_to_ms(-0.5) == DUEL_QUESTION_TIME_LIMIT_MS


def test_time_frac_custom_limit():
    assert time_frac_to_ms(0.5, limit_ms=8_000) == 4_000


# --- round_outcome ---


def test_user_correct_rival_wrong():
    assert round_outcome(True, 1_000, False, 500) == ("user_win", "correct_vs_wrong")


def test_rival_correct_user_wrong():
    assert round_outcome(False, 500, True, 9_000) == ("rival_win", "correct_vs_wrong")


def test_both_wrong():
    assert round_outcome(False, 1_000, False, 1_000) == ("no_point", "both_wrong")


def test_both_correct_user_faster_clear_gap():
    assert round_outcome(True, 1_000, True, 1_500) == ("user_win", "speed_gap")


def test_both_correct_rival_faster_clear_gap():
    assert round_outcome(True, 1_500, True, 1_000) == ("rival_win", "speed_gap")


def test_both_correct_gap_below_threshold_no_point():
    # gap = 349 < 350
    assert round_outcome(True, 1_000, True, 1_349) == ("no_point", "near_tie_correct")


def test_both_correct_exactly_equal_ms_no_point():
    assert round_outcome(True, 2_000, True, 2_000) == ("no_point", "near_tie_correct")


def test_both_correct_gap_exactly_threshold_is_a_win():
    # gap exactly DUEL_SPEED_GAP_MS (350) counts as a win (>=).
    assert round_outcome(True, 1_000, True, 1_000 + DUEL_SPEED_GAP_MS) == (
        "user_win",
        "speed_gap",
    )
    assert round_outcome(True, 1_000 + DUEL_SPEED_GAP_MS, True, 1_000) == (
        "rival_win",
        "speed_gap",
    )


def test_round_outcome_custom_speed_gap():
    # With a 100ms gap and a 200ms threshold, it's a near tie.
    assert round_outcome(True, 1_000, True, 1_100, speed_gap_ms=200) == (
        "no_point",
        "near_tie_correct",
    )


# --- match_decision ---


def test_decision_four_zero_early_done_user():
    # 4 wins ends the match even before round 7.
    assert match_decision(4, 0, 4, 0) == ("done", "user")


def test_decision_zero_four_done_rival():
    assert match_decision(0, 4, 4, 0) == ("done", "rival")


def test_decision_mid_match_continue():
    # 2-1 at round 5 — keep playing normal rounds.
    assert match_decision(2, 1, 5, 0) == ("continue_normal", None)


def test_decision_four_three_after_seven_done_user():
    assert match_decision(4, 3, 7, 0) == ("done", "user")


def test_decision_three_two_after_seven_higher_wins_no_sd():
    # 3-2 with 2 no-point rounds: nobody hit 4, but the higher count wins outright (no SD).
    assert match_decision(3, 2, 7, 0) == ("done", "user")


def test_decision_two_three_after_seven_higher_wins_rival():
    # Mirror of the above: the rival's higher count wins outright (no SD).
    assert match_decision(2, 3, 7, 0) == ("done", "rival")


def test_decision_three_three_after_seven_sudden_death():
    assert match_decision(3, 3, 7, 0) == ("sudden_death", None)


def test_decision_two_two_after_seven_sudden_death():
    # 2-2 (3 no-point rounds): tied, go to sudden death.
    assert match_decision(2, 2, 7, 0) == ("sudden_death", None)


def test_decision_tied_sudden_death_played_one_or_two():
    assert match_decision(3, 3, 7, 1) == ("sudden_death", None)
    assert match_decision(3, 3, 7, 2) == ("sudden_death", None)


def test_decision_tied_sudden_death_exhausted_tiebreak():
    assert match_decision(3, 3, 7, 3) == ("tiebreak", None)


def test_decision_sudden_death_round_breaks_tie_done():
    # A SD question gave the user a 4th win: 4-3 at normal_played 7, sd_played 1 -> done user.
    assert match_decision(4, 3, 7, 1) == ("done", "user")


def test_decision_normal_rounds_constant_boundary():
    # One short of the full slate keeps playing; at the full slate, decide.
    assert match_decision(3, 2, DUEL_NORMAL_ROUNDS - 1, 0) == ("continue_normal", None)
    assert match_decision(3, 2, DUEL_NORMAL_ROUNDS, 0) == ("done", "user")


# --- final_tiebreak ---


def test_tiebreak_more_correct_user_wins():
    assert final_tiebreak([100, 200, 300], [100, 200], seed=1) == (
        "user",
        "tiebreak_total_correct",
    )


def test_tiebreak_more_correct_rival_wins():
    assert final_tiebreak([100, 200], [100, 200, 300], seed=1) == (
        "rival",
        "tiebreak_total_correct",
    )


def test_tiebreak_equal_correct_faster_avg_user_wins():
    # Same count; user's mean (150) < rival's mean (250).
    assert final_tiebreak([100, 200], [200, 300], seed=1) == ("user", "tiebreak_avg_speed")


def test_tiebreak_equal_correct_faster_avg_rival_wins():
    assert final_tiebreak([200, 300], [100, 200], seed=1) == ("rival", "tiebreak_avg_speed")


def test_tiebreak_equal_correct_equal_avg_falls_to_seed():
    winner, reason = final_tiebreak([100, 200], [200, 100], seed=42)
    assert reason == "tiebreak_seed"
    assert winner in {"user", "rival"}


def test_tiebreak_seed_is_deterministic():
    # Same seed -> same winner, every time.
    a = final_tiebreak([100, 200], [200, 100], seed=42)
    b = final_tiebreak([100, 200], [200, 100], seed=42)
    assert a == b


def test_tiebreak_both_zero_correct_no_division_error():
    winner, reason = final_tiebreak([], [], seed=7)
    assert reason == "tiebreak_seed"
    assert winner in {"user", "rival"}


def test_tiebreak_one_side_zero_correct_uses_total_first():
    # Different totals (1 vs 0) resolve on total_correct, never touching the avg branch.
    assert final_tiebreak([100], [], seed=1) == ("user", "tiebreak_total_correct")


# --- is_perfect_win ---


def test_perfect_win_true():
    assert is_perfect_win("user", 0, [True, True, True, True]) is True


def test_perfect_win_false_when_missed_a_round():
    assert is_perfect_win("user", 0, [True, True, False, True]) is False


def test_perfect_win_false_when_rival_took_a_round():
    assert is_perfect_win("user", 1, [True, True, True, True]) is False


def test_perfect_win_false_when_rival_winner():
    assert is_perfect_win("rival", 0, [True, True, True]) is False


def test_perfect_win_false_on_empty_corrects():
    assert is_perfect_win("user", 0, []) is False


# --- is_comeback_win ---


def test_comeback_lead_two_true():
    assert is_comeback_win("user", 2) is True


def test_comeback_lead_three_true():
    assert is_comeback_win("user", 3) is True


def test_comeback_lead_one_false():
    assert is_comeback_win("user", 1) is False


def test_comeback_false_when_rival_winner():
    assert is_comeback_win("rival", 3) is False


def test_comeback_false_when_no_winner():
    assert is_comeback_win(None, 3) is False


# --- xp_for_result ---


def test_xp_gem_win():
    assert xp_for_result("gem", True) == 10


def test_xp_gem_loss():
    assert xp_for_result("gem", False) == 3


def test_xp_training_win():
    assert xp_for_result("training", True) == 2


def test_xp_training_loss():
    assert xp_for_result("training", False) == 1


def test_xp_perfect_bonus():
    assert xp_for_result("gem", True, perfect=True) == 15


def test_xp_comeback_bonus():
    assert xp_for_result("gem", True, comeback=True) == 15


def test_xp_bonuses_stack():
    assert xp_for_result("gem", True, perfect=True, comeback=True) == 20


def test_xp_training_with_perfect():
    assert xp_for_result("training", True, perfect=True) == 7


# --- tier_for_xp ---


def test_tier_zero_bronze():
    assert tier_for_xp(0) == "bronze"


def test_tier_99_bronze():
    assert tier_for_xp(99) == "bronze"


def test_tier_100_silver():
    assert tier_for_xp(100) == "silver"


def test_tier_299_silver():
    assert tier_for_xp(299) == "silver"


def test_tier_300_gold():
    assert tier_for_xp(300) == "gold"


def test_tier_699_gold():
    assert tier_for_xp(699) == "gold"


def test_tier_700_crown():
    assert tier_for_xp(700) == "crown"


def test_tier_far_above_crown():
    assert tier_for_xp(5000) == "crown"
