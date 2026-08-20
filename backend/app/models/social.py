"""Friends graph + live friend-duel state.

This is the social layer (added past the original v1 non-goal list — see PLAN.md §13, now in
scope): a player can friend another player by username, and once friends, challenge them to a
**live** best-of-7 trivia duel played in real time over a WebSocket.

Four tables:
- `friendships` — the friend graph. One row per (requester, addressee) pair; `status` walks
  pending → accepted (or declined). "Are A and B friends?" checks BOTH orderings.
- `friend_duels` — a live head-to-head match between two real humans (challenger vs opponent). The
  seed drives the shared question set; `round_set` is the answer-free client spec (safe to send),
  `server_answers` is the server-only answer copy (NEVER sent). The match walks
  pending → active → completed (or declined/cancelled/expired).
- `friend_duel_rounds` — one resolved head-to-head round (both players have answered question idx).
- `friend_duel_submissions` — a single player's answer to one round, recorded BEFORE the opponent
  has answered. When both submissions for a round exist, the round resolves into a duel_round row
  and the submissions are the audit trail. DB-backed so a reconnect never loses an answer.

Server-authoritative throughout: each client submits an opaque module result; the server scores it
via the canonical module.score(), adjudicates against the opponent's stored submission, and never
trusts client-sent correctness/scores.
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


class Friendship(Base):
    __tablename__ = "friendships"
    __table_args__ = (UniqueConstraint("requester_id", "addressee_id", name="uq_friendship_pair"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The user who sent the request and the user who received it. The pair is stored in send order;
    # friendship is symmetric once accepted, so reads check both orderings.
    requester_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    addressee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'pending'")
    )  # pending|accepted|declined
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class FriendDuel(Base):
    __tablename__ = "friend_duels"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    challenger_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    opponent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'pending'")
    )  # pending|active|completed|declined|cancelled|expired
    seed: Mapped[int] = mapped_column(BigInteger, nullable=False)  # drives the shared question set
    # Answer-free client specs [{idx, type, client_spec}] — safe to send to both clients.
    round_set: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    # Server-only answers [{idx, module_type, server_answer}] — NEVER sent to a client.
    server_answers: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    # The next round both players must answer (0-based); advances once a round resolves.
    current_round: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    challenger_round_wins: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    opponent_round_wins: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    winner_side: Mapped[str | None] = mapped_column(
        String(16), nullable=True
    )  # challenger|opponent
    result_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # ET date the challenge was created — for history grouping / debugging.
    contest_date: Mapped[date] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Pending: deadline to accept. Active: deadline to finish. Past it → expired by the cleanup job.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class FriendDuelRound(Base):
    __tablename__ = "friend_duel_rounds"
    __table_args__ = (
        UniqueConstraint("duel_id", "round_index", name="uq_friend_duel_round_index"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    duel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("friend_duels.id", ondelete="CASCADE"), index=True, nullable=False
    )
    round_index: Mapped[int] = mapped_column(Integer, nullable=False)
    phase: Mapped[str] = mapped_column(String(12), nullable=False)  # normal|sudden_death
    challenger_answer: Mapped[int | None] = mapped_column(Integer, nullable=True)
    challenger_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    challenger_time_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    opponent_answer: Mapped[int | None] = mapped_column(Integer, nullable=True)
    opponent_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    opponent_time_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    # challenger_win|opponent_win|no_point
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    outcome_reason: Mapped[str] = mapped_column(String(24), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class FriendDuelSubmission(Base):
    __tablename__ = "friend_duel_submissions"
    __table_args__ = (
        UniqueConstraint("duel_id", "round_index", "user_id", name="uq_friend_duel_submission"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    duel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("friend_duels.id", ondelete="CASCADE"), index=True, nullable=False
    )
    round_index: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    answer: Mapped[int | None] = mapped_column(Integer, nullable=True)  # chosen option index
    correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    time_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
