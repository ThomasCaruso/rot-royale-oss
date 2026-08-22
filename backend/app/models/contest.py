"""Contest scheduling + play tables (docs/architecture.md).

Window lifecycle: SCHEDULED → OPEN → CLOSED → SETTLED (settlement is M4).
round_set is a denormalized audit copy of the client_specs; round_answers holds the server-side
answers (never sent to the client) and is the source of truth for scoring.
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
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# Window states.
SCHEDULED = "SCHEDULED"
OPEN = "OPEN"
CLOSED = "CLOSED"
SETTLED = "SETTLED"

# Entry states.
IN_PROGRESS = "IN_PROGRESS"
SUBMITTED = "SUBMITTED"
EXPIRED = "EXPIRED"


class ContestWindow(Base):
    __tablename__ = "contest_windows"
    __table_args__ = (UniqueConstraint("contest_date", "slot", name="uq_window_date_slot"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    contest_date: Mapped[date] = mapped_column(nullable=False)
    slot: Mapped[str] = mapped_column(
        String(16), nullable=False
    )  # 'royale' going forward; legacy: morning|midday|night
    open_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    close_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default=SCHEDULED)
    template_id: Mapped[str] = mapped_column(String(64), nullable=False)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The day's pinned Royale round plan (type sequence + cognition content refs), set once at
    # provisioning so a mid-day content deploy can't split the field. NULL = a legacy/trivia-only
    # window that builds its round set the unchanged way (services/contest.py). See §5d.
    round_plan: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    # Money seam (Phase B): 0 = free, the only kind in v1 — there are no paid contests.
    # server_default keeps
    # existing rows free; default=0 so a freshly-constructed object carries 0 without a DB reload.
    entry_fee: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )


class Entry(Base):
    __tablename__ = "entries"
    __table_args__ = (
        UniqueConstraint("window_id", "user_id", name="uq_entry_window_user"),
        # The leaderboard field query filters by window and sorts by score (top-N + count-higher);
        # the plain window_id index left the sort and rank counts to scan every entry in the window.
        Index("ix_entries_window_score", "window_id", "total_score"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Nullable because PRACTICE entries (M8) belong to no window. Every contest query filters by
    # window_id, so NULL keeps practice out of standings/settlement/entry counts/history. The
    # uq(window_id, user_id) constraint still enforces one contest entry per window per user; NULLs
    # are distinct in Postgres, so a user may run unlimited practice sessions.
    window_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("contest_windows.id", ondelete="CASCADE"), index=True, nullable=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # True for Practice Mode sessions (M8): no stakes — never coins, rating, or standings.
    is_practice: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    seed: Mapped[int] = mapped_column(BigInteger, nullable=False)  # round set is a pure fn of this
    round_set: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)  # audit copy
    # Stamped on Royale entries that contain cognition rounds, so historical leaderboards stay
    # distinguishable across scoring economies. NULL = a legacy trivia-only entry.
    scoring_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Practice play mode ("practice"|"quick"|"category"|"starter"); NULL for ranked/duel/legacy.
    # Lets the Brain Boost surface find "today's check" without guessing from round counts.
    mode: Mapped[str | None] = mapped_column(String(16), index=True, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=IN_PROGRESS)
    # Client-generated id for an offline-synced entry (UUID string). A partial-unique index makes
    # replaying the same offline result idempotent: the sync looks the entry up by this key and
    # returns the already-settled result instead of creating a second entry. NULL for online play.
    offline_client_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


class RoundAnswer(Base):
    __tablename__ = "round_answers"

    entry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("entries.id", ondelete="CASCADE"), primary_key=True
    )
    idx: Mapped[int] = mapped_column(Integer, primary_key=True)
    module_type: Mapped[str] = mapped_column(String(32), nullable=False)
    server_answer: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # Pending second-chance state (§5f) for a Daily Royale trivia round whose FIRST pick was wrong:
    # {"choice": <eliminated idx>, "at": <ISO instant of the first pick>}. Set when the retry is
    # offered, read + cleared when the second pick resolves the round. NULL otherwise — a normal
    # one-shot round never touches it.
    retry: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)


class RoundResult(Base):
    __tablename__ = "round_results"
    # One result row per (entry, round). The DB backstop for the /answer sequence guard, which is a
    # read-then-insert TOCTOU: concurrent same-idx posts all read an empty prior set, pass the
    # check, and would each insert without this. Duplicates skip rounds, corrupt the field/tiebreak,
    # or wedge an entry so it never finalizes. `round_answers` has an analogous composite PK.
    __table_args__ = (UniqueConstraint("entry_id", "idx", name="uq_round_result_entry_idx"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    entry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("entries.id", ondelete="CASCADE"), index=True, nullable=False
    )
    idx: Mapped[int] = mapped_column(Integer, nullable=False)
    module_type: Mapped[str] = mapped_column(String(32), nullable=False)
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    time_frac: Mapped[float] = mapped_column(Numeric(5, 4), nullable=False)
    valid: Mapped[bool] = mapped_column(Boolean, nullable=False)
    flags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    # Server wall-clock when this round was answered — the reference the NEXT round's answer-time
    # verification measures its gap against (services/answer_timing.py). Nullable only for rows
    # written before this column existed; every new play sets it. Set explicitly (not a server
    # default) so the value is the request's `now` and tests can inject it.
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
