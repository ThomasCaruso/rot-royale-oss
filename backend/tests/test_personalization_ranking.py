"""Personalized ranking — scoring, fairness gates, pool building, determinism."""

from __future__ import annotations

import uuid
from random import Random
from typing import Any

from app.core.config import settings
from app.models import Question, QuestionAIMetadata, User, UserTasteProfile
from app.services.personalization import (
    MIN_INTERACTIONS,
    build_personalized_pool,
    personalize_bank,
    score_question,
    should_personalize,
)
from pytest import MonkeyPatch
from sqlalchemy.ext.asyncio import AsyncSession


def _meta(**over: Any) -> QuestionAIMetadata:
    base: dict[str, Any] = {
        "question_id": uuid.uuid4(),
        "category": "Sports",
        "subcategory": "NBA",
        "topic_tags": ["basketball"],
        "audience_tags": ["sports_fans"],
        "related_topics": [],
        "difficulty_score": 0.5,
        "knowledge_type": "specific_fact",
        "freshness_type": "evergreen",
        "humor_score": 0.3,
        "brainrot_score": 0.3,
        "educational_score": 0.5,
        "controversy_risk": 0.05,
        "ambiguity_risk": 0.05,
        "quality_score": 0.9,
        "llm_confidence": 0.9,
        "needs_review": False,
        "classification_version": "v1",
    }
    base.update(over)
    return QuestionAIMetadata(**base)


def _profile(**over: Any) -> UserTasteProfile:
    base: dict[str, Any] = {
        "user_id": uuid.uuid4(),
        "category_affinity": {},
        "subcategory_affinity": {},
        "topic_affinity": {},
        "difficulty_preference": 0.5,
        "humor_preference": 0.5,
        "brainrot_tolerance": 0.5,
        "novelty_preference": 0.5,
        "educational_preference": 0.5,
        "disliked_topics": [],
        "weak_but_interesting_topics": [],
        "last_seen_topic_tags": [],
        "last_seen_categories": [],
        "interaction_count": 50,
        "confidence_score": 1.0,
    }
    base.update(over)
    return UserTasteProfile(**base)


# ── score_question ────────────────────────────────────────────────────────────


def test_score_favors_liked_topics_and_categories() -> None:
    profile = _profile(
        category_affinity={"Sports": 0.8},
        topic_affinity={"basketball": 0.8},
    )
    liked = score_question(profile, _meta(), rng=Random(1))
    neutral = score_question(
        profile,
        _meta(category="History", subcategory=None, topic_tags=["treaties"]),
        rng=Random(1),
    )
    assert liked > neutral


def test_score_penalizes_disliked_and_recent_topics() -> None:
    profile = _profile(disliked_topics=["basketball"])
    disliked = score_question(profile, _meta(), rng=Random(1))
    clean = score_question(profile, _meta(topic_tags=["tennis"]), rng=Random(1))
    assert clean - disliked > 0.25  # −0.30 dislike penalty dominates the noise term

    recent = _profile(last_seen_topic_tags=["basketball"])
    seen = score_question(recent, _meta(), rng=Random(1))
    fresh = score_question(recent, _meta(topic_tags=["tennis"]), rng=Random(1))
    assert fresh > seen


def test_score_penalizes_needs_review_and_difficulty_mismatch() -> None:
    profile = _profile()
    ok = score_question(profile, _meta(), rng=Random(1))
    flagged = score_question(profile, _meta(needs_review=True), rng=Random(1))
    assert ok - flagged > 0.4  # −0.50 penalty

    novice = _profile(difficulty_preference=0.2)
    matched = score_question(novice, _meta(difficulty_score=0.25), rng=Random(1))
    too_hard = score_question(novice, _meta(difficulty_score=0.9), rng=Random(1))
    assert matched > too_hard


# ── gates ─────────────────────────────────────────────────────────────────────


def test_should_personalize_gates(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "personalization_enabled", True)
    monkeypatch.setattr(settings, "personalize_ranked_daily", False)
    assert should_personalize("practice")
    assert should_personalize("quick")
    assert should_personalize("category")
    assert not should_personalize("ranked")  # Daily Royale stays fair
    assert not should_personalize("duel")

    monkeypatch.setattr(settings, "personalize_ranked_daily", True)
    assert should_personalize("ranked")

    monkeypatch.setattr(settings, "personalization_enabled", False)
    assert not should_personalize("practice")
    assert not should_personalize("ranked")


# ── personalize_bank (DB) ─────────────────────────────────────────────────────


