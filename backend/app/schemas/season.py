"""Season status schema — the current monthly season + the viewer's standing in it."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class SeasonOut(BaseModel):
    season: str  # "YYYY-MM"
    label: str  # "July 2026"
    ends_at: datetime  # UTC instant the season closes (00:00 ET, 1st of next month)
    rating: int
    division: str
    duel_tier: str
