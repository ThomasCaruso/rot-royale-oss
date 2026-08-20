"""Pydantic schemas for the cognition endpoints (estimate, change_detection)."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field


class EstimateStartResponse(BaseModel):
    instance_id: uuid.UUID
    spec: dict[str, Any]


class EstimateGuessRequest(BaseModel):
    # Finite numbers only — JSON permits 1e999 (→ inf), which would poison the tolerance math.
    value: float = Field(allow_inf_nan=False)


class EstimateGuessResponse(BaseModel):
    correct: bool
    direction: str | None
    band: str | None  # "close" | "far" on a miss; None on the resolving guess
    done: bool
    guesses_left: int
    points: int
    slider_min: float  # server-narrowed surviving range; the client renders it, never computes it
    slider_max: float


class EstimateResolveResponse(BaseModel):
    answer: float
    unit: str | None
    acceptable_pct: float
    close_pct: float
    points: int
    reveal_explanation: str
    intuition_note: str | None
    components: list[dict[str, Any]]
    guesses: list[float]
    id: str | None  # the item's content-file source_id, for in-the-moment admin rating


class ChangeStartResponse(BaseModel):
    instance_id: uuid.UUID
    spec: dict[str, Any]


class ChangeSubmitRequest(BaseModel):
    # Taps arrive in NORMALIZED image coordinates (0-1 per axis) — mapping from screen pixels is
    # the client's rendering concern, so screen size never changes difficulty.
    #
    # NULL x/y means the round TIMED OUT with no tap. The client used to signal that by sending
    # (-1, -1), which this schema rejected with a 422 — so every timeout left the cognition instance
    # unresolved and the Royale bridge then 409'd, stranding the player on "finish this round before
    # moving on" with no way to finish it. A timeout is a legitimate outcome, not a malformed tap,
    # so it gets its own representation rather than an out-of-range sentinel.
    # ge=-1, NOT ge=0: the SHIPPED iOS/Android bundle signals "timed out, no tap" as (-1, -1), and
    # an app binary cannot be changed on Apple's timetable. Rejecting it 422'd every timeout on
    # every installed app, which left the cognition instance unresolved and the Royale bridge 409ing
    # — players stranded mid-run, unable to finish. Any negative coordinate is therefore read as the
    # legacy no-tap sentinel; anything above 1 is still rejected, so genuine garbage is not excused.
    x: float | None = Field(default=None, ge=-1, le=1, allow_inf_nan=False)
    y: float | None = Field(default=None, ge=-1, le=1, allow_inf_nan=False)
    elapsed_ms: int = Field(ge=0)


class ChangeSubmitResponse(BaseModel):
    hit: bool
    points: int
    done: bool
    bbox: dict[str, float]  # revealed post-resolution so the client can show the change


class EstimateVerdictRequest(BaseModel):
    # A closed set — `repetitive` (the reasoning path recurred) is distinct from `boring`.
    verdict: Literal["good", "boring", "unfair", "repetitive", "broken"]
    note: str | None = Field(default=None, max_length=2000)


class EstimateVerdictResponse(BaseModel):
    id: str
    verdict: str
    note: str | None
    rated_at: str


class EstimateUnratedItem(BaseModel):
    id: str
    prompt: str
    answer: float
    unit: str | None
    difficulty: str
    category: str | None


class EstimateUnratedResponse(BaseModel):
    items: list[EstimateUnratedItem]
