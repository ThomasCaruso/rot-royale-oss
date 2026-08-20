"""Brain Boost API schemas — the Brain Profile read surfaced after a check and on home."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class CategoryPerfOut(BaseModel):
    category: str
    correct: int
    total: int
    accuracy: float  # 0..1
    score: int  # 0..100 display score for the Brain Profile bars


class BrainBoostSummaryOut(BaseModel):
    entry_id: uuid.UUID
    mode: str  # "starter" | "quick"
    submitted_at: datetime
    total: int
    correct: int
    accuracy: float
    brain_score: int  # 300..900
    rot_type: str
    strengths: list[CategoryPerfOut]  # top ≤3, best first
    weaknesses: list[CategoryPerfOut]  # bottom ≤2, weakest first
    categories: list[CategoryPerfOut]  # all answered categories, best first
    weak_spot_topic: str | None  # from AI metadata of missed questions; null when unclassified
    movements: dict[str, int]  # category → small ± delta vs the previous check ({} on first)
    first_check: bool  # true → the reveal should use "early read / starter profile" language


class BrainBoostTodayResponse(BaseModel):
    completed_today: bool
    has_any_check: bool
    latest: BrainBoostSummaryOut | None  # today's check when completed_today, else the most recent
