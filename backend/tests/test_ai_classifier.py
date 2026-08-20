"""AI classifier service — gating, idempotency, graceful failure. Fake chat client, no network."""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
from app.core.config import settings
from app.models import Question, QuestionAIMetadata
from app.services.ai_classifier import (
    CLASSIFICATION_VERSION,
    AIClassifierUnavailable,
    ai_metadata_coverage,
    classify_batch,
    classify_question,
    coverage_report,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

GOOD_JSON = json.dumps(
    {
        "category": "Sports",
        "subcategory": "NBA",
        "topic_tags": ["LeBron James", "NBA history"],
        "audience_tags": ["sports_fans"],
        "related_topics": ["Los Angeles Lakers"],
        "difficulty_score": 0.58,
        "knowledge_type": "specific_fact",
        "freshness_type": "evergreen",
        "humor_score": 0.1,
        "brainrot_score": 0.2,
        "educational_score": 0.4,
        "controversy_risk": 0.05,
        "ambiguity_risk": 0.05,
        "quality_score": 0.88,
        "llm_confidence": 0.93,
        "needs_review": False,
    }
)


class FakeChat:
    def __init__(self, content: str = GOOD_JSON) -> None:
        self.content = content
        self.calls = 0

    async def complete(self, system: str, user: str) -> str:
        self.calls += 1
        return self.content


def _question(**over: Any) -> Question:
    base: dict[str, Any] = {
        "module_type": "trivia",
        "category": "Sports",
        "icon": "🏀",
        "payload": {
            "prompt": "Who holds the NBA all-time scoring record?",
            "options": ["LeBron James", "Kareem Abdul-Jabbar", "Karl Malone", "Michael Jordan"],
            "correctIndex": 0,
        },
        "difficulty": "medium",
        "status": "approved",
        "explanation": "LeBron passed Kareem in February 2023.",
    }
    base.update(over)
    return Question(**base)


async def test_classifier_unavailable_when_disabled(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "rot_ai_enabled", False)
    q = _question()
    db_session.add(q)
    await db_session.flush()
    with pytest.raises(AIClassifierUnavailable):
        await classify_question(db_session, q)


async def test_classifier_unavailable_when_key_missing(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "rot_ai_enabled", True)
    monkeypatch.setattr(settings, "rot_ai_api_key", "")
    monkeypatch.setattr(settings, "rot_ai_base_url", "https://example.test/v1")
    monkeypatch.setattr(settings, "rot_ai_model", "test-model")
    q = _question()
    db_session.add(q)
    await db_session.flush()
    with pytest.raises(AIClassifierUnavailable) as exc:
        await classify_batch(db_session)
    assert "ROT_AI_API_KEY" in str(exc.value)


async def test_classify_stores_validated_metadata(db_session: AsyncSession) -> None:
    q = _question()
    db_session.add(q)
    await db_session.flush()

    outcome = await classify_question(db_session, q, chat=FakeChat())
    assert outcome == "classified"

    row = await db_session.scalar(
        select(QuestionAIMetadata).where(QuestionAIMetadata.question_id == q.id)
    )
    assert row is not None
    assert row.category == "Sports"
    assert row.topic_tags == ["lebron james", "nba history"]
    assert row.classification_version == CLASSIFICATION_VERSION
    assert row.provider_name == settings.rot_ai_provider
    assert row.raw_llm_json is not None


async def test_classify_skips_existing_unless_force(db_session: AsyncSession) -> None:
    q = _question()
    db_session.add(q)
    await db_session.flush()

    chat = FakeChat()
    assert await classify_question(db_session, q, chat=chat) == "classified"
    assert await classify_question(db_session, q, chat=chat) == "skipped"
    assert chat.calls == 1
    assert await classify_question(db_session, q, force=True, chat=chat) == "updated"
    assert chat.calls == 2

    count = await db_session.scalar(select(func.count(QuestionAIMetadata.id)))
    assert count == 1


async def test_malformed_llm_json_fails_gracefully(db_session: AsyncSession) -> None:
    q = _question()
    db_session.add(q)
    await db_session.flush()

    report = await classify_batch(db_session, chat=FakeChat("not json at all"))
    assert report.classified == 0
    assert len(report.failed) == 1
    assert report.failed[0][0] == str(q.id)
    count = await db_session.scalar(select(func.count(QuestionAIMetadata.id)))
    assert count == 0


async def test_batch_limit_dry_run_and_single_id(db_session: AsyncSession) -> None:
    qs = [
        _question(payload={"prompt": f"Q{i}?", "options": ["a", "b", "c", "d"], "correctIndex": 0})
        for i in range(3)
    ]
    db_session.add_all(qs)
    await db_session.flush()

    # dry run: reports candidates, calls nothing, writes nothing
    chat = FakeChat()
    report = await classify_batch(db_session, dry_run=True, chat=chat)
    assert report.dry_run and report.candidates == 3 and chat.calls == 0

    report = await classify_batch(db_session, limit=2, chat=chat)
    assert report.classified == 2

    # remaining unclassified is 1; already-classified are not re-sent without force
    report = await classify_batch(db_session, chat=chat)
    assert report.classified == 1 and report.skipped == 0

    # single question by id, force re-run
    report = await classify_batch(db_session, question_id=qs[0].id, force=True, chat=chat)
    assert report.updated == 1

    # unknown id → zero candidates
    report = await classify_batch(db_session, question_id=uuid.uuid4(), chat=chat)
    assert report.candidates == 0


async def test_classify_batch_checkpoints(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """on_checkpoint fires at each batch boundary and once after the loop, without committing."""
    monkeypatch.setattr(settings, "rot_ai_batch_size", 1)

    qs = [
        _question(payload={"prompt": f"Q{i}?", "options": ["a", "b", "c", "d"], "correctIndex": 0})
        for i in range(2)
    ]
    db_session.add_all(qs)
    await db_session.flush()

    checkpoint_count = 0

    async def _on_checkpoint() -> None:
        nonlocal checkpoint_count
        checkpoint_count += 1

    chat = FakeChat()
    report = await classify_batch(db_session, chat=chat, on_checkpoint=_on_checkpoint)

    # Both classified, checkpoint fired at least twice (one per batch of 1, plus post-loop)
    assert report.classified == 2
    assert checkpoint_count >= 2

    # Metadata rows were added (flushed) even without a real commit
    count = await db_session.scalar(select(func.count(QuestionAIMetadata.id)))
    assert count == 2


async def test_classify_batch_category_filter(db_session: AsyncSession) -> None:
    """category= restricts candidates to that category only."""
    sports_q = _question(category="Sports")
    history_q = _question(
        category="History",
        payload={"prompt": "Historical Q?", "options": ["a", "b", "c", "d"], "correctIndex": 0},
    )
    db_session.add_all([sports_q, history_q])
    await db_session.flush()

    chat = FakeChat()
    report = await classify_batch(db_session, category="Sports", chat=chat)

    assert report.candidates == 1
    assert report.classified == 1

    sports_meta = await db_session.scalar(
        select(QuestionAIMetadata).where(QuestionAIMetadata.question_id == sports_q.id)
    )
    history_meta = await db_session.scalar(
        select(QuestionAIMetadata).where(QuestionAIMetadata.question_id == history_q.id)
    )
    assert sports_meta is not None
    assert history_meta is None


async def test_classify_batch_max_errors_aborts(db_session: AsyncSession) -> None:
    """max_errors aborts the loop as soon as the failure count reaches the limit."""
    qs = [
        _question(payload={"prompt": f"Q{i}?", "options": ["a", "b", "c", "d"], "correctIndex": 0})
        for i in range(5)
    ]
    db_session.add_all(qs)
    await db_session.flush()

    # FakeChat that always returns invalid JSON → every classify_question raises ClassificationError
    bad_chat = FakeChat("not valid json at all")
    report = await classify_batch(db_session, chat=bad_chat, max_errors=1)

    # Should stop after the first failure, not process all 5
    assert len(report.failed) == 1
    assert report.classified == 0


async def test_coverage_report(db_session: AsyncSession) -> None:
    """coverage_report and ai_metadata_coverage return correct counts and fraction."""
    qs = [
        _question(payload={"prompt": f"Q{i}?", "options": ["a", "b", "c", "d"], "correctIndex": 0})
        for i in range(4)
    ]
    db_session.add_all(qs)
    await db_session.flush()

    # Classify exactly 2 via fake chat
    chat = FakeChat()
    await classify_batch(db_session, limit=2, chat=chat)

    rep = await coverage_report(db_session)
    assert rep.total == 4
    assert rep.classified == 2
    assert rep.unclassified == 2
    assert abs(rep.coverage - 0.5) < 1e-9

    # by_category: all 4 are "Sports" (the _question default)
    assert "Sports" in rep.by_category
    cls_count, tot_count = rep.by_category["Sports"]
    assert tot_count == 4
    assert cls_count == 2

    frac = await ai_metadata_coverage(db_session)
    assert abs(frac - 0.5) < 1e-9
