"""Pure knowledge-tracing math for the adaptive-learning engine (Phase 1).

Two estimators, no DB, no I/O — every function is deterministic and unit-tested:

  * Category ability ``theta`` — an online 1PL-IRT / Elo estimate on a logit scale. Item difficulty
    ``b`` comes from the LLM ``difficulty_score``; the update size scales with the surprise
    (outcome - expected) and a learning rate that decays with attempts, so a settled ability is
    stable but still tracks real change.
  * Per-topic ``p_known`` — a Bayesian Knowledge Tracing posterior (guess/slip/transition).
  * ``effective_p_known`` — hierarchical shrinkage: a thin topic (few attempts) is blended toward
    the category-implied prior so sparse per-topic data can't swing wildly.
"""

from __future__ import annotations

import math

from app.core.constants import (
    BKT_P_GUESS,
    BKT_P_SLIP,
    BKT_P_TRANSIT,
    KT_DIFFICULTY_MAX,
    KT_DIFFICULTY_MIN,
    KT_K_BASE,
    KT_K_DECAY,
    KT_K_MIN,
    REVIEW_BASE_HOURS,
    REVIEW_MAX_HOURS,
    TOPIC_INDEPENDENCE_MIN,
)


def _clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def difficulty_to_b(difficulty_score: float) -> float:
    """Map an LLM difficulty_score in [0, 1] to an item difficulty ``b`` on the ability scale."""
    d = _clamp(difficulty_score, 0.0, 1.0)
    return KT_DIFFICULTY_MIN + d * (KT_DIFFICULTY_MAX - KT_DIFFICULTY_MIN)


def expected_correct(theta: float, b: float) -> float:
    """1PL-IRT response function: probability an ability ``theta`` answers item ``b`` correctly."""
    return 1.0 / (1.0 + math.exp(-(theta - b)))


def update_theta(
    theta: float, attempts: int, difficulty_score: float, correct: bool
) -> tuple[float, int]:
    """Online ability update. Returns (new_theta, attempts + 1)."""
    b = difficulty_to_b(difficulty_score)
    p = expected_correct(theta, b)
    k = max(KT_K_MIN, KT_K_BASE / (1.0 + attempts / KT_K_DECAY))
    outcome = 1.0 if correct else 0.0
    return theta + k * (outcome - p), attempts + 1


def bkt_update(p_known: float, correct: bool) -> float:
    """BKT posterior + learning step. Returns the new P(known) in [0, 1]."""
    p = _clamp(p_known, 0.0, 1.0)
    if correct:
        num = p * (1.0 - BKT_P_SLIP)
        den = num + (1.0 - p) * BKT_P_GUESS
    else:
        num = p * BKT_P_SLIP
        den = num + (1.0 - p) * (1.0 - BKT_P_GUESS)
    posterior = num / den if den > 0.0 else p
    return _clamp(posterior + (1.0 - posterior) * BKT_P_TRANSIT, 0.0, 1.0)


def category_prior_known(theta: float) -> float:
    """The category-implied prior P(known) for a typical (average-difficulty) item."""
    return expected_correct(theta, 0.0)


def effective_p_known(bkt_p: float, category_prior: float, topic_attempts: int) -> float:
    """Shrinkage blend: thin topics lean on the category prior, sampled topics trust their BKT."""
    w = min(1.0, topic_attempts / TOPIC_INDEPENDENCE_MIN)
    return w * bkt_p + (1.0 - w) * category_prior


def next_review_hours(p_known: float, correct: bool) -> float:
    """Hours until a topic should resurface. Wrong -> 0 (next session); higher mastery -> longer gap
    (Leitner-style expanding interval), clamped to [REVIEW_BASE_HOURS, REVIEW_MAX_HOURS]."""
    if not correct:
        return 0.0
    frac = _clamp((p_known - 0.3) / 0.65, 0.0, 1.0)
    return REVIEW_BASE_HOURS + frac * (REVIEW_MAX_HOURS - REVIEW_BASE_HOURS)
