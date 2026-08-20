"""Cognitive round types — the `cognition` Postgres schema.

The cognitive round modules (estimate, change_detection) run on these tables. They deliberately do
NOT touch the trivia/contest tables: a cognition round is played through its own instance/attempt
rows, while the modules themselves register in the same round-module registry as trivia
(CLAUDE.md §5) so the plugin seam stays single.

The `span` and `crowd` types were removed pre-launch (see app/modules/__init__.py for why); their
`span_result` and `crowd_response` tables were dropped in the same change.

Server-authoritative throughout (Invariant 1): every answer/sequence/target is derived server-side
from `round_instance.seed` or held in server-only tables (estimate_item.answer never reaches the
client until the round resolves); the client submits inputs and receives judged results.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

SCHEMA = "cognition"


class CognitionRoundType(Base):
    """Registry row per cognitive round type. `config` carries per-type tunables so they are data,
    not constants."""

    __tablename__ = "round_type"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(64), nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class CognitionRoundInstance(Base):
    """One played (or in-play) cognitive round. The seed is fixed at creation and the round content
    is a pure function of it — same reproducibility contract as entries.seed (CLAUDE.md §9)."""

    __tablename__ = "round_instance"
    __table_args__ = (
        UniqueConstraint("entry_id", "round_idx", name="uq_round_instance_entry_round"),
        {"schema": SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    round_type_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.round_type.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    seed: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # When this instance BACKS an interactive Daily Royale round, it is bound to (entry_id,
    # round_idx). The unique (entry_id, round_idx) means a round maps to exactly one instance — no
    # replaying a round for a better result, and an instance started in standalone play (entry_id
    # NULL) can't be submitted into a Royale. NULL for standalone/gauntlet-era instances.
    entry_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("entries.id", ondelete="CASCADE"), nullable=True
    )
    round_idx: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Versioned so v1 and v2 scores are never silently mixed on a shared leaderboard: rows that
    # predate the column stay 1 (the DB default); the service stamps every new cognition round 2
    # (services/cognition.py::COGNITION_SCORING_VERSION). Bump the constant when scoring changes.
    scoring_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    final_score: Mapped[int | None] = mapped_column(Integer, nullable=True)


class CognitionAttempt(Base):
    """One player input within a round (an estimate guess, a change-detection tap, …).

    `is_correct` is nullable so an attempt row can be opened before it is judged — attempt 0 is the
    DRAW MARKER, pinning the item the round was dealt at start time. The unique
    (round_instance_id, attempt_index) is the DB backstop against a double-submit racing the
    sequence guard — same TOCTOU shape as uq_round_result_entry_idx (models/contest.py).
    """

    __tablename__ = "attempt"
    __table_args__ = (
        UniqueConstraint("round_instance_id", "attempt_index", name="uq_attempt_instance_index"),
        {"schema": SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    round_instance_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.round_instance.id", ondelete="CASCADE"), index=True, nullable=False
    )
    attempt_index: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    points_awarded: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class CognitionEstimateItem(Base):
    """Server-side Fermi-estimation content: the answer is DERIVED from 2–3 everyday component
    quantities, not fact recall. `answer` and `components` NEVER reach a client until the round
    resolves (Invariant 1 — the components alone would let a client compute the answer);
    `acceptable_pct` defines both correctness and the "close" proximity band. `reveal_explanation`
    carries the actual arithmetic, shown after resolution; `intuition_note` says which way people
    typically err. Difficulty ∈ direct | two_step | counterintuitive, with default acceptable_pct
    20 / 30 / 40 respectively (modules/estimate.py::DEFAULT_ACCEPTABLE_PCT)."""

    __tablename__ = "estimate_item"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[Decimal] = mapped_column(Numeric(20, 6), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    magnitude_band: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # [{label, value, unit, source_url}, …] — the everyday quantities the answer is built from.
    components: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    reveal_explanation: Mapped[str] = mapped_column(Text, nullable=False)
    intuition_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False)
    acceptable_pct: Mapped[Decimal] = mapped_column(
        Numeric(6, 3), nullable=False, server_default=text("20")
    )
    # The proximity band: a wrong guess within close_pct is "close", beyond it "far" — a near-miss
    # should feel different from a wild miss. NULL → 2× acceptable_pct (40/60/80 by difficulty).
    close_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 3), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    stability: Mapped[str | None] = mapped_column(String(16), nullable=True)
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    # The content file's stable id (e.g. "fer_0001") — the upsert key for ingest and the id used
    # by the admin verdict/export paths. The DB PK stays a generated UUID (the gauntlet FK depends
    # on it); source_id is the human/file-facing identity. Nullable so rows created outside the
    # ingest pipeline (older seeds/tests) are still valid.
    source_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    # Diagnostic ingest metadata (the file's `_flags`): dimension / repeat-path counters used to
    # correlate playtest verdicts offline. NEVER read at runtime, never in a client response, never
    # in scoring or the draw — see content/estimate_ingest.py and the no-leak test.
    flags: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # Admin-only playtest verdict (set via POST .../items/{id}/verdict, never ingested from file).
    # 'good' | 'boring' | 'unfair' | 'repetitive' | 'broken' — `repetitive` (the reasoning path has
    # recurred) is deliberately distinct from `boring` (the question is individually dull).
    playtest_verdict: Mapped[str | None] = mapped_column(Text, nullable=True)
    playtest_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    playtest_rated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class CognitionChangeItem(Base):
    """One change-detection image pair, ingested from the asset manifest
    (content/change_manifest.py). The bounding box lives ONLY here, in NORMALIZED 0–1 image
    coordinates — never in a client_spec — and tap tolerance is a fraction of image dimension
    (modules/change_detection.py), so screen size never changes difficulty. `width`/`height` are
    the source pixel dimensions, shipped to the client purely for layout."""

    __tablename__ = "change_item"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # ASSET IDS, not URLs — one path segment naming a file in <content_root>/change/assets/
    # (content/change_assets.py). They were web paths into frontend/public/ until the production
    # imagery moved behind ROT_CONTENT_DIR with the rest of the gameplay content; the column names
    # were renamed with the meaning so a stale name could not outlive the architecture.
    base_asset: Mapped[str] = mapped_column(Text, nullable=False)
    altered_asset: Mapped[str] = mapped_column(Text, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    bbox_x: Mapped[float] = mapped_column(Numeric(8, 6), nullable=False)
    bbox_y: Mapped[float] = mapped_column(Numeric(8, 6), nullable=False)
    bbox_w: Mapped[float] = mapped_column(Numeric(8, 6), nullable=False)
    bbox_h: Mapped[float] = mapped_column(Numeric(8, 6), nullable=False)
    # easy | medium | hard — authored per pair (content/change/difficulty.json). Two jobs: the
    # Royale draw opens on an easy pair and closes on a hard one, and the value rides in the round's
    # server_answer so Rot Rating can band the `notice` verb. Without it every change round scored
    # against a single `notice:medium` opponent, so the sub-rating could not tell a gimme from a
    # needle-in-a-haystack. NULL = unbanded (treated as medium).
    difficulty: Mapped[str | None] = mapped_column(String(16), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
