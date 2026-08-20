"""Append-only gem ledger. The source of truth for gem balances (the scarce second currency).

A parallel mirror of coin_ledger: every gem in/out is one immutable row with a reason + optional
reference. profiles.gems_balance is a cache that must always equal SUM(delta) for the user. Never
mutate; only insert.

Unlike the coin ledger, this carries an `idempotency_key` (DB-enforced via a partial unique index
on non-null keys): a one-time grant passes a stable key, so a retried/duplicated grant inserts at
most ONE row — the once-guarantee for one-time gem awards.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class GemLedger(Base):
    __tablename__ = "gem_ledger"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    delta: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # e.g. 'duel_win' | 'world_clear' | 'gem_purchase'
    reason: Mapped[str] = mapped_column(String(64), nullable=False)
    ref_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ref_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    # String-keyed reference for non-UUID refs (wider than coins: gem refs like 'world:Science' /
    # item ids can be longer).
    ref_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Once-grant key: a partial unique index (non-null only) makes a one-time grant idempotent.
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    balance_after: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
