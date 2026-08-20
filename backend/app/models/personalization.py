"""Personalization models: AI question metadata, user taste profiles, interaction events.

Three concerns, one seam:
- `question_ai_metadata` — LLM-produced classification of a bank question (one row per question,
  written ONLY by the batch classifier, never during gameplay).
- `user_taste_profiles` — the silently learned per-user preference state (bounded affinity maps,
  JSONB). Personalization-only: nothing here ever touches scores/coins/rating/standings.
- `question_interaction_events` — append-only gameplay signals (answer, speed, timeout, quit,
  explanation engagement). Client-reported and therefore untrusted; they only shape that same
  user's future question mix.

JSONB convention (repo-wide): REASSIGN dict/list attributes, never mutate in place — in-place
mutation is invisible to SQLAlchemy change tracking.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class QuestionAIMetadata(Base):
    """LLM classification of one bank question (see app/services/ai_classifier.py)."""

    __tablename__ = "question_ai_metadata"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    question_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )

    category: Mapped[str] = mapped_column(String(64), nullable=False)
    subcategory: Mapped[str | None] = mapped_column(String(64), nullable=True)
    topic_tags: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    audience_tags: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    related_topics: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )

    difficulty_score: Mapped[float] = mapped_column(Float, nullable=False)
    knowledge_type: Mapped[str] = mapped_column(String(32), nullable=False)
    freshness_type: Mapped[str] = mapped_column(String(32), nullable=False)
    humor_score: Mapped[float] = mapped_column(Float, nullable=False)
    brainrot_score: Mapped[float] = mapped_column(Float, nullable=False)
    educational_score: Mapped[float] = mapped_column(Float, nullable=False)
    controversy_risk: Mapped[float] = mapped_column(Float, nullable=False)
    ambiguity_risk: Mapped[float] = mapped_column(Float, nullable=False)
    quality_score: Mapped[float] = mapped_column(Float, nullable=False)
    llm_confidence: Mapped[float] = mapped_column(Float, nullable=False)
    needs_review: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    model_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    provider_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    raw_llm_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    classification_version: Mapped[str] = mapped_column(String(32), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class UserTasteProfile(Base):
    """Silently learned preference state for one user (PK = user_id, like `profiles`)."""

    __tablename__ = "user_taste_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )

    # name -> affinity in [-1, 1]; bounded increments only (services/taste_profile.py).
    category_affinity: Mapped[dict[str, float]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    subcategory_affinity: Mapped[dict[str, float]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    topic_affinity: Mapped[dict[str, float]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )

    difficulty_preference: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("0.5")
    )
    humor_preference: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("0.5")
    )
    brainrot_tolerance: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("0.5")
    )
    novelty_preference: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("0.5")
    )
    educational_preference: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("0.5")
    )

    disliked_topics: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    weak_but_interesting_topics: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    last_seen_topic_tags: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    last_seen_categories: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )

    interaction_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class QuestionInteractionEvent(Base):
    """Append-only gameplay signal for personalization (client-reported, low-stakes)."""

    __tablename__ = "question_interaction_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Nullable: old entries / generated (non-bank) rounds have no bank question to link.
    question_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("questions.id", ondelete="SET NULL"), index=True, nullable=True
    )
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    session_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)

    selected_answer: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    response_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    timed_out: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    quit_after: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    explanation_opened: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    explanation_read_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    shared_after: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    replayed_after: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    streak_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    streak_after: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class UserDailyStats(Base):
    """One row per (user, ET calendar day): the raw daily rollup that the growth trajectory is
    computed from. Upserted incrementally as answers land (services/growth.py). Personalization/
    product-analytics only — never touches scores/coins/rating."""

    __tablename__ = "user_daily_stats"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    stat_date: Mapped[date] = mapped_column(Date, primary_key=True)

    answers: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    correct: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    sum_time_frac: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))
    best_streak: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    hard_correct: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    per_category: Mapped[dict[str, dict[str, int]]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
