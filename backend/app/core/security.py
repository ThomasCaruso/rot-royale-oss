"""Password hashing (argon2) and JWT issue/verify (docs/architecture.md).

argon2 is used over bcrypt: no 72-byte input truncation, strong memory-hard defaults, no passlib
version-detection issues. JWTs are stateless HS256 with a `type` claim separating access/refresh.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error

from app.core.config import settings

_ph = PasswordHasher()


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, password)
    except Argon2Error:
        return False


def _create_token(subject: str, token_type: str, expires_delta_seconds: int) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "iat": now,
        "exp": now + timedelta(seconds=expires_delta_seconds),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(subject: str, expires_delta_seconds: int | None = None) -> str:
    ttl = (
        expires_delta_seconds
        if expires_delta_seconds is not None
        else settings.access_token_ttl_minutes * 60
    )
    return _create_token(subject, "access", ttl)


def create_refresh_token(subject: str, expires_delta_seconds: int | None = None) -> str:
    ttl = (
        expires_delta_seconds
        if expires_delta_seconds is not None
        else settings.refresh_token_ttl_days * 86400
    )
    return _create_token(subject, "refresh", ttl)


def decode_token(token: str) -> dict[str, Any]:
    """Decode and verify a token. Raises jwt.ExpiredSignatureError / jwt.InvalidTokenError."""
    return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
