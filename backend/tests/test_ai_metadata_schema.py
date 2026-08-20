"""AIMetadataPayload — the validation gate between raw LLM JSON and the DB."""

from __future__ import annotations

from typing import Any

import pytest
from app.schemas.ai_metadata import AIMetadataPayload, normalize_tags
from pydantic import ValidationError


def good_payload(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "category": "Sports",
        "subcategory": "NBA",
        "topic_tags": ["LeBron James", "scoring records", "NBA history"],
        "audience_tags": ["sports_fans", "casual_nba_fans"],
        "related_topics": ["Los Angeles Lakers", "Kareem Abdul-Jabbar"],
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
    base.update(over)
    return base


def test_accepts_good_llm_json() -> None:
    m = AIMetadataPayload.model_validate(good_payload())
    assert m.category == "Sports"
    assert m.needs_review is False
    assert m.topic_tags == ["lebron james", "scoring records", "nba history"]


@pytest.mark.parametrize(
    "broken",
    [
        good_payload(category=""),
        good_payload(category=None),
        good_payload(topic_tags="not-a-list"),
        good_payload(knowledge_type="vibes"),
        good_payload(freshness_type="stale"),
        {"category": "Sports"},  # missing everything else
    ],
)
def test_rejects_malformed_json(broken: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        AIMetadataPayload.model_validate(broken)


def test_scores_clamped_to_unit_interval() -> None:
    m = AIMetadataPayload.model_validate(
        good_payload(difficulty_score=1.7, humor_score=-0.4, quality_score=2.0)
    )
    assert m.difficulty_score == 1.0
    assert m.humor_score == 0.0
    assert m.quality_score == 1.0


@pytest.mark.parametrize(
    "over",
    [
        {"llm_confidence": 0.6},
        {"ambiguity_risk": 0.5},
        {"controversy_risk": 0.9},
        {"quality_score": 0.5},
    ],
)
def test_needs_review_forced_true_on_thresholds(over: dict[str, Any]) -> None:
    m = AIMetadataPayload.model_validate(good_payload(needs_review=False, **over))
    assert m.needs_review is True


def test_needs_review_respects_model_true_even_when_metrics_fine() -> None:
    m = AIMetadataPayload.model_validate(good_payload(needs_review=True))
    assert m.needs_review is True


def test_tags_normalized_deduped_capped() -> None:
    tags = ["  LeBron   James ", "lebron james", "NBA", ""] + [f"tag {i}" for i in range(10)]
    m = AIMetadataPayload.model_validate(good_payload(topic_tags=tags))
    assert m.topic_tags[0] == "lebron james"
    assert m.topic_tags.count("lebron james") == 1
    assert len(m.topic_tags) == 8


def test_normalize_tags_helper() -> None:
    assert normalize_tags(["  A  B ", "a b", "C"]) == ["a b", "c"]
