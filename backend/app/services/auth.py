"""Authentication service (PLAN.md §8): verify credentials and issue tokens."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, create_refresh_token
from app.models import User
from app.schemas.auth import TokenResponse


class InvalidCredentialsError(Exception):
    pass


async def authenticate_user(session: AsyncSession, email: str, password: str) -> User:
    from app.core.security import verify_password

    email = email.strip().lower()
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        raise InvalidCredentialsError()
    return user


def issue_tokens(user: User) -> TokenResponse:
    subject = str(user.id)
    return TokenResponse(
        access_token=create_access_token(subject),
        refresh_token=create_refresh_token(subject),
    )
