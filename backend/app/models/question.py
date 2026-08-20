"""Content bank for content-backed round modules (PLAN.md §6).

A trivia question row: module_type='trivia', category, icon, difficulty, status, explanation, and
payload={prompt, options, correctIndex}. Generated modules (rapid_math, memory_flash) need no rows.

Categories are central (M-categories): every served question carries a `category`, a `difficulty`
(easy/medium/hard), an `explanation` (review aid / post-answer reveal), and a `status`. ONLY
`approved`/`live` rows are ever served — `draft` rows are staged content, never reaching a player.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

# Difficulty + review-status enums. SERVABLE_STATUSES is the single serving gate (see fetch_bank).
# Defined in content/difficulties.py and re-exported here so existing imports keep working. The
# direction matters: content must be validatable WITHOUT importing the application (see that
# module's docstring), so the vocabulary cannot live behind the ORM.
from content.difficulties import QUESTION_DIFFICULTIES  # noqa: E402
from sqlalchemy import Boolean, DateTime, Enum, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

QUESTION_STATUSES = ("draft", "approved", "live")
SERVABLE_STATUSES = ("approved", "live")

_difficulty_enum = Enum(*QUESTION_DIFFICULTIES, name="question_difficulty")
_status_enum = Enum(*QUESTION_STATUSES, name="question_status")


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    module_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    category: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    icon: Mapped[str] = mapped_column(String(16), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    difficulty: Mapped[str] = mapped_column(
        _difficulty_enum, nullable=False, server_default=text("'medium'")
    )
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        _status_enum, nullable=False, server_default=text("'draft'"), index=True
    )
    # Vestigial: serving is gated on `status` only (not `active`). Kept so older rows/migrations
    # valid; nothing reads it. Do not add a second gate here.
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
