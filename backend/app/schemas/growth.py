"""Pydantic response schema for GET /me/growth."""

from __future__ import annotations

from pydantic import BaseModel


class BrainScoreOut(BaseModel):
    current: int
    delta: int


class TrendPointOut(BaseModel):
    date: str
    score: int


class CategoryGrowthOut(BaseModel):
    category: str
    accuracy: float
    spark: list[float]
    direction: str  # up | down | flat


class ConsistencyOut(BaseModel):
    days_played: int
    streak: int


class GrowthOut(BaseModel):
    brain_score: BrainScoreOut
    trend: list[TrendPointOut]
    categories: list[CategoryGrowthOut]
    consistency: ConsistencyOut


class MasteryItem(BaseModel):
    category: str
    level: int  # 0 = warming up, 1..5 (5 = Mastered)
    attempts: int
    mastered: bool


class MasteryOut(BaseModel):
    categories: list[MasteryItem]
