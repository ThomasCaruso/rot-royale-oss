"""Pydantic schemas for the personalization API (events in, taste profile out)."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field


class QuestionInteractionEventIn(BaseModel):
    """One gameplay interaction, sent fire-and-forget by the client after a round.

    `question_id` is optional: for entry-based play the server resolves it from
    (entry_id, idx) via the stored round_answers — the client never needs to know bank ids.
    All of this is personalization-only signal (untrusted, low-stakes): it shapes THIS user's
    future question mix and nothing else.
    """

    mode: str = Field(min_length=1, max_length=16)
    question_id: uuid.UUID | None = None
    entry_id: uuid.UUID | None = None
    idx: int | None = Field(default=None, ge=0)
    session_id: uuid.UUID | None = None

    selected_answer: int | None = Field(default=None, ge=0, le=16)
    is_correct: bool | None = None
    response_ms: int | None = Field(default=None, ge=0, le=600_000)
    timed_out: bool = False
    quit_after: bool = False
    explanation_opened: bool = False
    explanation_read_ms: int | None = Field(default=None, ge=0, le=3_600_000)
    shared_after: bool = False
    replayed_after: bool = False
    streak_before: int | None = Field(default=None, ge=0)
    streak_after: int | None = Field(default=None, ge=0)


class EventAck(BaseModel):
    recorded: bool


class AIStatusOut(BaseModel):
    """Coverage readiness check (GET /personalization/status — public, no auth)."""

    coverage: float
    ready: bool


class TasteProfileOut(BaseModel):
    """Debug/dev view of the learned profile (GET /personalization/me/profile)."""

    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    category_affinity: dict[str, float]
    subcategory_affinity: dict[str, float]
    topic_affinity: dict[str, float]
    difficulty_preference: float
    humor_preference: float
    brainrot_tolerance: float
    novelty_preference: float
    educational_preference: float
    disliked_topics: list[str]
    weak_but_interesting_topics: list[str]
    last_seen_topic_tags: list[str]
    last_seen_categories: list[str]
    interaction_count: int
    confidence_score: float
