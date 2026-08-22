"""Profile response schema (GET /me)."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class RotSubExposure(BaseModel):
    rating: int
    provisional: bool
    rounds_played: int


class RotRatingResponse(BaseModel):
    """The Rot Rating exposure (docs/architecture.md §9) — the headline sharpness number + its three
    derived-from parts. Deliberately NOT labeled or described as IQ anywhere."""

    rating: int
    provisional: bool
    rounds_played: int
    last_change: str  # up | down | flat
    version: int
    sub_ratings: dict[str, RotSubExposure]  # notice | estimate | know


class MeResponse(BaseModel):
    user_id: uuid.UUID
    email: str
    username: str
    is_guest: bool = False  # anonymous-first account that hasn't saved an email/password yet
    rating: int  # Elo — kept under the hood (drives placement deltas + division)
    rank: int  # global rank among all real players by rating desc (#1 = best); ties share a rank
    total_players: int  # how many players the rank is out of
    division: str
    streak_count: int
    sharpness: int
    coins_balance: int
    gems_balance: int
    equipped_theme: str
    avatar_preset: str
    equipped_frame: str | None
    equipped_badges: list[str]
    equipped_title: str | None


class WalletDuel(BaseModel):
    """Per-day bot Gem-duel cap usage (GET /me/wallet) — surfaces the duel daily limit."""

    bot_gem_duels_used: int
    bot_gem_duels_cap: int


class WalletResponse(BaseModel):
    """Balances for both currencies (GET /me/wallet)."""

    coins_balance: int
    gems_balance: int
    duel: WalletDuel


class AvatarUpdate(BaseModel):
    """Body for PATCH /me/avatar."""

    preset_id: str


class AvatarResponse(BaseModel):
    """Response from PATCH /me/avatar."""

    avatar_preset: str


class BadgesUpdate(BaseModel):
    """Body for PATCH /me/badges: the full pick (≤3 badge ids, order = display order)."""

    badge_ids: list[str]


class BadgesResponse(BaseModel):
    """Response from PATCH /me/badges."""

    equipped_badges: list[str]


class TitleUpdate(BaseModel):
    """Body for PATCH /me/title. None clears the title."""

    title_id: str | None


class TitleResponse(BaseModel):
    """Response from PATCH /me/title."""

    equipped_title: str | None


class UsernameQuoteOut(BaseModel):
    """What changing the handle would cost right now (so the UI can price it before confirming)."""

    cost: int
    free_changes_remaining: int
    changes_made: int
    balance: int
    affordable: bool


class UsernameChangeRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)


class UsernameChangeOut(BaseModel):
    username: str
    cost: int  # coins actually charged (0 for the free change)
    balance: int  # coin balance AFTER the change
    changes_made: int
