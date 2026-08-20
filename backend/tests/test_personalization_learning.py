"""Phase 2 Task 3 — the adaptive learning-need term threaded into personalization.

Test A is the deterministic unit-level proof that a weak+due topic boosts a candidate's
score_question value. Test B is an integration smoke: warm and cold users both get a valid pool
(warm-gated, cold-start-safe) with no error.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from random import Random

from app.models import QuestionAIMetadata, User, UserSkillState, UserTasteProfile
from app.services.learning_select import SkillView
from app.services.personalization import personalize_bank, score_question
from sqlalchemy.ext.asyncio import AsyncSession


class _Profile:
    """Lightweight UserTasteProfile stand-in — score_question only reads attributes."""

    category_affinity: dict[str, float] = {}
    subcategory_affinity: dict[str, float] = {}
    topic_affinity: dict[str, float] = {}
    difficulty_preference = 0.5
    humor_preference = 0.5
    educational_preference = 0.5
    disliked_topics: list[str] = []
    weak_but_interesting_topics: list[str] = []
    last_seen_topic_tags: list[str] = []
    last_seen_categories: list[str] = []


class _Meta:
    """Lightweight QuestionAIMetadata stand-in for score_question."""

    def __init__(self) -> None:
        self.category = "Geography"
        self.subcategory = None
        self.topic_tags = ["capitals"]
        self.related_topics: list[str] = []
        self.difficulty_score = 0.35
        self.educational_score = 0.5
        self.humor_score = 0.3
        self.needs_review = False


def test_score_question_learning_need_boosts_weak_due_topic():
    profile = _Profile()
    profile.category_affinity = {"Geography": 0.5}  # Geography liked -> weak-due stretch fires
    meta = _Meta()
    now = datetime(2026, 7, 9, 12, 0, tzinfo=UTC)
    past = (now - timedelta(hours=1)).isoformat()

    # Category seen (theta 0.0 -> prior 0.5, difficulty_fit contributes) with a weak+due topic:
    # p_known 0.2 with 8 attempts (>= independence min) -> effective P(known) 0.2 < 0.60 = weak,
    # and review_due_at in the past = due.
    view = SkillView(
        category={"Geography": {"theta": 0.0, "attempts": 20}},
        topic={"capitals": {"p_known": 0.2, "attempts": 8, "review_due_at": past}},
    )

    with_view = score_question(profile, meta, rng=Random(1), view=view, now=now)
    without_view = score_question(profile, meta, rng=Random(1))

    assert with_view > without_view, (with_view, without_view)


async def test_personalize_bank_warm_and_cold_both_return_valid_pool(db_session: AsyncSession):
    categories = ["Geography", "History", "Science & Nature"]
    bank: list[dict] = []
    for i in range(30):
        category = categories[i % len(categories)]
        from app.models import Question

        question = Question(
            module_type="trivia",
            category=category,
            icon="⭐",
            payload={"prompt": "q?", "options": ["a", "b", "c", "d"], "correctIndex": 0},
            difficulty=("easy", "medium", "hard")[i % 3],
            status="approved",
        )
        db_session.add(question)
        await db_session.flush()
        db_session.add(
            QuestionAIMetadata(
                question_id=question.id,
                category=category,
                topic_tags=["capitals"] if category == "Geography" else ["misc"],
                difficulty_score=0.35 + (i % 3) * 0.2,
                knowledge_type="specific_fact",
                freshness_type="evergreen",
                humor_score=0.3,
                brainrot_score=0.3,
                educational_score=0.5,
                controversy_risk=0.05,
                ambiguity_risk=0.05,
                quality_score=0.9,
                llm_confidence=0.9,
                classification_version="v1",
            )
        )
        bank.append(
            {
                "id": str(question.id),
                "category": category,
                "icon": "⭐",
                "difficulty": ("easy", "medium", "hard")[i % 3],
                "explanation": None,
                "payload": question.payload,
            }
        )
    await db_session.flush()

    # Warm user: enough interactions + a warm skill state (>= LEARNING_WARM_MIN_ATTEMPTS).
    warm_user = User(email=f"{uuid.uuid4().hex[:12]}@example.com", password_hash="x")
    db_session.add(warm_user)
    await db_session.flush()
    db_session.add(
        UserTasteProfile(
            user_id=warm_user.id,
            interaction_count=30,
            confidence_score=1.0,
        )
    )
    now = datetime.now(UTC)
    past = (now - timedelta(hours=1)).isoformat()
    db_session.add(
        UserSkillState(
            user_id=warm_user.id,
            category_ability={"Geography": {"theta": 0.0, "attempts": 20}},
            topic_knowledge={"capitals": {"p_known": 0.2, "attempts": 8, "review_due_at": past}},
        )
    )
    await db_session.flush()

    out = await personalize_bank(db_session, warm_user.id, bank, mode="quick", seed=7)
    assert isinstance(out, list)
    assert 0 < len(out) <= len(bank)
    bank_ids = {q["id"] for q in bank}
    assert all(q["id"] in bank_ids for q in out)

    # Cold user: no taste profile, no skill state -> untouched bank (MIN_INTERACTIONS gate).
    cold_user_id = uuid.uuid4()
    out2 = await personalize_bank(db_session, cold_user_id, bank, mode="quick", seed=7)
    assert out2 == bank
