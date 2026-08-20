"""Seasons — the exactly-once gate for the monthly ladder soft-reset.

One row per season that has been closed + reset. The season key is the ET calendar month of the
season that ended (``YYYY-MM``). The reset job claims this row (INSERT ON CONFLICT DO NOTHING) in
the same transaction that applies the reset, so a season resets at most once — even under multiple
job instances / a crash mid-batch.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class SeasonReset(Base):
    __tablename__ = "season_resets"

    season_key: Mapped[str] = mapped_column(String(7), primary_key=True)  # "YYYY-MM"
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
