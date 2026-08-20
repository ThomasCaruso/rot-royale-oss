"""Append-only coin ledger (PLAN.md §6, §8). The source of truth for coin balances.

Every coin in/out is one immutable row with a reason + optional reference. profiles.coins_balance
is a cache that must always equal SUM(delta) for the user. Never mutate; only insert.

Like the gem ledger, this carries an `idempotency_key` (DB-enforced via a partial unique index on
non-null keys): a one-time grant passes a stable key, so a retried/duplicated grant inserts at most
ONE row — the once-guarantee for one-time coin awards (e.g. streak-milestone rewards).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class CoinLedger(Base):
    __tablename__ = "coin_ledger"
    # The campaign daily-coin-cap check sums a user's rows since midnight ET on EVERY ladder load
    # and level completion; without (user_id, created_at) that scan grows with account age.
    __table_args__ = (Index("ix_coin_ledger_user_created", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    delta: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # e.g. 'signup_bonus' | 'contest_payout' | 'theme_purchase' | 'streak_bonus'
    reason: Mapped[str] = mapped_column(String(64), nullable=False)
    ref_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ref_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    # String-keyed reference for non-UUID refs (e.g. ref_type='theme', ref_key='midnight')
    ref_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Once-grant key: a partial unique index (non-null only) makes a one-time grant idempotent.
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    balance_after: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
