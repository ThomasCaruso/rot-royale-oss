"""Personalized question ranking — "the recommendation engine matches both".

Given a fetched question bank and a user's taste profile, produce a personalized POOL (a subset of
the bank) for the round generator to draw from. The engine/modules never learn about
personalization — this is the same pre-filter seam category scoping uses (CLAUDE.md §5a).

Fairness gates (checked in should_personalize):
- PERSONALIZATION_ENABLED=false → everything passes through untouched.
- mode="ranked" (Daily Royale) is personalized ONLY when PERSONALIZE_RANKED_DAILY=true, which is
  false by default and should stay false: per-user ranked pools break leaderboard comparability
  and entry-regeneration reproducibility. Duels are never hooked (two players share one set).
- No profile / fewer than MIN_INTERACTIONS interactions / a small bank → untouched (cold start).

Selection mix per spec: 50% proven interests, 25% adjacent topics, 15% weak-but-interesting,
10% exploration. Exploration noise is seeded from the entry seed, so one entry's pool is
deterministic (reproducible) while different entries vary.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from random import Random
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import (
    LEARNING_WARM_MIN_ATTEMPTS,
    LIKED_CATEGORY_MIN_AFFINITY,
    W_LEARNING_NEED,
    WEAK_ONRAMP_CHANCE,
)
from app.models import QuestionAIMetadata, UserSkillState, UserTasteProfile
from app.services.learning_select import SkillView, learning_need

# Cold-start / applicability gates.
MIN_INTERACTIONS = 20
MIN_BANK_TO_PERSONALIZE = 24  # a bank this small is served whole (variety beats tailoring)
POOL_TARGET = 24
MIN_PER_DIFFICULTY = 6  # keep template difficulty slots (easy/medium/hard) satisfiable

SAFE_MODES = frozenset({"practice", "quick", "category", "starter"})

# Scoring weights (spec-locked).
W_CATEGORY = 0.20
W_SUBCATEGORY = 0.20
W_TOPIC = 0.25
W_DIFFICULTY = 0.15
W_NOVELTY = 0.10
W_EDU_HUMOR = 0.05
W_EXPLORATION = 0.05

# Penalties (spec-locked).
P_RECENT_TOPIC = -0.25
P_RECENT_CATEGORY = -0.10
P_DISLIKED = -0.30
P_TOO_EASY = -0.10
P_TOO_HARD = -0.20
P_NEEDS_REVIEW = -0.50

NEUTRAL_SCORE = 0.45  # unclassified questions keep circulating near the middle of the pack
DIFFICULTY_MISMATCH = 0.35  # |meta difficulty − preference| beyond this = too easy / too hard
LIKED_TOPIC_MIN_AFFINITY = 0.1
RECENT_TOPIC_WINDOW = 10
RECENT_CATEGORY_WINDOW = 2

# Selection mix fractions (proven / adjacent / weak / exploration).
MIX = (0.50, 0.25, 0.15, 0.10)


def should_personalize(mode: str) -> bool:
    if not settings.personalization_enabled:
        return False
    if mode == "ranked":
        return settings.personalize_ranked_daily
    return mode in SAFE_MODES


def _norm_affinity(value: float | None) -> float:
    """Map affinity [-1, 1] (unknown → 0) onto [0, 1]."""
    return ((value if value is not None else 0.0) + 1.0) / 2.0


def score_question(
    profile: UserTasteProfile,
    meta: QuestionAIMetadata | None,
    *,
    rng: Random,
    view: SkillView | None = None,
    now: datetime | None = None,
) -> float:
    """One candidate's personalization score. Higher = better fit for this user right now."""
    if meta is None:
        return NEUTRAL_SCORE + rng.random() * W_EXPLORATION

    topics = list(meta.topic_tags)
    category_fit = _norm_affinity(profile.category_affinity.get(meta.category))
    subcategory_fit = (
        _norm_affinity(profile.subcategory_affinity.get(meta.subcategory))
        if meta.subcategory
        else 0.5
    )
    topic_fit = (
        sum(_norm_affinity(profile.topic_affinity.get(t)) for t in topics) / len(topics)
        if topics
        else 0.5
    )

    difficulty_gap = meta.difficulty_score - profile.difficulty_preference
    difficulty_match = 1.0 - abs(difficulty_gap)

    recent_topics = set(profile.last_seen_topic_tags[:RECENT_TOPIC_WINDOW])
    overlap = len([t for t in topics if t in recent_topics]) / len(topics) if topics else 0.0
    novelty = 1.0 - overlap

    edu_match = 1.0 - abs(meta.educational_score - profile.educational_preference)
    humor_match = 1.0 - abs(meta.humor_score - profile.humor_preference)
    edu_or_humor = max(edu_match, humor_match)

    score = (
        category_fit * W_CATEGORY
        + subcategory_fit * W_SUBCATEGORY
        + topic_fit * W_TOPIC
        + difficulty_match * W_DIFFICULTY
        + novelty * W_NOVELTY
        + edu_or_humor * W_EDU_HUMOR
        + rng.random() * W_EXPLORATION
    )

    if any(t in profile.disliked_topics for t in topics):
        score += P_DISLIKED
    if overlap > 0:
        score += P_RECENT_TOPIC * overlap
    if meta.category in profile.last_seen_categories[:RECENT_CATEGORY_WINDOW]:
        score += P_RECENT_CATEGORY
    if difficulty_gap > DIFFICULTY_MISMATCH:
        score += P_TOO_HARD
    elif difficulty_gap < -DIFFICULTY_MISMATCH:
        score += P_TOO_EASY
    if meta.needs_review:
        score += P_NEEDS_REVIEW

    if view is not None and now is not None and meta is not None:
        score += W_LEARNING_NEED * learning_need(view, meta, now, _liked_categories(profile))

    return score


