"""Localized question content (i18n v2 — the question bank itself, not just UI chrome).

English stays CANONICAL: `questions.payload` is never translated in place. Two properties depend on
that and both break silently if it is:

- **Campaign level resolution** keys off `question_key(category, payload["prompt"])` — a hash of the
  English stem. Translating the stem would orphan every authored campaign level.
- **`correctIndex` is positional.** `trivia_spec` shuffles `payload["options"]` and derives the
  served answer index from the ORIGINAL position, so a translation must be the same options in the
  SAME order. `options` here is an ordered array validated 1:1 against the source; the shuffle then
  runs over the translated strings and the answer still lands correctly.

Serving gate mirrors `questions.status`: only `approved` translations are served, so a machine draft
never reaches a player. A question with no approved translation for a locale simply falls back to
English — fallback is PER QUESTION, so a partially-translated bank is always safe to ship.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# Locales the bank can carry. "en" is never stored here — it lives in questions.payload.
TRANSLATION_LOCALES = ("es", "fr", "tr")

# Mirrors question_status: draft = machine output awaiting review, approved = servable.
TRANSLATION_STATUSES = ("draft", "approved", "rejected")
SERVABLE_TRANSLATION_STATUSES = ("approved",)

# How the row was produced — so a re-run can safely overwrite machine output without clobbering a
# human edit.
TRANSLATION_SOURCES = ("machine", "human")

_locale_enum = Enum(*TRANSLATION_LOCALES, name="translation_locale")
_status_enum = Enum(*TRANSLATION_STATUSES, name="translation_status")
_source_enum = Enum(*TRANSLATION_SOURCES, name="translation_source")


class QuestionTranslation(Base):
    __tablename__ = "question_translations"
    __table_args__ = (
        UniqueConstraint("question_id", "locale", name="uq_question_translation_locale"),
        # The serving lookup: every approved row for one locale, joined onto the bank.
        Index("ix_question_translations_locale_status", "locale", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    question_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    locale: Mapped[str] = mapped_column(_locale_enum, nullable=False)

    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    # Ordered array, same length + order as questions.payload["options"]. Validated on write.
    options: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(
        _status_enum, nullable=False, server_default=text("'draft'"), index=True
    )
    source: Mapped[str] = mapped_column(
        _source_enum, nullable=False, server_default=text("'machine'")
    )
    # Why a reviewer should look: "wordplay", "english_spelling", "us_centric", "untranslated"…
    # Empty = the translator saw nothing that resists translation.
    flags: Mapped[list[Any]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    # Model identifier that produced a machine row, for selective re-runs after a prompt change.
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
