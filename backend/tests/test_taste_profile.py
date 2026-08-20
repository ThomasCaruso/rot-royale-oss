"""Taste profile updates — signal scoring, clamping, weak/disliked topic logic."""

from __future__ import annotations

import uuid
from typing import Any

from app.core.config import settings
from app.models import Question, QuestionAIMetadata, QuestionInteractionEvent, User
from app.services.taste_profile import (
    get_or_create_profile,
    interest_signal,
    question_id_from_server_answer,
    record_answer_signal,
    update_profile_from_event,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def _user(session: AsyncSession) -> User:
    user = User(email=f"{uuid.uuid4().hex[:12]}@example.com", password_hash="x")
    session.add(user)
    await session.flush()
    return user


async def _question_with_meta(
    session: AsyncSession,
    *,
    category: str = "Sports",
    subcategory: str | None = "NBA",
    topics: list[str] | None = None,
    humor: float = 0.1,
    brainrot: float = 0.2,
    educational: float = 0.4,
) -> Question:
    q = Question(
        module_type="trivia",
        category=category,
        icon="🏀",
        payload={
            "prompt": f"Q {uuid.uuid4().hex[:8]}?",
            "options": ["a", "b", "c", "d"],
            "correctIndex": 0,
        },
        difficulty="medium",
        status="approved",
        explanation="because",
    )
    session.add(q)
    await session.flush()
    session.add(
        QuestionAIMetadata(
            question_id=q.id,
            category=category,
            subcategory=subcategory,
            topic_tags=topics if topics is not None else ["lebron james", "nba history"],
            audience_tags=["sports_fans"],
            related_topics=["los angeles lakers"],
            difficulty_score=0.5,
            knowledge_type="specific_fact",
            freshness_type="evergreen",
            humor_score=humor,
            brainrot_score=brainrot,
            educational_score=educational,
            controversy_risk=0.05,
            ambiguity_risk=0.05,
            quality_score=0.9,
            llm_confidence=0.9,
            needs_review=False,
            classification_version="v1",
        )
    )
    await session.flush()
    return q


def _event(
    user_id: uuid.UUID, question_id: uuid.UUID | None, **over: Any
) -> QuestionInteractionEvent:
    base: dict[str, Any] = {
        "user_id": user_id,
        "question_id": question_id,
        "mode": "practice",
        "timed_out": False,
        "quit_after": False,
        "explanation_opened": False,
        "shared_after": False,
        "replayed_after": False,
    }
    base.update(over)
    return QuestionInteractionEvent(**base)


async def test_profile_created_automatically(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    profile = await get_or_create_profile(db_session, user.id)
    assert profile.interaction_count == 0
    assert profile.difficulty_preference == 0.5
    again = await get_or_create_profile(db_session, user.id)
    assert again is profile


async def test_fast_correct_increases_affinities_and_difficulty(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    q = await _question_with_meta(db_session)
    event = _event(user.id, q.id, is_correct=True, response_ms=1500)

    profile = await update_profile_from_event(db_session, user.id, event)
    assert profile.category_affinity["Sports"] == 0.06
    assert profile.subcategory_affinity["NBA"] == 0.06
    assert profile.topic_affinity["lebron james"] == 0.06
    assert profile.difficulty_preference == 0.52
    assert profile.interaction_count == 1
    assert profile.confidence_score == 0.02
    assert profile.last_seen_categories == ["Sports"]
    assert "lebron james" in profile.last_seen_topic_tags


async def test_slow_correct_smaller_than_fast(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    q = await _question_with_meta(db_session)
    await update_profile_from_event(
        db_session, user.id, _event(user.id, q.id, is_correct=True, response_ms=9000)
    )
    profile = await get_or_create_profile(db_session, user.id)
    assert profile.category_affinity["Sports"] == 0.02


async def test_wrong_plus_explanation_read_marks_weak_but_interesting(
    db_session: AsyncSession,
) -> None:
    user = await _user(db_session)
    q = await _question_with_meta(db_session, topics=["quantum physics"])
    event = _event(
        user.id,
        q.id,
        is_correct=False,
        response_ms=6000,
        explanation_opened=True,
        explanation_read_ms=4000,
    )
    profile = await update_profile_from_event(db_session, user.id, event)
    assert "quantum physics" in profile.weak_but_interesting_topics
    # interest went UP despite the miss (engaged wrong answer + read >3s)
    assert profile.topic_affinity["quantum physics"] > 0


async def test_fast_correct_clears_weak_topic(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    q = await _question_with_meta(db_session, topics=["quantum physics"])
    await update_profile_from_event(
        db_session,
        user.id,
        _event(
            user.id,
            q.id,
            is_correct=False,
            explanation_opened=True,
            explanation_read_ms=4000,
            response_ms=6000,
        ),
    )
    profile = await update_profile_from_event(
        db_session, user.id, _event(user.id, q.id, is_correct=True, response_ms=1000)
    )
    assert "quantum physics" not in profile.weak_but_interesting_topics


async def test_repeated_quits_reduce_affinity_and_mark_disliked(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    q = await _question_with_meta(db_session, topics=["opera"], subcategory=None)
    for _ in range(3):
        await update_profile_from_event(
            db_session,
            user.id,
            _event(user.id, q.id, is_correct=False, quit_after=True, response_ms=5000),
        )
    profile = await get_or_create_profile(db_session, user.id)
    assert profile.topic_affinity["opera"] < 0
    assert "opera" in profile.disliked_topics
    assert profile.difficulty_preference < 0.5


async def test_timeout_is_mild_negative(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    q = await _question_with_meta(db_session, topics=["dates"])
    profile = await update_profile_from_event(
        db_session, user.id, _event(user.id, q.id, is_correct=False, timed_out=True)
    )
    assert profile.topic_affinity["dates"] == -0.03
    assert "dates" not in profile.disliked_topics  # one timeout is not a dislike


async def test_affinity_clamped(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    q = await _question_with_meta(db_session, topics=["space"])
    for _ in range(30):
        await update_profile_from_event(
            db_session,
            user.id,
            _event(user.id, q.id, is_correct=True, response_ms=1000, shared_after=True),
        )
    profile = await get_or_create_profile(db_session, user.id)
    assert profile.topic_affinity["space"] <= 1.0
    assert profile.confidence_score <= 1.0


async def test_brainrot_engagement_moves_tolerance_both_ways(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    meme_q = await _question_with_meta(
        db_session,
        category="Pop Culture & Entertainment",
        topics=["memes"],
        brainrot=0.9,
        humor=0.8,
    )
    profile = await update_profile_from_event(
        db_session, user.id, _event(user.id, meme_q.id, is_correct=True, response_ms=1200)
    )
    assert profile.brainrot_tolerance > 0.5
    assert profile.humor_preference > 0.5

    raised = profile.brainrot_tolerance
    profile = await update_profile_from_event(
        db_session,
        user.id,
        _event(user.id, meme_q.id, is_correct=False, quit_after=True, response_ms=5000),
    )
    assert profile.brainrot_tolerance < raised


async def test_event_without_question_still_counts(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    profile = await update_profile_from_event(
        db_session, user.id, _event(user.id, None, is_correct=True, response_ms=2000)
    )
    assert profile.interaction_count == 1
    assert profile.category_affinity == {}


async def test_question_without_ai_metadata_uses_bank_category(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    q = Question(
        module_type="trivia",
        category="History",
        icon="🏺",
        payload={"prompt": "When?", "options": ["a", "b", "c", "d"], "correctIndex": 0},
        difficulty="easy",
        status="approved",
    )
    db_session.add(q)
    await db_session.flush()
    profile = await update_profile_from_event(
        db_session, user.id, _event(user.id, q.id, is_correct=True, response_ms=5000)
    )
    assert profile.category_affinity["History"] == 0.04
    assert profile.topic_affinity == {}


async def test_update_profile_can_skip_interaction_count(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    q = await _question_with_meta(db_session)
    event = _event(user.id, q.id, is_correct=True, response_ms=1500)
    db_session.add(event)
    await db_session.flush()

    await update_profile_from_event(db_session, user.id, event, count_interaction=False)

    profile = await get_or_create_profile(db_session, user.id)
    assert profile.interaction_count == 0  # not counted...
    assert profile.category_affinity.get("Sports", 0) > 0  # ...but affinity still moved


def test_interest_signal_share_bonus() -> None:
    e = QuestionInteractionEvent(
        user_id=uuid.uuid4(),
        mode="practice",
        is_correct=True,
        response_ms=5000,
        timed_out=False,
        quit_after=False,
        explanation_opened=False,
        shared_after=True,
        replayed_after=False,
    )
    assert interest_signal(e) == 0.04 + 0.05


async def test_record_answer_signal_writes_event_and_counts(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    q = await _question_with_meta(db_session)

    await record_answer_signal(
        db_session,
        user.id,
        question_id=q.id,
        mode="royale",
        is_correct=True,
        time_frac=0.85,
        limit_ms=10000,
        streak_before=0,
        streak_after=1,
        session_id=None,
    )

    profile = await get_or_create_profile(db_session, user.id)
    assert profile.interaction_count == 1
    rows = (
        (
            await db_session.execute(
                select(QuestionInteractionEvent).where(QuestionInteractionEvent.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].is_correct is True
    assert rows[0].mode == "royale"
    assert rows[0].response_ms == 1500  # round(10000 * (1 - 0.85))


async def test_record_answer_signal_noop_when_disabled(
    db_session: AsyncSession, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "personalization_enabled", False)
    user = await _user(db_session)
    q = await _question_with_meta(db_session)

    await record_answer_signal(
        db_session,
        user.id,
        question_id=q.id,
        mode="royale",
        is_correct=True,
        time_frac=0.5,
        limit_ms=10000,
        streak_before=0,
        streak_after=1,
    )

    rows = (
        (
            await db_session.execute(
                select(QuestionInteractionEvent).where(QuestionInteractionEvent.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )
    assert rows == []


def test_question_id_from_server_answer() -> None:
    qid = uuid.uuid4()
    assert question_id_from_server_answer({"correctIndex": 0, "question_id": str(qid)}) == qid
    assert question_id_from_server_answer({"correctIndex": 0}) is None
    assert question_id_from_server_answer({"question_id": "not-a-uuid"}) is None
