"""Changing the public handle: first free, then coins.

The properties that matter are the money ones — a player must never be charged for a name they did
not get, never charged twice, and the cached balance must always equal the append-only ledger sum
(PLAN §8).
"""

from __future__ import annotations

import pytest
from app.core.constants import USERNAME_CHANGE_COST
from app.models import CoinLedger, Profile
from app.services.ledger import record_coin_delta
from app.services.registration import register_user
from app.services.username import (
    InsufficientCoinsError,
    InvalidUsernameError,
    SameUsernameError,
    UsernameTakenError,
    change_username,
    cost_for,
    quote_username_change,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def _player(session: AsyncSession, email: str, username: str, coins: int = 0):
    user = await register_user(session, email, username, "super-secret-pw")
    if coins:
        await record_coin_delta(session, user.id, coins, "test_grant")
    await session.flush()
    return user


async def _ledger_sum(session: AsyncSession, user_id) -> int:
    return int(
        await session.scalar(
            select(func.coalesce(func.sum(CoinLedger.delta), 0)).where(
                CoinLedger.user_id == user_id
            )
        )
        or 0
    )


def test_pricing_rule() -> None:
    assert cost_for(0) == 0, "the first change is free"
    assert cost_for(1) == USERNAME_CHANGE_COST
    assert cost_for(9) == USERNAME_CHANGE_COST


@pytest.mark.asyncio
class TestFirstChangeIsFree:
    async def test_free_and_charges_nothing(self, db_session: AsyncSession) -> None:
        user = await _player(db_session, "free@example.com", "StartName", coins=500)

        res = await change_username(db_session, user.id, "NewName")
        assert res.cost == 0
        assert res.username == "NewName"
        assert res.changes_made == 1
        assert res.balance == 500, "a free change must not move the balance"

        # No ledger row for a free change — nothing was spent.
        rows = (
            (
                await db_session.execute(
                    select(CoinLedger).where(
                        CoinLedger.user_id == user.id, CoinLedger.reason == "username_change"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows == []

    async def test_quote_reports_free_then_priced(self, db_session: AsyncSession) -> None:
        user = await _player(db_session, "quote@example.com", "QuoteMe", coins=500)

        before = await quote_username_change(db_session, user.id)
        assert (before.cost, before.free_changes_remaining, before.affordable) == (0, 1, True)

        await change_username(db_session, user.id, "QuoteMe2")

        after = await quote_username_change(db_session, user.id)
        assert after.cost == USERNAME_CHANGE_COST
        assert after.free_changes_remaining == 0
        assert after.changes_made == 1


@pytest.mark.asyncio
class TestPaidChange:
    async def test_debits_through_the_ledger_and_keeps_the_invariant(
        self, db_session: AsyncSession
    ) -> None:
        user = await _player(db_session, "paid@example.com", "PayMe", coins=500)
        await change_username(db_session, user.id, "PayMe2")  # free one

        res = await change_username(db_session, user.id, "PayMe3")
        assert res.cost == USERNAME_CHANGE_COST
        assert res.balance == 500 - USERNAME_CHANGE_COST
        assert res.changes_made == 2

        profile = await db_session.get(Profile, user.id)
        assert profile is not None
        # PLAN §8: the cached balance must always equal the ledger sum.
        assert profile.coins_balance == await _ledger_sum(db_session, user.id)

    async def test_refuses_when_the_player_cannot_afford_it(self, db_session: AsyncSession) -> None:
        user = await _player(db_session, "broke@example.com", "Broke", coins=100)
        await change_username(db_session, user.id, "Broke2")  # free one

        with pytest.raises(InsufficientCoinsError):
            await change_username(db_session, user.id, "Broke3")

        profile = await db_session.get(Profile, user.id)
        assert profile is not None
        assert profile.username == "Broke2", "the name must not change"
        assert profile.coins_balance == 100, "and nothing may be debited"
        assert profile.username_changes == 1


@pytest.mark.asyncio
class TestRejections:
    async def test_taken_username_is_refused_and_costs_nothing(
        self, db_session: AsyncSession
    ) -> None:
        await _player(db_session, "holder@example.com", "TakenHandle")
        user = await _player(db_session, "taker@example.com", "Taker", coins=500)
        await change_username(db_session, user.id, "Taker2")  # burn the free one

        with pytest.raises(UsernameTakenError):
            await change_username(db_session, user.id, "TakenHandle")

        profile = await db_session.get(Profile, user.id)
        assert profile is not None
        # The whole point of doing the debit and the rename in one transaction.
        assert profile.coins_balance == 500, "never charged for a name you did not get"
        assert profile.username == "Taker2"

    async def test_your_own_name_is_not_a_change(self, db_session: AsyncSession) -> None:
        """Re-submitting the current handle must not burn the free change or 300 coins."""
        user = await _player(db_session, "same@example.com", "SameName", coins=500)
        with pytest.raises(SameUsernameError):
            await change_username(db_session, user.id, "SameName")
        with pytest.raises(SameUsernameError):
            await change_username(db_session, user.id, "samename")  # case-insensitive

        profile = await db_session.get(Profile, user.id)
        assert profile is not None
        assert profile.username_changes == 0
        assert profile.coins_balance == 500

    @pytest.mark.parametrize("bad", ["ab", "x" * 33, "has space", "emoji🎉", "dash-not-ok", ""])
    async def test_invalid_shapes_are_refused(self, db_session: AsyncSession, bad: str) -> None:
        user = await _player(db_session, f"bad{len(bad)}@example.com", f"Bad{len(bad)}")
        with pytest.raises(InvalidUsernameError):
            await change_username(db_session, user.id, bad)


@pytest.mark.asyncio
class TestApi:
    async def test_endpoints_quote_change_and_price(self, client) -> None:
        r = await client.post(
            "/auth/register",
            json={
                "email": "api@example.com",
                "username": "ApiUser",
                "password": "super-secret-pw",
            },
        )
        headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

        q = (await client.get("/me/username/quote", headers=headers)).json()
        assert q["cost"] == 0 and q["free_changes_remaining"] == 1

        r = await client.post("/me/username", json={"username": "ApiRenamed"}, headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["cost"] == 0
        assert (await client.get("/me", headers=headers)).json()["username"] == "ApiRenamed"

        # Second change is priced, and this account has no coins.
        r = await client.post("/me/username", json={"username": "ApiAgain"}, headers=headers)
        assert r.status_code == 402
        assert r.json()["detail"] == "insufficient_coins"  # a CODE, so the UI can translate it

    async def test_requires_auth(self, client) -> None:
        assert (await client.get("/me/username/quote")).status_code == 401
        assert (await client.post("/me/username", json={"username": "Nope"})).status_code == 401
