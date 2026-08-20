"""Password hashing + JWT (app.core.security)."""

from __future__ import annotations

import jwt
import pytest
from app.core import security


def test_password_hash_verifies_correct_password():
    hashed = security.hash_password("correct horse battery staple")
    assert hashed != "correct horse battery staple"
    assert security.verify_password("correct horse battery staple", hashed) is True


def test_password_hash_rejects_wrong_password():
    hashed = security.hash_password("right-password")
    assert security.verify_password("wrong-password", hashed) is False


def test_password_hashes_are_salted():
    a = security.hash_password("same")
    b = security.hash_password("same")
    assert a != b  # unique salt per hash


def test_access_token_roundtrips_subject_and_type():
    token = security.create_access_token("user-123")
    claims = security.decode_token(token)
    assert claims["sub"] == "user-123"
    assert claims["type"] == "access"


def test_refresh_token_has_refresh_type():
    token = security.create_refresh_token("user-123")
    claims = security.decode_token(token)
    assert claims["sub"] == "user-123"
    assert claims["type"] == "refresh"


def test_decode_rejects_expired_token():
    token = security.create_access_token("user-123", expires_delta_seconds=-1)
    with pytest.raises(jwt.ExpiredSignatureError):
        security.decode_token(token)
