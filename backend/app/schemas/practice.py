"""Practice Mode schemas (M8). Reuses the contest round shapes; no coins/rating — no stakes."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel

from app.schemas.contest import RoundResultOut, RoundSpecOut, RoundSubmission


class PracticeStartRequest(BaseModel):
    # Optional: scope the session to one category (a 10-question trivia session). Omitted/null = the
    # mixed practice template across all categories.
    category: str | None = None
    # Optional session shape: "quick" = Quick Play, the 8-question mixed-category trivia run (the
    # post-Royale casual loop / daily Brain Boost); "starter" = the first-run Starter Check
    # (calibration ramp over a category-balanced bank). Always mixed — `category` is ignored
    # when mode is set.
    mode: Literal["quick", "starter"] | None = None


class PracticeStartResponse(BaseModel):
    entry_id: uuid.UUID
    rounds: list[RoundSpecOut]  # answer-free client specs only


class PracticeSubmitRequest(BaseModel):
    rounds: list[RoundSubmission]


class PracticeSubmitResponse(BaseModel):
    entry_id: uuid.UUID
    accuracy: float  # 0..1
    correct: int
    total: int
    sharpness: int  # new sharpness value (capped at 100)
    sharpness_gained: int
    rounds: list[RoundResultOut]


class PracticeAnswerRequest(BaseModel):
    idx: int
    result: dict[str, Any] = {}  # opaque, module-specific (the module's score() reads its fields)


class PracticeAnswerResponse(BaseModel):
    """Lesson-mode per-round reveal. `explanation` lives ONLY here — deliberately NOT on the shared
    contest reveal schemas, so the ranked contest's payload is unchanged."""

    idx: int
    module_type: str
    correct: bool
    valid: bool
    answer: dict[str, Any] = {}  # server answer (e.g. {correctIndex}), revealed post-lock
    explanation: str | None = (
        None  # the "here's why" payload (null for generated / no-explanation Qs)
    )
    finished: bool
    # Populated only on the final round:
    correct_count: int | None = None
    total: int | None = None
    accuracy: float | None = None
    sharpness: int | None = None
    sharpness_gained: int | None = None