def _liked_topics(profile: UserTasteProfile) -> set[str]:
    return {t for t, a in profile.topic_affinity.items() if a >= LIKED_TOPIC_MIN_AFFINITY}


def _is_adjacent(meta: QuestionAIMetadata, liked: set[str], profile: UserTasteProfile) -> bool:
    """Adjacent = not directly liked, but connected: shares related_topics/audience context with
    liked topics, or sits in a positive category under an unexplored subcategory."""
    if any(t in liked for t in meta.topic_tags):
        return False
    if any(t in liked for t in meta.related_topics):
        return True
    if (
        profile.category_affinity.get(meta.category, 0.0) > 0
        and meta.subcategory
        and meta.subcategory not in profile.subcategory_affinity
    ):
        return True
    return False


def build_personalized_pool(
    bank: list[dict[str, Any]],
    metadata_by_id: dict[str, QuestionAIMetadata],
    profile: UserTasteProfile,
    rng: Random,
    target: int = POOL_TARGET,
    *,
    view: SkillView | None = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """The 50/25/15/10 mix, then a per-difficulty top-up so template slots stay satisfiable."""
    liked = _liked_topics(profile)
    weak = set(profile.weak_but_interesting_topics)

    scored: list[tuple[float, dict[str, Any]]] = []
    for q in bank:
        meta = metadata_by_id.get(q["id"])
        scored.append((score_question(profile, meta, rng=rng, view=view, now=now), q))
    by_score = [q for _, q in sorted(scored, key=lambda pair: -pair[0])]

    def bucket(pred: Any) -> list[dict[str, Any]]:
        return [q for q in by_score if pred(metadata_by_id.get(q["id"]))]

    proven = bucket(lambda m: m is not None and any(t in liked for t in m.topic_tags))
    adjacent = bucket(lambda m: m is not None and _is_adjacent(m, liked, profile))
    weak_pool = bucket(lambda m: m is not None and any(t in weak for t in m.topic_tags))
    explore = list(by_score)
    rng.shuffle(explore)

    pool: list[dict[str, Any]] = []
    seen: set[str] = set()

    def take(source: list[dict[str, Any]], count: int) -> None:
        for q in source:
            if len(pool) >= target or count <= 0:
                return
            if q["id"] not in seen:
                seen.add(q["id"])
                pool.append(q)
                count -= 1

    take(proven, round(target * MIX[0]))
    take(adjacent, round(target * MIX[1]))
    take(weak_pool, round(target * MIX[2]))
    take(explore, round(target * MIX[3]))
    take(by_score, target - len(pool))  # top-up: buckets may be thin

    # Difficulty guarantee: each difficulty that the BANK can support keeps representation.
    for difficulty in ("easy", "medium", "hard"):
        available = [q for q in by_score if q.get("difficulty") == difficulty]
        if len(available) < MIN_PER_DIFFICULTY:
            continue
        have = sum(1 for q in pool if q.get("difficulty") == difficulty)
        for q in available:
            if have >= MIN_PER_DIFFICULTY:
                break
            if q["id"] not in seen:
                seen.add(q["id"])
                pool.append(q)
                have += 1

    return pool


def _liked_categories(profile: UserTasteProfile) -> frozenset[str]:
    """Categories the player engages with (affinity at or above the wheelhouse threshold)."""
    return frozenset(
        c for c, a in (profile.category_affinity or {}).items() if a >= LIKED_CATEGORY_MIN_AFFINITY
    )


def _maybe_weak_onramp(
    pool: list[dict[str, Any]],
    bank: list[dict[str, Any]],
    metadata_by_id: dict[str, QuestionAIMetadata],
    liked_categories: frozenset[str],
    rng: Random,
) -> list[dict[str, Any]]:
    """Rarely swap one pool slot for an EASY question from a subject OUTSIDE the player's wheelhouse
    — a gentle, occasional on-ramp into a weak/avoided category, always starting easy so it never
    feels punishing. No-op most sessions (WEAK_ONRAMP_CHANCE) and when no such question exists."""
    if not pool or rng.random() >= WEAK_ONRAMP_CHANCE:
        return pool
    pool_ids = {q["id"] for q in pool}
    candidates = [
        q
        for q in bank
        if q["id"] not in pool_ids
        and q.get("difficulty") == "easy"
        and (m := metadata_by_id.get(q["id"])) is not None
        and m.category not in liked_categories
    ]
    if not candidates:
        return pool
    pick = rng.choice(candidates)
    return [*pool[:-1], pick]  # replace the lowest-priority tail slot; keep pool size


async def personalize_bank(
    session: AsyncSession,
    user_id: uuid.UUID,
    bank: list[dict[str, Any]],
    *,
    mode: str,
    seed: int,
) -> list[dict[str, Any]]:
    """Trim a fetched bank to a personalized pool — or return it untouched (the common case).

    Untouched when: flag off, unsafe/ranked mode, cold-start profile, or a small bank. Ranked
    Daily Royale passes through here with mode="ranked" so the PERSONALIZE_RANKED_DAILY gate is
    enforced in exactly one place.
    """
    if not should_personalize(mode):
        return bank
    if len(bank) <= MIN_BANK_TO_PERSONALIZE:
        return bank
    profile = await session.get(UserTasteProfile, user_id)
    if profile is None or profile.interaction_count < MIN_INTERACTIONS:
        return bank

    qids = [uuid.UUID(q["id"]) for q in bank]
    rows = (
        await session.execute(
            select(QuestionAIMetadata).where(QuestionAIMetadata.question_id.in_(qids))
        )
    ).scalars()
    metadata_by_id = {str(m.question_id): m for m in rows}
    if not metadata_by_id:
        return bank  # nothing classified yet — personalization has no signal to rank on

    skill_state = await session.get(UserSkillState, user_id)
    warm = (
        skill_state is not None
        and sum(int(v.get("attempts", 0)) for v in (skill_state.category_ability or {}).values())
        >= LEARNING_WARM_MIN_ATTEMPTS
    )
    view = SkillView.from_state(skill_state) if warm else None
    now = datetime.now(UTC)

    rng = Random(f"personalize:{seed}")
    pool = build_personalized_pool(bank, metadata_by_id, profile, rng, view=view, now=now)
    if view is not None:  # on-ramp only for adaptive (warm) players
        pool = _maybe_weak_onramp(pool, bank, metadata_by_id, _liked_categories(profile), rng)
    return pool
