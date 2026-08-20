"""Contest play schemas (PLAN.md §8)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


class RoundSpecOut(BaseModel):
    idx: int
    type: str
    client_spec: dict[str, Any]  # answer-free spec only


class EnterResponse(BaseModel):
    entry_id: uuid.UUID
    window_id: uuid.UUID
    rounds: list[RoundSpecOut]


class RoundSubmission(BaseModel):
    idx: int
    # Opaque, module-specific result (trivia/rapid_math: {choice, elapsed_ms};
    # memory_flash: {taps, tap_times, elapsed_ms}). The contest engine/scoring never inspect this —
    # only the round module's score() does, so adding a module needs no change here.
    result: dict[str, Any] = {}


class SubmitRequest(BaseModel):
    rounds: list[RoundSubmission]
    # Accepted for client convenience but DELIBERATELY IGNORED — the server score is canonical.
    client_score: int | None = None


class RoundResultOut(BaseModel):
    idx: int
    module_type: str
    points: int
    correct: bool
    # Server answer for the post-submit reveal (e.g. {correctIndex} / {sequence}). Entry is locked.
    answer: dict[str, Any] = {}


class SubmitResponse(BaseModel):
    entry_id: uuid.UUID
    total_score: int
    provisional: bool = True
    rounds: list[RoundResultOut]


class AnswerRoundRequest(BaseModel):
    idx: int
    result: dict[str, Any] = {}
    # §5f capability opt-in. The second chance does NOT finalize the round, so a client that treats
    # the offer as an ordinary reveal advances and then wedges against the sequence guard. The
    # shipped App Store binary predates §5f and cannot be updated, so the offer is made only to
    # clients that say they understand it; the default is the pre-§5f contract.
    supports_retry: bool = False


class AnswerRoundResponse(BaseModel):
    idx: int
    module_type: str
    points: int
    correct: bool
    valid: bool
    answer: dict[str, Any] = {}  # server answer, revealed post-lock for this round
    total_score: int  # running total through this round
    finished: bool  # the entry is now SUBMITTED (last round)
    # §5f second-chance: set when a Daily Royale trivia round's FIRST pick was wrong. The round is
    # NOT finalized; the client greys `eliminated` (its own pick — the answer stays hidden) and has
    # `retry_ms` to pick once more for half points.
    retry_available: bool = False
    eliminated: int | None = None
    retry_ms: int = 0


class StandingOut(BaseModel):
    place: int
    field_size: int
    username: str
    total_score: int
    coins_awarded: int
    gems_awarded: int
    # NO rating_before/rating_after. Elo is private (MeResponse: "kept under the hood"), and this is
    # a CROSS-USER schema — publishing it here let any player enumerate every participant's hidden
    # rating. A player sees their own number via /me and their own settled results via /me/history;
    # nobody sees anyone else's. Do not re-add it here or to any other cross-user response.
    avatar_preset: str
    equipped_frame: str | None
    equipped_badges: list[str] = []
    equipped_title: str | None = None


class StandingsResponse(BaseModel):
    window_id: uuid.UUID
    state: str
    standings: list[StandingOut]


class HistoryItem(BaseModel):
    window_id: uuid.UUID
    contest_date: date
    slot: str
    state: str
    total_score: int | None = None
    # populated once the window is SETTLED:
    place: int | None = None
    field_size: int | None = None
    coins_awarded: int | None = None
    gems_awarded: int | None = None
    rating_before: int | None = None
    rating_after: int | None = None


class HistoryResponse(BaseModel):
    items: list[HistoryItem]


class WindowOut(BaseModel):
    id: uuid.UUID
    slot: str
    state: str
    open_at: datetime
    close_at: datetime
    # When results settle = close_at + SETTLE_DELAY_MINUTES (12:15 AM ET for the Daily Royale).
    # Derived, not a DB column — drives the client "Results settling" countdown.
    settle_at: datetime
    entry_count: int = 0  # REAL field size for this window (count of entries) — never fabricated


class CurrentContestResponse(BaseModel):
    open_window: WindowOut | None
    schedule: list[WindowOut]


class FieldEntryOut(BaseModel):
    username: str
    points: list[int]  # per-round points; cumulative-through-N is sum(points[:N+1])
    avatar_preset: str
    equipped_frame: str | None
    equipped_badges: list[str] = []
    equipped_title: str | None = None


class FieldResponse(BaseModel):
    window_id: uuid.UUID
    # `entries` is the TOP SLICE by score (bounded for scale), not the whole field. `field_size` is
    # the true total; `my_rank`/`my_score` are the caller's standing over the FULL field, so a
    # player ranked below the slice still shows a correct "Nth of M". Older clients that ignore the
    # new fields and derive from `entries` keep working for fields within the cap.
    entries: list[FieldEntryOut]
    field_size: int = 0
    my_rank: int | None = None
    my_score: int = 0


class MyEntryResponse(BaseModel):
    entry_id: uuid.UUID | None = None
    status: str | None = None
    submitted_at: datetime | None = None


class RotReportOut(BaseModel):
    """A finished entry's own-run report, REBUILT from stored rounds (services/rot_report.py).

    Own-run facts only — no field/placement framing, which isn't known until settlement. Lets Home
    re-open the report on a device that didn't play the run (the client stash is per-device).
    """

    score: int
    total: int
    incorrect: int
    avg_ms: int | None = None
    fastest_ms: int | None = None
    #: Per-round outcome in play order, always `total` long — the client's tick/cross grid.
    rounds: list[bool]


class FriendBoardRowOut(BaseModel):
    user_id: uuid.UUID
    username: str
    avatar_preset: str
    equipped_frame: str | None
    # Worn on the friends podium exactly as on the global one — a title is earned proof, so it
    # travels with the identity wherever that identity is shown.
    equipped_title: str | None
    score: int
    rank: int
    is_me: bool


class FriendBoardPendingOut(BaseModel):
    user_id: uuid.UUID
    username: str
    avatar_preset: str
    equipped_frame: str | None = None


class FriendsBoardOut(BaseModel):
    my_rank: int | None
    friend_field_size: int
    played: list[FriendBoardRowOut]
    yet_to_play: list[FriendBoardPendingOut]
