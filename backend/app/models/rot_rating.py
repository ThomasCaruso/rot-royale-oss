"""Rot Rating tables (docs/architecture.md §9) — the Glicko-2 "sharpness" rating.

PARALLEL to the placement Elo on `profiles.rating` (never merged). Per user: three
per-verb sub-ratings (notice/estimate/know) plus a DERIVED headline snapshot; and a
shared difficulty-rating pool keyed by a resolvable string. Trivia ("know")
difficulties are the fixed anchor (`fixed=True`, never converge); estimate/notice
difficulties float and are re-centred each daily batch. Speed never enters here.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class RotSubRating(Base):
    """One Glicko-2 sub-rating per (user, verb). `rounds` is that verb's rated round count."""

    __tablename__ = "rot_sub_ratings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    verb: Mapped[str] = mapped_column(String(16), primary_key=True)  # notice|estimate|know
    rating: Mapped[float] = mapped_column(Float, nullable=False)
    rd: Mapped[float] = mapped_column(Float, nullable=False)
    vol: Mapped[float] = mapped_column(Float, nullable=False)
    rounds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class RotRating(Base):
    """The DERIVED headline snapshot per user (precision-weighted mean of the sub-ratings).

    `direction` is the sign of the last headline change — it can't be recomputed from current
    state, so it is stored. `version` pins the scoring semantics (exposures must not mix versions).
    """

    __tablename__ = "rot_ratings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    rating: Mapped[float] = mapped_column(Float, nullable=False)
    rd: Mapped[float] = mapped_column(Float, nullable=False)
    provisional: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    rounds_played: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    direction: Mapped[str] = mapped_column(
        String(8), nullable=False, default="flat"
    )  # up|down|flat
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class RotDifficultyBatch(Base):
    """Exactly-once marker for the daily difficulty-convergence batch. One row per converged ET
    date; its PK is the guard — `converge_difficulties` claims the day via INSERT ... ON CONFLICT
    DO NOTHING, so a redundant daemon/cron fire (the batch is NOT idempotent) is a safe no-op."""

    __tablename__ = "rot_difficulty_batches"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    converged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RotDifficultyRating(Base):
    """A difficulty rating per resolvable key (e.g. "estimate:hard"). `fixed=True` (trivia) means
    the anchor — its rating never converges. `games` is the lifetime attempt count against it."""

    __tablename__ = "rot_difficulty_ratings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    verb: Mapped[str] = mapped_column(String(16), nullable=False)
    rating: Mapped[float] = mapped_column(Float, nullable=False)
    rd: Mapped[float] = mapped_column(Float, nullable=False)
    vol: Mapped[float] = mapped_column(Float, nullable=False)
    games: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    fixed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
