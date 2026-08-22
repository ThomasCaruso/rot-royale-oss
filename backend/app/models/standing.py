"""Settled standings (docs/architecture.md). Written once per real user when a window settles.

`field_size` is the size of the field the placement was computed against, stored here so results can
say "place X of N". That field is REAL ENTRIES ONLY — the cold-start bots that once padded a thin
field in memory are gone, so a stored "3rd of 8" means eight people actually played (DESIGN §7).
Historic rows written before the removal may carry a padded count; they are left as settled.
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Standing(Base):
    __tablename__ = "standings"

    window_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("contest_windows.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    place: Mapped[int] = mapped_column(Integer, nullable=False)
    field_size: Mapped[int] = mapped_column(Integer, nullable=False)
    total_score: Mapped[int] = mapped_column(Integer, nullable=False)
    coins_awarded: Mapped[int] = mapped_column(Integer, nullable=False)
    # placement gems for royale; 0 for legacy/non-royale windows
    gems_awarded: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rating_before: Mapped[int] = mapped_column(Integer, nullable=False)
    rating_after: Mapped[int] = mapped_column(Integer, nullable=False)
