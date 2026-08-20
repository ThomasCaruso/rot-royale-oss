"""SkillView projection + learning_need scorer: pure, no DB."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.services.learning_select import SkillView, learning_need


class _Meta:
    """Minimal stand-in for QuestionAIMetadata (only the fields the scorer reads)."""

    def __init__(self, category, topic_tags, difficulty_score):
        self.category = category
        self.topic_tags = topic_tags
        self.difficulty_score = difficulty_score


NOW = datetime(2026, 7, 9, 12, 0, tzinfo=UTC)


def _view(category=None, topic=None) -> SkillView:
    return SkillView(category=category or {}, topic=topic or {})


def test_cold_view_has_zero_learning_need():
    v = _view()
    m = _Meta("Science & Nature", ["astronomy"], 0.5)
    assert learning_need(v, m, NOW, frozenset()) == 0.0


def test_difficulty_fit_peaks_near_target_success():
    v = _view(category={"History": {"theta": 0.0, "attempts": 1}})
    near_target = _Meta("History", [], 0.20)  # predicted success ~0.82 (== target)
    too_easy = _Meta("History", [], 0.0)  # predicted ~0.92, farther from target
    assert learning_need(v, near_target, NOW, frozenset({"History"})) > learning_need(
        v, too_easy, NOW, frozenset({"History"})
    )


def test_weak_due_topic_boosts_score():
    past = (NOW - timedelta(hours=1)).isoformat()
    v = _view(
        category={"Geography": {"theta": 0.0, "attempts": 1}},
        topic={"capitals": {"p_known": 0.2, "attempts": 6, "review_due_at": past}},
    )
    weak_due = _Meta("Geography", ["capitals"], 0.35)
    unrelated = _Meta("Geography", ["rivers"], 0.35)
    assert learning_need(v, weak_due, NOW, frozenset({"Geography"})) > learning_need(
        v, unrelated, NOW, frozenset({"Geography"})
    )


def test_weak_topic_not_yet_due_does_not_boost():
    future = (NOW + timedelta(hours=48)).isoformat()
    v = _view(
        category={"Geography": {"theta": 0.0, "attempts": 1}},
        topic={"capitals": {"p_known": 0.2, "attempts": 6, "review_due_at": future}},
    )
    not_due = _Meta("Geography", ["capitals"], 0.35)
    unrelated = _Meta("Geography", ["rivers"], 0.35)
    assert learning_need(v, not_due, NOW, frozenset({"Geography"})) == learning_need(
        v, unrelated, NOW, frozenset({"Geography"})
    )


def test_from_state_handles_none_and_totals_attempts():
    assert SkillView.from_state(None).total_attempts() == 0

    class _State:
        category_ability = {
            "History": {"theta": 0.4, "attempts": 10},
            "Sports": {"theta": -0.2, "attempts": 5},
        }
        topic_knowledge = {"ww2": {"p_known": 0.7, "attempts": 3, "review_due_at": NOW.isoformat()}}

    v = SkillView.from_state(_State())
    assert v.total_attempts() == 15
    assert v.theta("History") == 0.4


def test_weak_due_topic_ignored_outside_liked_categories():
    past = (NOW - timedelta(hours=1)).isoformat()
    v = _view(
        category={"Geography": {"theta": 0.0, "attempts": 1}},
        topic={"capitals": {"p_known": 0.2, "attempts": 6, "review_due_at": past}},
    )
    weak_due = _Meta("Geography", ["capitals"], 0.35)
    unrelated = _Meta("Geography", ["rivers"], 0.35)
    # Geography NOT in liked → the weak-spot stretch does NOT fire; both score equal (fit only).
    assert learning_need(v, weak_due, NOW, frozenset()) == learning_need(
        v, unrelated, NOW, frozenset()
    )
