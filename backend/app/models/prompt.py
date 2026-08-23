"""One-time in-app prompts — what we've asked a player, and what they said.

A row means "this player has answered this prompt; never ask again." Kept SERVER-side rather than in
device storage for two reasons:

  1. A prompt answered on one device must not reappear on another, and must survive a reinstall.
     "Enable notifications?" asked twice reads as nagging, and nagging is how a permission gets
     denied permanently.
  2. The decision of WHICH prompt to show lives on the server (services/prompts.py), so the timing
     rules can change without an App Store release. That lesson came from §5f: anything only the
     shipped binary can decide is a thing we cannot fix.

`outcome` distinguishes a real answer from a dismissal, because they mean different things later —
someone who declined notifications may be worth re-asking after a milestone; someone who accepted
never should be.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, PrimaryKeyConstraint, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# Prompt ids. Stable strings — they are the primary key, so renaming one re-asks everybody.
PROMPT_GOODWILL = "goodwill_aug14"
PROMPT_NOTIFICATIONS = "enable_notifications"
PROMPT_RATE = "rate_app"
# Pick a real handle. Every account starts on an auto-generated `rot_xxxxxx`: guests get one so
# they can play without a form, and third-party sign-in gets one because Apple and Google supply a
# name we have no right to publish on a leaderboard. Neither is a CHOICE, and the handle is the one
# thing about a player everyone else sees.
PROMPT_PICK_USERNAME = "pick_username"

ACCEPTED = "accepted"
DISMISSED = "dismissed"


class UserPromptAck(Base):
    __tablename__ = "user_prompt_acks"
    __table_args__ = (PrimaryKeyConstraint("user_id", "prompt_id", name="pk_user_prompt_acks"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    prompt_id: Mapped[str] = mapped_column(String(32), nullable=False)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False, server_default=DISMISSED)
    acked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
