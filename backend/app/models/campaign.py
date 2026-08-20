"""Campaign Mode tables: durable level progress + the entry→level link.

Campaign is the progression/learning layer (the primary coin source). A campaign play reuses the
window-less practice Entry machinery (is_practice=True, window_id NULL), so it stays out of
windows/standings/settlement entirely. These two tables add only what campaign needs on top:

  - campaign_sessions       links a play Entry to the (world, level) it is an attempt at, so
                            completion knows which level to score/reward (a plain practice Entry has
                            no row here and is never campaign-rewarded).
  - user_campaign_progress  durable per-(user, world, level): best score, clear status, whether the
                            one-time first-clear bonus was paid, completion timestamp.

Coins/XP are NOT stored here — coins live in the append-only coin_ledger (the source of truth);
progress only records whether the first-clear bonus was already claimed.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    PrimaryKeyConstraint,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# Clear-status values (best achieved), ranked none < clear < strong < perfect.
CLEAR = "clear"
STRONG = "strong"
PERFECT = "perfect"
CLEAR_STATUS_RANK: dict[str, int] = {CLEAR: 1, STRONG: 2, PERFECT: 3}


class CampaignSession(Base):
    __tablename__ = "campaign_sessions"

    entry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("entries.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    world: Mapped[str] = mapped_column(String(32), nullable=False)
    level_number: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Set once when the finished level is settled (rewards + progress applied). The per-entry
    # idempotency guard: a non-null value means "already settled" — independent of whether any coins
    # were paid (a failed run or a cap-exhausted pass settles with zero coins and still marks here).
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UserCampaignProgress(Base):
    __tablename__ = "user_campaign_progress"
    __table_args__ = (
        PrimaryKeyConstraint("user_id", "world", "level_number", name="pk_user_campaign_progress"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    world: Mapped[str] = mapped_column(String(32), nullable=False)
    level_number: Mapped[int] = mapped_column(Integer, nullable=False)
    best_correct: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    # Best clear status achieved: 'clear'|'strong'|'perfect', or NULL if never passed.
    clear_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # The one-time first-clear bonus is paid once; later passes are replays (small flat reward).
    first_clear_claimed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    times_cleared: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
