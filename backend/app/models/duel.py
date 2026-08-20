"""Async Duel state (Task 3.x — best-of-7 trivia vs a bot rival, Gem entry pools).

These three tables hold the server-side state for an async Duel. The HUMAN's play reuses the
existing contest machinery: a Duel is backed by an `Entry` (linked via `entry_id`), and the human's
per-round answers/results flow through the same `RoundAnswer`/`RoundResult` tables and scoring path
as practice/contest entries. The DUEL layer adds the head-to-head bookkeeping on top.

The bot rival's per-round run (its correctness + answer speed for each of the 7 questions) is
precomputed and stored server-side in `DuelMatch.rival_run` — it is NEVER sent to the client (the
client must not be able to see how the rival will play before the human answers). `DuelRound`
records the resolved head-to-head outcome of each round once the human has answered;
`DuelUserStats` is a per-user rollup of duel performance for tiering/streaks.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class DuelMatch(Base):
    __tablename__ = "duel_matches"
    __table_args__ = (UniqueConstraint("entry_id", name="uq_duel_match_entry"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # The human's play Entry (one Duel per Entry). The human's answers/results live in
    # RoundAnswer/RoundResult keyed off this entry.
    entry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("entries.id", ondelete="CASCADE"), nullable=False
    )
    duel_type: Mapped[str] = mapped_column(String(16), nullable=False)  # training|spark|crown|royal
    # v1: always 'bot'. The other kinds are the forward seam (human snapshot / live human).
    rival_type: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'bot'")
    )  # bot|human_snapshot|live_human
    rival_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)  # no FK in v1
    rival_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    bot_rival_tier: Mapped[str | None] = mapped_column(
        String(16), nullable=True
    )  # rookie|solid|sharp|elite
    entry_gems: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    pool_gems: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    seed: Mapped[int] = mapped_column(BigInteger, nullable=False)  # drives questions + rival run
    # Server-only precomputed rival play: [{correct: bool, time_ms: int}, ...]. Never sent to the
    # client.
    rival_run: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'created'")
    )  # created|in_progress|completed|abandoned|refunded
    user_round_wins: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    rival_round_wins: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    winner: Mapped[str | None] = mapped_column(String(16), nullable=True)  # user|rival|none
    result_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    gem_delta: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )  # net gems for the user
    xp_awarded: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    # ET date — drives the per-day bot Gem-duel cap.
    contest_date: Mapped[date] = mapped_column(nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # No onupdate; services set updated_at explicitly.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class DuelRound(Base):
    __tablename__ = "duel_rounds"
    __table_args__ = (
        UniqueConstraint("match_id", "round_index", name="uq_duel_round_match_index"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("duel_matches.id", ondelete="CASCADE"), index=True, nullable=False
    )
    round_index: Mapped[int] = mapped_column(Integer, nullable=False)
    phase: Mapped[str] = mapped_column(String(12), nullable=False)  # normal|sudden_death
    # Chosen option index; None = timeout / no answer.
    user_answer: Mapped[int | None] = mapped_column(Integer, nullable=True)
    user_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    user_time_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    rival_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    rival_time_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    outcome: Mapped[str] = mapped_column(String(12), nullable=False)  # user_win|rival_win|no_point
    # one of: correct_vs_wrong|speed_gap|both_wrong|near_tie_correct|
    # tiebreak_total_correct|tiebreak_avg_speed
    outcome_reason: Mapped[str] = mapped_column(String(24), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class DuelUserStats(Base):
    __tablename__ = "duel_user_stats"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    wins: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    losses: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    training_wins: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    training_losses: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    current_streak: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    best_streak: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    perfect_wins: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    comeback_wins: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    total_gems_won: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    total_gems_lost: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    duel_xp: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    duel_tier: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'bronze'")
    )  # bronze|silver|gold|crown
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
