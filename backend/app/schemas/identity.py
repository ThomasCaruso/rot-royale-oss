"""Identity API shapes (GET /identity): the full badge/title catalogs with per-user flags.

Earned is server-computed (services/achievements.py); the frontend never decides what's earned.
Names/blurbs/emoji are frontend visuals (src/theme/identity.ts) keyed by these ids.
"""

from __future__ import annotations

from pydantic import BaseModel


class IdentityItemOut(BaseModel):
    id: str
    earned: bool
    equipped: bool


class IdentityResponse(BaseModel):
    badges: list[IdentityItemOut]
    titles: list[IdentityItemOut]
