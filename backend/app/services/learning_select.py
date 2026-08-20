"""Learning-need projection + scorer for adaptive selection (Phase 2).

`SkillView` is a read-only projection of a user's UserSkillState. `learning_need` scores a candidate
question in [0, 1] combining:
  * difficulty fit — how close the predicted success (given the user's category ability and the
    question's difficulty) is to the fun-first target (~82%); peaks at the target, falls off away.
  * weak-due boost — extra pull for a question in a topic the user is weak at (low effective
    P(known)) AND that is review-due (spaced repetition).
A view with no ability for the question's category contributes 0, so cold users are unaffected.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.core.constants import KT_TARGET_SUCCESS, KT_THETA_INIT, WEAK_TOPIC_P_KNOWN_MAX
from app.services.skill_model import (
    category_prior_known,
    difficulty_to_b,
    effective_p_known,
    expected_correct,
)


@dataclass(frozen=True)
class SkillView:
    """Read-only projection of UserSkillState for selection."""

    category: dict[str, dict[str, Any]]  # category -> {"theta": float, "attempts": int}
    topic: dict[str, dict[str, Any]]  # topic -> {"p_known", "attempts", "review_due_at", ...}

    @classmethod
    def from_state(cls, state: Any | None) -> SkillView:
        if state is None:
            return cls(category={}, topic={})
        return cls(
            category=dict(state.category_ability or {}),
            topic=dict(state.topic_knowledge or {}),
        )

    def total_attempts(self) -> int:
        return sum(int(c.get("attempts", 0)) for c in self.category.values())

    def theta(self, category: str) -> float:
        c = self.category.get(category)
        return float(c["theta"]) if c else KT_THETA_INIT

    def has_category(self, category: str) -> bool:
        return category in self.category


def _difficulty_fit(theta: float, difficulty_score: float) -> float:
    """1.0 when predicted success == target, decaying linearly with the gap."""
    p = expected_correct(theta, difficulty_to_b(difficulty_score))
    return 1.0 - min(1.0, abs(p - KT_TARGET_SUCCESS) / KT_TARGET_SUCCESS)


def _weak_due_boost(view: SkillView, meta: Any, now: datetime) -> float:
    """Max pull over the question's topics that are weak (low effective P(known)) AND review-due."""
    cat_prior = category_prior_known(view.theta(meta.category))
    boost = 0.0
    for topic in getattr(meta, "topic_tags", None) or []:
        t = view.topic.get(topic)
        if t is None:
            continue
        eff = effective_p_known(float(t["p_known"]), cat_prior, int(t.get("attempts", 0)))
        due_at = t.get("review_due_at")
        is_due = due_at is not None and str(due_at) <= now.isoformat()
        if eff < WEAK_TOPIC_P_KNOWN_MAX and is_due:
            boost = max(boost, WEAK_TOPIC_P_KNOWN_MAX - eff)
    return boost


def learning_need(
    view: SkillView, meta: Any, now: datetime, liked_categories: frozenset[str]
) -> float:
    """Combined learning-need score in [0, 1]. 0 when the category is unseen (cold). The difficulty
    fit applies everywhere; the weak-topic stretch only fires inside subjects the player engages
    with (liked_categories) so improvement stays in their wheelhouse."""
    if meta is None or not view.has_category(meta.category):
        return 0.0
    fit = _difficulty_fit(view.theta(meta.category), float(meta.difficulty_score))
    boost = _weak_due_boost(view, meta, now) if meta.category in liked_categories else 0.0
    return min(1.0, 0.6 * fit + 0.4 * boost)