async def _seed_bank(
    db_session: AsyncSession,
    *,
    liked_count: int = 20,
    disliked_count: int = 20,
) -> tuple[User, list[dict[str, Any]]]:
    """A user with a strong profile + a bank half liked-topic, half disliked-topic questions."""
    user = User(email=f"{uuid.uuid4().hex[:12]}@example.com", password_hash="x")
    db_session.add(user)
    await db_session.flush()

    bank: list[dict[str, Any]] = []
    specs = [("space", liked_count), ("opera", disliked_count)]
    difficulties = ["easy", "medium", "hard"]
    for topic, count in specs:
        for i in range(count):
            q = Question(
                module_type="trivia",
                category="Science & Nature" if topic == "space" else "Arts & Literature",
                icon="⭐",
                payload={
                    "prompt": f"{topic} {i}?",
                    "options": ["a", "b", "c", "d"],
                    "correctIndex": 0,
                },
                difficulty=difficulties[i % 3],
                status="approved",
            )
            db_session.add(q)
            await db_session.flush()
            db_session.add(
                _meta(question_id=q.id, topic_tags=[topic], category=q.category, subcategory=None)
            )
            bank.append(
                {
                    "id": str(q.id),
                    "category": q.category,
                    "icon": q.icon,
                    "difficulty": q.difficulty,
                    "explanation": None,
                    "payload": q.payload,
                }
            )
    await db_session.flush()

    db_session.add(
        _profile(
            user_id=user.id,
            category_affinity={"Science & Nature": 0.8, "Arts & Literature": -0.5},
            topic_affinity={"space": 0.9, "opera": -0.6},
            disliked_topics=["opera"],
        )
    )
    await db_session.flush()
    return user, bank


async def test_personalize_bank_favors_interests(db_session: AsyncSession) -> None:
    user, bank = await _seed_bank(db_session)
    pool = await personalize_bank(db_session, user.id, bank, mode="practice", seed=42)

    assert len(pool) < len(bank)
    liked_ids = {q["id"] for q in bank if "space" in q["payload"]["prompt"]}
    liked_in_pool = sum(1 for q in pool if q["id"] in liked_ids)
    disliked_in_pool = len(pool) - liked_in_pool
    assert liked_in_pool > disliked_in_pool


async def test_personalize_bank_deterministic_per_seed(db_session: AsyncSession) -> None:
    user, bank = await _seed_bank(db_session)
    a = await personalize_bank(db_session, user.id, bank, mode="practice", seed=7)
    b = await personalize_bank(db_session, user.id, bank, mode="practice", seed=7)
    assert [q["id"] for q in a] == [q["id"] for q in b]


async def test_personalize_bank_keeps_difficulty_coverage(db_session: AsyncSession) -> None:
    user, bank = await _seed_bank(db_session)
    pool = await personalize_bank(db_session, user.id, bank, mode="category", seed=3)
    for difficulty in ("easy", "medium", "hard"):
        assert sum(1 for q in pool if q["difficulty"] == difficulty) >= 6


async def test_ranked_daily_not_personalized_by_default(
    db_session: AsyncSession, monkeypatch: MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "personalize_ranked_daily", False)
    user, bank = await _seed_bank(db_session)
    pool = await personalize_bank(db_session, user.id, bank, mode="ranked", seed=42)
    assert pool is bank  # untouched — every ranked player draws from the same bank

    monkeypatch.setattr(settings, "personalize_ranked_daily", True)
    pool = await personalize_bank(db_session, user.id, bank, mode="ranked", seed=42)
    assert pool is not bank and len(pool) < len(bank)


async def test_cold_start_and_small_bank_untouched(db_session: AsyncSession) -> None:
    user, bank = await _seed_bank(db_session)

    # low interaction count → untouched
    profile = await db_session.get(UserTasteProfile, user.id)
    assert profile is not None
    profile.interaction_count = MIN_INTERACTIONS - 1
    await db_session.flush()
    assert await personalize_bank(db_session, user.id, bank, mode="practice", seed=1) is bank

    # no profile at all → untouched
    stranger = User(email=f"{uuid.uuid4().hex[:12]}@example.com", password_hash="x")
    db_session.add(stranger)
    await db_session.flush()
    assert await personalize_bank(db_session, stranger.id, bank, mode="practice", seed=1) is bank

    # small bank → untouched even with a strong profile
    profile.interaction_count = 50
    await db_session.flush()
    small = bank[:10]
    assert await personalize_bank(db_session, user.id, small, mode="practice", seed=1) is small


def test_pool_mixes_weak_but_interesting() -> None:
    """Weak-but-interesting topics reserve ~15% of the pool even at negative-ish mastery."""
    profile = _profile(
        topic_affinity={"space": 0.9, "poetry": -0.05},
        weak_but_interesting_topics=["poetry"],
    )
    bank: list[dict[str, Any]] = []
    metadata: dict[str, QuestionAIMetadata] = {}
    for topic, count in (("space", 30), ("poetry", 10)):
        for _i in range(count):
            qid = str(uuid.uuid4())
            bank.append(
                {
                    "id": qid,
                    "category": "x",
                    "icon": "⭐",
                    "difficulty": "medium",
                    "explanation": None,
                    "payload": {},
                }
            )
            metadata[qid] = _meta(
                question_id=uuid.UUID(qid), topic_tags=[topic], category="x", subcategory=None
            )
    pool = build_personalized_pool(bank, metadata, profile, Random(5))
    poetry_ids = {qid for qid, m in metadata.items() if "poetry" in m.topic_tags}
    assert sum(1 for q in pool if q["id"] in poetry_ids) >= 3
