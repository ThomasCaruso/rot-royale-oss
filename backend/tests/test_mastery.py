"""theta_to_level + mastery_from_state: pure mapping."""

from app.services.mastery import mastery_from_state, theta_to_level


def test_theta_to_level_gated_on_attempts_then_bands():
    assert theta_to_level(2.0, attempts=3) == 0  # too few attempts → warming up
    assert theta_to_level(-1.5, attempts=10) == 1
    assert theta_to_level(0.0, attempts=10) == 3
    assert theta_to_level(1.5, attempts=10) == 5  # mastered


def test_mastery_from_state_covers_every_category_in_order():
    class _State:
        category_ability = {"Sports": {"theta": 1.5, "attempts": 20}}

    cats = ("Science & Nature", "Sports")
    out = mastery_from_state(_State(), cats)
    assert [m["category"] for m in out] == list(cats)  # one entry per category, in order
    science = next(m for m in out if m["category"] == "Science & Nature")
    assert science["level"] == 0 and science["attempts"] == 0  # unseen → warming up
    sports = next(m for m in out if m["category"] == "Sports")
    assert sports["level"] == 5 and sports["mastered"] is True


def test_mastery_from_none_state_is_all_warming_up():
    out = mastery_from_state(None, ("History", "Geography"))
    assert all(m["level"] == 0 and m["mastered"] is False for m in out)
