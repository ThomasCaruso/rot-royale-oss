"""apply_answer_to_skill_state: one answer updates the persisted per-user skill state."""

from __future__ import annotations

import uuid

from app.models import Question, QuestionAIMetadata, User, UserSkillState
from app.services.skill_state import apply_answer_to_skill_state
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def _user(session: AsyncSession) -> uuid.UUID:
    user = User(email=f"{uuid.uuid4().hex[:12]}@example.com", password_hash="x")
    session.add(user)
    await session.flush()
    return user.id


async def _classified_question(
    session: AsyncSession, *, category: str, topics: list[str], difficulty: float
) -> uuid.UUID:
    q = Question(
        module_type="trivia",
        category=category,
        icon="⭐",
        payload={"prompt": "q?", "options": ["a", "b", "c", "d"], "correctIndex": 0},
        difficulty="medium",
        status="approved",
    )
    session.add(q)
    await session.flush()
    session.add(
        QuestionAIMetadata(
            question_id=q.id,
            category=category,
            topic_tags=topics,
            difficulty_score=difficulty,
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
    await session.flush()
    return q.id


async def _state(session: AsyncSession, user_id: uuid.UUID) -> UserSkillState | None:
    return await session.scalar(select(UserSkillState).where(UserSkillState.user_id == user_id))


async def test_first_correct_answer_creates_state_and_moves_ability(db_session: AsyncSession):
    user_id = await _user(db_session)
    qid = await _classified_question(
        db_session, category="Science & Nature", topics=["astronomy"], difficulty=0.7
    )

    await apply_answer_to_skill_state(db_session, user_id, qid, correct=True)

    state = await _state(db_session, user_id)
    assert state is not None
    cat = state.category_ability["Science & Nature"]
    assert cat["attempts"] == 1 and cat["theta"] > 0.0
    topic = state.topic_knowledge["astronomy"]
    assert topic["attempts"] == 1 and topic["p_known"] > 0.30


async def test_repeated_answers_accumulate_attempts(db_session: AsyncSession):
    user_id = await _user(db_session)
    qid = await _classified_question(db_session, category="History", topics=["ww2"], difficulty=0.5)
    await apply_answer_to_skill_state(db_session, user_id, qid, correct=True)
    await apply_answer_to_skill_state(db_session, user_id, qid, correct=False)

    state = await _state(db_session, user_id)
    assert state.category_ability["History"]["attempts"] == 2
    assert state.topic_knowledge["ww2"]["attempts"] == 2


async def test_unclassified_question_is_a_noop(db_session: AsyncSession):
    user_id = uuid.uuid4()
    await apply_answer_to_skill_state(db_session, user_id, uuid.uuid4(), correct=True)
    assert await _state(db_session, user_id) is None


async def test_none_question_id_is_a_noop(db_session: AsyncSession):
    user_id = uuid.uuid4()
    await apply_answer_to_skill_state(db_session, user_id, None, correct=True)
    assert await _state(db_session, user_id) is None


async def test_record_answer_signal_captures_skill_state(db_session: AsyncSession):
    from app.services.taste_profile import record_answer_signal

    user_id = await _user(db_session)
    qid = await _classified_question(
        db_session, category="Geography", topics=["rivers"], difficulty=0.6
    )

    await record_answer_signal(
        db_session,
        user_id,
        question_id=qid,
        mode="practice",
        is_correct=True,
        time_frac=0.7,
        limit_ms=10000,
        streak_before=0,
        streak_after=1,
        session_id=None,
    )

    state = await _state(db_session, user_id)
    assert state is not None
    assert state.category_ability["Geography"]["attempts"] == 1


async def test_skill_capture_does_not_affect_ranked_selection(db_session: AsyncSession):
    """Phase 1 only WRITES skill state; it must never influence the ranked Daily Royale draw.
    personalize_bank already no-ops for mode='ranked' while personalize_ranked_daily is False —
    this pins that Phase 1 added no ranked read path and the fairness invariant still holds."""
    from app.core.config import settings
    from app.services.personalization import personalize_bank

    assert settings.personalize_ranked_daily is False
    bank = [{"id": str(uuid.uuid4())} for _ in range(30)]
    out = await personalize_bank(db_session, uuid.uuid4(), bank, mode="ranked", seed=1)
    assert out == bank  # ranked in → same bank out, untouched


async def test_topic_update_records_review_schedule(db_session: AsyncSession):
    from datetime import UTC, datetime

    user_id = await _user(db_session)
    qid = await _classified_question(
        db_session, category="Science & Nature", topics=["cells"], difficulty=0.5
    )
    now = datetime(2026, 7, 9, 12, 0, tzinfo=UTC)
    await apply_answer_to_skill_state(db_session, user_id, qid, correct=True, now=now)

    topic = (await _state(db_session, user_id)).topic_knowledge["cells"]
    assert topic["last_answered_at"] == now.isoformat()
    assert topic["review_due_at"] > now.isoformat()
