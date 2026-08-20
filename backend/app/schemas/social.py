"""Friends + live friend-duel schemas (the social layer — PLAN.md §13, now in scope).

The friend-duel round/outcome strings are RAW server codes (challenger_win|opponent_win|no_point,
correct_vs_wrong|speed_gap|…); the frontend maps them to copy-safe labels via i18n, matching the bot
duel convention (no English rival/outcome labels in the backend).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


# ---------------- friends ----------------
class FriendOut(BaseModel):
    user_id: uuid.UUID
    username: str
    avatar_preset: str
    wins: int  # your head-to-head duel wins vs this friend
    losses: int  # your head-to-head duel losses vs this friend
    streak: int = 0
    last_result: str | None = None
    last_played: datetime | None = None
    duels_14d: int = 0
    # A friend wears their equipped frame/title in your list exactly as they do on the leaderboard —
    # earned cosmetics travel with the identity wherever it is shown.
    equipped_frame: str | None = None
    equipped_title: str | None = None


class FriendRequestOut(BaseModel):
    request_id: uuid.UUID
    user_id: uuid.UUID
    username: str
    avatar_preset: str
    created_at: datetime


class FriendsResponse(BaseModel):
    friends: list[FriendOut]
    incoming: list[FriendRequestOut]
    outgoing: list[FriendRequestOut]
    rival_user_id: uuid.UUID | None = None


class FriendRequestCreate(BaseModel):
    username: str


class FriendRequestResult(BaseModel):
    request_id: uuid.UUID
    status: str  # pending|accepted


class FriendRespondRequest(BaseModel):
    accept: bool


# ---------------- friend duels ----------------
class FriendDuelCreate(BaseModel):
    username: str


# ---------------- friend challenge (async "beat my Daily Royale score") ----------------
class FriendChallengeCreate(BaseModel):
    username: str


class FriendChallengeResult(BaseModel):
    ok: bool = True
    # True when this call actually dispatched the nudge; False when the recipient was already
    # challenged today (idempotent no-op). The button reads "Challenge sent" either way.
    sent: bool


class FriendDuelSummaryOut(BaseModel):
    duel_id: uuid.UUID
    status: str
    your_side: str  # challenger|opponent
    opponent_id: uuid.UUID
    opponent_username: str
    opponent_avatar: str
    challenger_round_wins: int
    opponent_round_wins: int
    created_at: datetime


class FriendDuelListResponse(BaseModel):
    incoming: list[FriendDuelSummaryOut]
    outgoing: list[FriendDuelSummaryOut]
    active: list[FriendDuelSummaryOut]


class FriendDuelRespondRequest(BaseModel):
    accept: bool


class FriendDuelStateResponse(BaseModel):
    duel_id: uuid.UUID
    status: str
    your_side: str
    opponent_username: str
    opponent_avatar: str
    current_round: int
    challenger_round_wins: int
    opponent_round_wins: int
    winner_side: str | None
    result_reason: str | None
    # The answer-free client specs (sent so a participant can resume/replay locally).
    rounds: list[dict[str, Any]]
