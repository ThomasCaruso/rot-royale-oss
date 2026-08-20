"""Registration service (app.services.registration): seed profile + default theme + ledger."""

from __future__ import annotations

import app.services.registration as reg
import pytest
from app.core.constants import DEFAULT_THEME_ID, STARTING_COINS, STARTING_RATING
from app.core.security import verify_password
from app.models import CoinLedger, Profile, User, UserTheme
from app.services.registration import (
    EmailAlreadyExistsError,
    UsernameAlreadyExistsError,
    register_user,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def test_register_seeds_profile_with_defaults(db_session: AsyncSession):
    user = await register_user(db_session, "Player@Example.com", "player1", "super-secret-pw")
    # email normalized to lowercase
    assert user.email == "player@example.com"
    assert verify_password("super-secret-pw", user.password_hash)
    assert user.password_hash != "super-secret-pw"

    profile = await db_session.get(Profile, user.id)
    assert profile is not None
    assert profile.username == "player1"
    assert profile.rating == STARTING_RATING == 1000
    assert profile.division == "Bronze"
    assert profile.streak_count == 0
    assert profile.sharpness == 0
    assert profile.coins_balance == STARTING_COINS
    assert profile.equipped_theme == DEFAULT_THEME_ID == "starter"


async def test_register_grants_default_theme_ownership(db_session: AsyncSession):
    user = await register_user(db_session, "a@b.com", "owner", "super-secret-pw")
    owned = (
        (await db_session.execute(select(UserTheme.theme_id).where(UserTheme.user_id == user.id)))
        .scalars()
        .all()
    )
    assert owned == [DEFAULT_THEME_ID]


async def test_coins_balance_equals_ledger_sum_at_seed(db_session: AsyncSession):
    user = await register_user(db_session, "ledger@b.com", "ledgerguy", "super-secret-pw")
    profile = await db_session.get(Profile, user.id)
    ledger_sum = (
        await db_session.execute(
            select(func.coalesce(func.sum(CoinLedger.delta), 0)).where(
                CoinLedger.user_id == user.id
            )
        )
    ).scalar_one()
    assert profile is not None
    assert profile.coins_balance == ledger_sum  # invariant holds whatever STARTING_COINS is


async def test_duplicate_email_rejected_case_insensitive(db_session: AsyncSession):
    await register_user(db_session, "dup@b.com", "first", "super-secret-pw")
    with pytest.raises(EmailAlreadyExistsError):
        await register_user(db_session, "DUP@b.com", "second", "super-secret-pw")


async def test_duplicate_username_rejected(db_session: AsyncSession):
    await register_user(db_session, "one@b.com", "samename", "super-secret-pw")
    with pytest.raises(UsernameAlreadyExistsError):
        await register_user(db_session, "two@b.com", "samename", "super-secret-pw")


async def test_only_one_user_count(db_session: AsyncSession):
    await register_user(db_session, "solo@b.com", "solo", "super-secret-pw")
    count = (await db_session.execute(select(func.count()).select_from(User))).scalar_one()
    assert count == 1


async def _exists_false(*_args: object, **_kwargs: object) -> bool:
    """Stub for the pre-check: simulates the TOCTOU window where another transaction inserted the
    row AFTER our SELECT ran but BEFORE our INSERT — the pre-check returns 'clear', so the INSERT
    is the one that hits the unique index."""
    return False


async def test_register_concurrent_email_collision_maps_to_conflict(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    # A concurrent signup already took this email; our pre-check missed it (race). The unique-index
    # violation on INSERT must surface as a clean EmailAlreadyExistsError (→409), not a 500.
    await register_user(db_session, "race@b.com", "alpha", "super-secret-pw")
    monkeypatch.setattr(reg, "_exists", _exists_false)
    with pytest.raises(EmailAlreadyExistsError):
        await reg.register_user(db_session, "race@b.com", "beta", "super-secret-pw")


async def test_register_concurrent_username_collision_maps_to_conflict(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    # Same race on the username unique index → clean UsernameAlreadyExistsError (→409), not a 500.
    await register_user(db_session, "u1@b.com", "takenname", "super-secret-pw")
    monkeypatch.setattr(reg, "_exists", _exists_false)
    with pytest.raises(UsernameAlreadyExistsError):
        await reg.register_user(db_session, "u2@b.com", "takenname", "super-secret-pw")
