"""Shareable Daily-Royale challenge links (the viral share loop).

A `Challenge` is a public, spoiler-free SNAPSHOT of one player's finished Daily Royale entry, keyed
by a short URL-safe id used in the share link `…/c/<id>`. It carries only display metadata (the
sharer's handle, score, and a provisional "where you'd rank" place/field at share time) — never
questions or answers — so an anonymous visitor can see "beat my 742" and jump straight into today's
Daily Royale as a guest. NOT the friend-duel challenge (that stays in services/friend_duel).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Challenge(Base):
    __tablename__ = "challenges"
    # One shareable link per entry — re-sharing the same result returns the same id (idempotent).
    __table_args__ = (UniqueConstraint("entry_id", name="uq_challenge_entry"),)

    # Short, URL-safe, unguessable public id (base62) — appears in the share link `…/c/<id>`.
    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    entry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("entries.id", ondelete="CASCADE"), nullable=False
    )
    creator_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    window_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("contest_windows.id", ondelete="CASCADE"), nullable=False
    )
    contest_date: Mapped[date] = mapped_column(Date, nullable=False)
    # The human-facing daily number ("#142") — derived from the contest date at creation.
    contest_no: Mapped[int] = mapped_column(Integer, nullable=False)
    # Display snapshot at share time (spoiler-free). username is the sharer's public handle.
    username: Mapped[str] = mapped_column(String(32), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    # Provisional "where you'd rank right now" at share time (padded field, like settlement); the
    # window may still be OPEN, so this is a live hook, not the settled rank. Nullable if unknown.
    place: Mapped[int | None] = mapped_column(Integer, nullable=True)
    field_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
