"""Duel Mode schemas (Task 3.5). Exposes the duel services; reuses the contest round shape.

Mirrors the practice schemas' style. The rival tier is the RAW server string (rookie|solid|sharp|
elite) — the frontend maps it to copy-safe labels via i18n; no English rival labels in the backend.
"""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel

from app.schemas.contest import RoundSpecOut


class DuelTierOut(BaseModel):
    type: str
    entry_gems: int
    pool_gems: int
    unlocked: bool
    unlock_wins: int


class DuelConfigResponse(BaseModel):
    tiers: list[DuelTierOut]
    bot_gem_cap: int
    bot_gem_used: int
    gems_balance: int


class DuelCreateRequest(BaseModel):
    duel_type: str


class DuelCreateResponse(BaseModel):
    match_id: uuid.UUID
    duel_type: str
    entry_gems: int
    pool_gems: int
    rival_tier: str  # raw tier (rookie|solid|sharp|elite) — frontend maps to copy-safe labels
    rounds: list[RoundSpecOut]  # answer-free client specs only


class DuelRoundRequest(BaseModel):
    idx: int
    result: dict[str, Any] = {}  # opaque, module-specific (the module's score() reads its fields)


class DuelResultOut(BaseModel):
    """The final settled outcome — populated only on the deciding round."""

    winner: str
    result_reason: str
    user_round_wins: int
    rival_round_wins: int
    gem_delta: int
    xp_awarded: int
    perfect: bool
    comeback: bool
    duel_tier: str


class DuelRoundResponse(BaseModel):
    idx: int
    outcome: str  # user_win|rival_win|no_point
    outcome_reason: str
    your_correct: bool
    your_time_ms: int
    answer: dict[str, Any] = {}  # server answer (carries correctIndex — safe post-lock)
    rival_correct: bool
    rival_time_ms: int
    user_round_wins: int
    rival_round_wins: int
    phase: str  # normal|sudden_death
    next: str  # normal|sudden_death|done
    finished: bool
    result: DuelResultOut | None = None  # only on the deciding round


class DuelMatchStateResponse(BaseModel):
    match_id: uuid.UUID
    duel_type: str
    status: str
    entry_gems: int
    pool_gems: int
    rival_tier: str | None
    user_round_wins: int
    rival_round_wins: int
    rounds_played: int
    winner: str | None
    result_reason: str | None
    gem_delta: int
    xp_awarded: int


class DuelStatsResponse(BaseModel):
    wins: int
    losses: int
    training_wins: int
    training_losses: int
    current_streak: int
    best_streak: int
    perfect_wins: int
    comeback_wins: int
    total_gems_won: int
    total_gems_lost: int
    duel_xp: int
    duel_tier: str
