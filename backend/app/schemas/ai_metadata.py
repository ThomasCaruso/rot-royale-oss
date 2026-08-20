"""Strict schema for LLM question-classification output (app/services/ai_classifier.py).

The LLM returns JSON only; this model is the single validation gate before anything is stored:
- every score is clamped into [0, 1] (a slightly-out-of-range model output is salvaged, not fatal)
- structurally wrong output (missing category, non-list tags, unknown enum value) is REJECTED
- tags are normalized (trimmed, whitespace-collapsed, lowercased), deduped, and capped
- `needs_review` is forced True whenever confidence/quality/risk thresholds trip, regardless of
  what the model claimed — bad metadata must flag itself out of the ranking pool.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

# needs_review auto-trip thresholds (spec-locked).
MIN_CONFIDENCE = 0.75
MAX_AMBIGUITY = 0.35
MAX_CONTROVERSY = 0.5
MIN_QUALITY = 0.65

MAX_TOPIC_TAGS = 8

_SCORE_FIELDS = (
    "difficulty_score",
    "humor_score",
    "brainrot_score",
    "educational_score",
    "controversy_risk",
    "ambiguity_risk",
    "quality_score",
    "llm_confidence",
)


def normalize_tags(values: list[str], cap: int = MAX_TOPIC_TAGS) -> list[str]:
    """Trim, collapse inner whitespace, lowercase, dedupe (order-preserving), cap."""
    out: list[str] = []
    for raw in values:
        tag = " ".join(str(raw).split()).strip().lower()
        if tag and tag not in out:
            out.append(tag)
    return out[:cap]


class AIMetadataPayload(BaseModel):
    """One validated LLM classification. Field names mirror `question_ai_metadata` columns."""

    category: str = Field(min_length=1)
    subcategory: str | None = None
    topic_tags: list[str]
    audience_tags: list[str] = Field(default_factory=list)
    related_topics: list[str] = Field(default_factory=list)

    difficulty_score: float
    knowledge_type: Literal[
        "common_knowledge",
        "specific_fact",
        "niche_fact",
        "logic",
        "visual",
        "current_event",
        "wordplay",
        "other",
    ]
    freshness_type: Literal["evergreen", "recent", "time_sensitive", "outdated_risk"]
    humor_score: float
    brainrot_score: float
    educational_score: float
    controversy_risk: float
    ambiguity_risk: float
    quality_score: float
    llm_confidence: float
    needs_review: bool = False

    @field_validator(*_SCORE_FIELDS, mode="before")
    @classmethod
    def _clamp_scores(cls, v: object) -> float:
        return max(0.0, min(1.0, float(v)))  # type: ignore[arg-type]

    @field_validator("category", "subcategory", mode="before")
    @classmethod
    def _strip_names(cls, v: object) -> object:
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator("topic_tags", "audience_tags", "related_topics")
    @classmethod
    def _normalize_tag_lists(cls, v: list[str]) -> list[str]:
        return normalize_tags(v)

    @model_validator(mode="after")
    def _auto_needs_review(self) -> AIMetadataPayload:
        if (
            self.llm_confidence < MIN_CONFIDENCE
            or self.ambiguity_risk > MAX_AMBIGUITY
            or self.controversy_risk > MAX_CONTROVERSY
            or self.quality_score < MIN_QUALITY
        ):
            self.needs_review = True
        return self
