"""Per-user skill state for the adaptive-learning engine (Phase 1).

One row per user, JSONB maps (mirrors UserTasteProfile). Reassigned-never-mutated per the JSONB
convention so SQLAlchemy always sees a fresh object.

  * category_ability: {category_name: {"theta": float, "attempts": int}}
  * topic_knowledge:  {topic_tag:     {"p_known": float, "attempts": int, "last_answered_at": iso}}
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class UserSkillState(Base):
    __tablename__ = "user_skill_state"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    category_ability: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    topic_knowledge: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
