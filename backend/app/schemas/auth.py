"""Auth request/response schemas (PLAN.md §8)."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str


class UpgradeRequest(BaseModel):
    """Guest → saved profile ("Save your Brain Profile"): email, username and password.

    `username` mirrors RegisterRequest's constraints exactly — the same handle, claimed through a
    different door, so the rules cannot drift between the two paths.

    It is OPTIONAL rather than required: omitting it keeps the auto-generated guest handle. That
    keeps older clients (and the guest flow's original contract) working, while the current UI
    always sends it, pre-filled with the handle the player has been playing under so accepting it
    costs one tap.
    """

    email: EmailStr
    username: str | None = Field(default=None, min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
