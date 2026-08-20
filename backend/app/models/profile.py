"""Player profile (PLAN.md §6). coins_balance is a cache; coin_ledger is the source of truth."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Integer, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Profile(Base):
    __tablename__ = "profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    # How many times the player has changed their handle. Drives the pricing rule: the first change
    # is free, every one after costs coins (core/constants.py). Stored rather than derived from the
    # ledger because the FREE change leaves no ledger row, so the ledger alone cannot tell
    # "never changed" from "changed once, for free".
    username_changes: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    # Indexed: /me computes global rank as COUNT(*) WHERE rating > mine on every bootstrap.
    rating: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1000"), index=True
    )
    division: Mapped[str] = mapped_column(String(16), nullable=False)
    streak_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    last_streak_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Free weekly streak-grace: the ET contest-date the grace was last consumed. Available again
    # once this falls in an earlier ISO week than the current contest date (NULL = never used).
    streak_grace_used_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    sharpness: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    # cache of SUM(coin_ledger.delta); must always equal it (see services/ledger.py).
    coins_balance: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    # cache of SUM(gem_ledger.delta); must always equal it (see services/gem_ledger.py).
    gems_balance: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    equipped_theme: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default=text("'starter'")
    )
    # Avatar identity (PLAN.md §11 / identity v1). avatar_preset is one of the free preset ids
    # (see app/core/constants.AVATAR_PRESETS); illustrated portrait + gradient live in frontend
    # identity.ts. equipped_frame is NULL = no frame; "frame_none" is the sentinel for unequip.
    avatar_preset: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default=text("'knight'")
    )
    equipped_frame: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Identity v2: badges/titles are achievements (earned computed on read — see
    # services/achievements.py); only the player's PICK is stored. equipped_badges holds up to 3
    # badge ids in display order; equipped_title is NULL = no title. Endpoints always REASSIGN
    # equipped_badges (never mutate in place) so SQLAlchemy sees the change.
    equipped_badges: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    equipped_title: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # IANA zone reported by the device (e.g. "America/Denver"), for scheduling notifications in the
    # player's own evening rather than the contest's. NULL until a client tells us — every read goes
    # through services/localtime.py, which falls back to ET (the contest anchor).
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="profile")


from app.models.user import User  # noqa: E402
