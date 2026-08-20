"""Daily-mission chest claims (engagement layer).

One row per (user, ET claim_date) is the idempotency gate for the daily-mission chest: the composite
PK means a user can claim at most once per ET day. Because the coin ledger has no idempotency_key,
the claim row's existence — NOT the ledger — is the source of truth for "already claimed today"; the
coin/gem grants are written only AFTER the claim row inserts (see services/missions.py).

The granted amounts + the weekday `reward_code` are stored for audit (what the rotation paid that
day), mirroring how standings record what settlement paid.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class DailyChestClaim(Base):
    __tablename__ = "daily_chest_claims"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    claim_date: Mapped[date] = mapped_column(Date, primary_key=True)
    coins_awarded: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    gems_awarded: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    reward_code: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
