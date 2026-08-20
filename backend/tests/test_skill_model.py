"""Pure knowledge-tracing math: no DB, no I/O. Each function is deterministic and unit-tested."""

from app.services.skill_model import (
    bkt_update,
    category_prior_known,
    difficulty_to_b,
    effective_p_known,
    expected_correct,
    update_theta,
)


def test_difficulty_maps_score_to_item_difficulty():
    assert difficulty_to_b(0.0) == -2.5
    assert difficulty_to_b(1.0) == 2.5
    assert difficulty_to_b(0.5) == 0.0
    assert difficulty_to_b(-1.0) == -2.5
    assert difficulty_to_b(2.0) == 2.5


def test_expected_correct_is_logistic_of_theta_minus_b():
    assert expected_correct(0.0, 0.0) == 0.5
    assert expected_correct(2.0, 0.0) > 0.85
    assert expected_correct(-2.0, 0.0) < 0.15


def test_hard_correct_lifts_theta_more_than_easy_correct():
    theta_hard, _ = update_theta(0.0, 0, difficulty_score=1.0, correct=True)
    theta_easy, _ = update_theta(0.0, 0, difficulty_score=0.0, correct=True)
    assert theta_hard > theta_easy > 0.0


def test_easy_wrong_drops_theta_more_than_hard_wrong():
    theta_easy_wrong, _ = update_theta(0.0, 0, difficulty_score=0.0, correct=False)
    theta_hard_wrong, _ = update_theta(0.0, 0, difficulty_score=1.0, correct=False)
    assert theta_easy_wrong < theta_hard_wrong < 0.0


def test_update_theta_increments_attempts_and_decays_learning_rate():
    _, attempts = update_theta(0.0, 4, difficulty_score=0.5, correct=True)
    assert attempts == 5
    fresh, _ = update_theta(0.0, 0, difficulty_score=0.5, correct=True)
    settled, _ = update_theta(0.0, 500, difficulty_score=0.5, correct=True)
    assert 0.0 < settled < fresh


def test_bkt_update_rises_on_correct_falls_on_wrong():
    assert bkt_update(0.30, correct=True) > 0.30
    assert bkt_update(0.30, correct=False) < 0.30
    assert 0.0 <= bkt_update(0.99, correct=False) <= 1.0
    assert 0.0 <= bkt_update(0.01, correct=True) <= 1.0


def test_category_prior_known_is_ability_at_average_difficulty():
    assert category_prior_known(0.0) == 0.5
    assert category_prior_known(1.0) > 0.5
    assert category_prior_known(-1.0) < 0.5


def test_effective_p_known_shrinks_thin_topic_toward_category_prior():
    assert effective_p_known(bkt_p=0.9, category_prior=0.4, topic_attempts=0) == 0.4
    assert effective_p_known(bkt_p=0.9, category_prior=0.4, topic_attempts=6) == 0.9
    blended = effective_p_known(bkt_p=0.9, category_prior=0.4, topic_attempts=3)
    assert 0.4 < blended < 0.9


def test_next_review_hours_wrong_is_due_immediately_correct_expands_with_mastery():
    from app.services.skill_model import next_review_hours

    assert next_review_hours(0.5, correct=False) == 0.0
    low = next_review_hours(0.30, correct=True)
    high = next_review_hours(0.95, correct=True)
    assert 0.0 < low < high
    assert low >= 8.0 and high <= 168.0
