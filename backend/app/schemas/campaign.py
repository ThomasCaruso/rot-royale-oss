"""Campaign Mode schemas. Play reuses the practice round shapes; coins are cosmetic-only."""

from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.schemas.contest import RoundSpecOut


class CampaignLevelOut(BaseModel):
    level_number: int
    title: str
    arc_name: str
    is_boss: bool
    difficulty_mix: dict[str, int]  # {"easy": n, "medium": n, "hard": n}
    unlocked: bool
    cleared: bool
    clear_status: str | None  # 'clear'|'strong'|'perfect' or null
    best_correct: int


class CampaignArcOut(BaseModel):
    name: str
    levels: list[CampaignLevelOut]


class CampaignWorldOut(BaseModel):
    world: str  # short display name
    category: str  # canonical bank category
    arcs: list[CampaignArcOut]
    cleared_count: int
    total_levels: int


class CampaignLadderResponse(BaseModel):
    worlds: list[CampaignWorldOut]
    daily_coins_earned: int
    daily_coins_cap: int


class CampaignStartRequest(BaseModel):
    world: str
    level: int


class CampaignStartResponse(BaseModel):
    entry_id: uuid.UUID
    world: str
    level: int
    title: str
    is_boss: bool
    rounds: list[RoundSpecOut]  # answer-free client specs only


class CampaignCompleteResponse(BaseModel):
    world: str
    level: int
    title: str
    is_boss: bool
    correct: int
    total: int
    passed: bool
    clear_status: str | None
    coins_awarded: int
    gems_awarded: int
    daily_cap_reached: bool
    first_clear: bool
    next_level_unlocked: bool
    best_correct: int
