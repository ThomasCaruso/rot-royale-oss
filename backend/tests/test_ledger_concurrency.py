"""C-2 regression: concurrent debits must not double-spend, and the cache must stay == SUM(delta).

These are the "two-session (two-engine) tests" the review called for. The normal `db_session`
fixture shares ONE connection inside a single rolled-back transaction, so it structurally cannot
observe a cross-transaction race — two 'sessions' on it see the same uncommitted state. These tests
therefore open their OWN engine and independent sessions against the test DB, COMMIT, and clean up
their own rows afterwards (nothing else may, since committed rows escape the fixture's rollback).

The bug: the ledgers took `session.get(Profile, id, with_for_update=True)`
but WITHOUT `populate_existing=True`. When the profile was already in the session's identity map
(the vault/username/duel spend paths load it first), the locked read returned the STALE pre-lock
column values, so `balance_after` was computed off a stale snapshot and two racing debits both
committed — the cache lost-updated and diverged from the ledger sum. Reproduced live (cache 0,
ledger_sum -300) before the fix.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from app.core.config import settings
from app.models import CoinLedger, GemLedger, Profile, User
from app.services.gem_ledger import InsufficientGemsError, record_gem_delta
from app.services.ledger import InsufficientCoinsError, record_coin_delta
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

pytestmark = pytest.mark.asyncio


async def _seed_user(Session: async_sessionmaker, coins: int, gems: int) -> uuid.UUID:
    async with Session() as s:
        user = User(email=f"conc-{uuid.uuid4().hex}@t.test", password_hash="x")
        s.add(user)
        await s.flush()
        s.add(
            Profile(
                user_id=user.id,
                username=f"c{uuid.uuid4().hex[:12]}",
                division="Bronze",
                coins_balance=0,
                gems_balance=0,
            )
        )
        await s.flush()
        # Fund THROUGH the ledger so the invariant holds going in (cache == SUM(delta)).
        if coins:
            await record_coin_delta(s, user.id, coins, "seed")
        if gems:
            await record_gem_delta(s, user.id, gems, "seed")
        await s.commit()
        return user.id


async def _cleanup(Session: async_sessionmaker, user_id: uuid.UUID) -> None:
    async with Session() as s:
        await s.execute(delete(CoinLedger).where(CoinLedger.user_id == user_id))
        await s.execute(delete(GemLedger).where(GemLedger.user_id == user_id))
        await s.execute(delete(Profile).where(Profile.user_id == user_id))
        await s.execute(delete(User).where(User.id == user_id))
        await s.commit()


async def _balances(Session: async_sessionmaker, user_id: uuid.UUID) -> tuple[int, int, int, int]:
    async with Session() as s:
        coin_cache = (
            await s.execute(select(Profile.coins_balance).where(Profile.user_id == user_id))
        ).scalar_one()
        gem_cache = (
            await s.execute(select(Profile.gems_balance).where(Profile.user_id == user_id))
        ).scalar_one()
        coin_sum = (
            await s.execute(
                select(func.coalesce(func.sum(CoinLedger.delta), 0)).where(
                    CoinLedger.user_id == user_id
                )
            )
        ).scalar_one()
        gem_sum = (
            await s.execute(
                select(func.coalesce(func.sum(GemLedger.delta), 0)).where(
                    GemLedger.user_id == user_id
                )
            )
        ).scalar_one()
        return coin_cache, coin_sum, gem_cache, gem_sum


async def test_concurrent_coin_debits_do_not_double_spend() -> None:
    engine = create_async_engine(settings.test_database_url)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    user_id = await _seed_user(Session, coins=150, gems=0)
    try:
        # Two racing debits of the full balance, each loading the profile FIRST (the vulnerable
        # pattern) then debiting. Exactly one may win; the other must be refused.
        async def buy() -> str:
            async with Session() as s:
                p = await s.get(Profile, user_id)  # into identity map before the ledger locks
                _ = p.coins_balance
                await barrier.wait()
                try:
                    await record_coin_delta(s, user_id, -150, "buy", ref_type="item")
                    await s.commit()
                    return "ok"
                except InsufficientCoinsError:
                    return "refused"

        barrier = asyncio.Barrier(2)
        outcomes = await asyncio.gather(buy(), buy())

        assert sorted(outcomes) == ["ok", "refused"], outcomes  # exactly one debit succeeded
        coin_cache, coin_sum, _, _ = await _balances(Session, user_id)
        assert coin_cache == 0, f"cache should be 0 after one debit, got {coin_cache}"
        assert coin_cache == coin_sum, f"invariant broken: cache {coin_cache} != ledger {coin_sum}"
    finally:
        await _cleanup(Session, user_id)
        await engine.dispose()


async def test_concurrent_gem_debits_do_not_go_negative() -> None:
    engine = create_async_engine(settings.test_database_url)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    user_id = await _seed_user(Session, coins=0, gems=3)
    try:

        async def spend() -> str:
            async with Session() as s:
                p = await s.get(Profile, user_id)
                _ = p.gems_balance
                await barrier.wait()
                try:
                    await record_gem_delta(s, user_id, -3, "duel_entry", ref_type="duel")
                    await s.commit()
                    return "ok"
                except InsufficientGemsError:
                    return "refused"

        barrier = asyncio.Barrier(2)
        outcomes = await asyncio.gather(spend(), spend())

        assert sorted(outcomes) == ["ok", "refused"], outcomes
        _, _, gem_cache, gem_sum = await _balances(Session, user_id)
        assert gem_cache == 0
        assert gem_cache == gem_sum, f"gem invariant broken: cache {gem_cache} != ledger {gem_sum}"
        assert gem_sum >= 0, "gem ledger sum went negative"
    finally:
        await _cleanup(Session, user_id)
        await engine.dispose()
