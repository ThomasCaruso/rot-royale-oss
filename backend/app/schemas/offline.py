"""Offline play sync schemas.

An offline result is a list of recorded choices (the STABLE original bank option index the player
picked, plus elapsed_ms) that the server re-scores on sync. `client_id` is a client-generated UUID —
the exactly-once key that makes re-syncing the same offline result idempotent.
"""

from __future__ import annotations

from pydantic import BaseModel


class OfflineItem(BaseModel):
    question_id: str
    selected_source_index: int  # the ORIGINAL bank option index the player chose (stable)
    elapsed_ms: int


class CampaignOfflineCompleteRequest(BaseModel):
    world: str
    level: int
    client_id: str  # client-generated UUID; the exactly-once key
    items: list[OfflineItem]


class PracticeOfflineSubmitRequest(BaseModel):
    # The session shape the client played offline: "practice" | "quick" | "category" | "starter".
    # Offline practice/category sessions award NO coins — they only score + nudge sharpness +
    # record personalization signals (mirrors the online no-stakes path).
    mode: str | None = None
    category: str | None = None  # scopes the re-score bank to one category when set
    client_id: str  # client-generated UUID; the exactly-once key
    items: list[OfflineItem]
