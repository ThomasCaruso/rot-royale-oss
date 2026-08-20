"""Challenge (viral share loop) schemas.

Spoiler-free by construction: these carry only display metadata (handle, score, provisional
place/field) — never a question, option, or answer.
"""

from __future__ import annotations

import uuid
from datetime import date

from pydantic import BaseModel


class ChallengeCreateIn(BaseModel):
    entry_id: uuid.UUID


class ChallengeOut(BaseModel):
    """Returned to the sharer on create — enough to render + copy the share link."""

    id: str
    url: str
    contest_no: int
    score: int
    place: int | None
    field_size: int | None
    percentile: int | None


class ChallengePublicOut(BaseModel):
    """Public, spoiler-free snapshot for the share landing (no auth). No questions/answers.

    playable_window_id lets the landing offer immediate "play today's Royale" when one is OPEN.
    """

    id: str
    username: str
    contest_no: int
    contest_date: date
    score: int
    place: int | None
    field_size: int | None
    percentile: int | None
    playable_window_id: str | None
    # The sharer's CURRENTLY equipped theme id, read live from their profile rather than snapshotted
    # at share time — the landing paints itself in the sender's skin, so re-equipping updates every
    # link they've already sent. Cosmetic only; never gates play. Falls back to the default theme.
    theme: str
