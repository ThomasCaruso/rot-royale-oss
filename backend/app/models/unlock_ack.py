"""Unlock acknowledgements — the once-only reveal ledger + permanent high-water mark for
requirement-gated cosmetics (vault unlock foundation).

A row here means: "this user has satisfied this item's unlock requirement at least once, and the
earn has been surfaced to them." It serves two jobs:

  1. Exactly-once celebration: the earn-moment reveal (results screens + the Home net) diffs the
     currently-met requirement set against these rows, so an unlock is celebrated once and never
     re-fires on replay / re-open.
  2. Permanence: some sources fluctuate (division/streak can drop). Once acknowledged, an item stays
     unlocked forever regardless of later regression — this row is the high-water mark, which is why
     no peak-rating / best-streak columns are needed. For earned-free (cost 0) items an explicit
     ownership grant is written alongside the ack; unlock-then-buy items simply stay purchasable.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, PrimaryKeyConstraint, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class UserUnlockAck(Base):
    __tablename__ = "user_unlock_acks"
    __table_args__ = (PrimaryKeyConstraint("user_id", "item_id", name="pk_user_unlock_acks"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    acked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
