"""Coin ledger service (app.services.ledger). The ledger is the source of truth; coins_balance
is a cache that must always equal SUM(delta)."""

from __future__ import annotations

import uuid

import pytest
from app.models import CoinLedger, Profile, User
from app.services.ledger import record_coin_delta
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


async def _row_count(session: AsyncSession, user_id: uuid.UUID) -> int:
    return (
        await session.execute(
            select(func.count()).select_from(CoinLedger).where(CoinLedger.user_id == user_id)
        )
    ).scalar_one()


async def _make_user(session: AsyncSession) -> User:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(Profile(user_id=user.id, username=f"u{uuid.uuid4().hex[:10]}", division="Bronze"))
    await session.flush()
    return user


async def _ledger_sum(session: AsyncSession, user_id: uuid.UUID) -> int:
    return (
        await session.execute(
            select(func.coalesce(func.sum(CoinLedger.delta), 0)).where(
                CoinLedger.user_id == user_id
            )
        )
    ).scalar_one()


async def test_record_writes_row_and_updates_cache(db_session: AsyncSession):
    user = await _make_user(db_session)
    row = await record_coin_delta(db_session, user.id, 100, "signup_bonus")
    assert row.delta == 100
    assert row.reason == "signup_bonus"
    assert row.balance_after == 100
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.coins_balance == 100


async def test_balance_accumulates_and_invariant_holds(db_session: AsyncSession):
    user = await _make_user(db_session)
    await record_coin_delta(db_session, user.id, 100, "contest_payout")
    last = await record_coin_delta(db_session, user.id, -30, "theme_purchase")
    profile = await db_session.get(Profile, user.id)
    assert profile is not None
    assert profile.coins_balance == 70
    assert last.balance_after == 70
    assert profile.coins_balance == await _ledger_sum(db_session, user.id)


async def test_reference_is_stored(db_session: AsyncSession):
    user = await _make_user(db_session)
    ref = uuid.uuid4()
    row = await record_coin_delta(
        db_session, user.id, 50, "contest_payout", ref_type="window", ref_id=ref
    )
    assert row.ref_type == "window"
    assert row.ref_id == ref


async def test_ref_key_stores_string_references(db_session: AsyncSession):
    user = await _make_user(db_session)
    # Seed a balance first: the ledger now refuses a debit that would drive coins_balance below 0
    # (parity with the gem ledger). This test is about ref_key storage, not the guard, so fund it.
    await record_coin_delta(db_session, user.id, 150, "test_seed")
    row = await record_coin_delta(
        db_session, user.id, -150, "theme_purchase", ref_type="theme", ref_key="midnight"
    )
    assert row.ref_key == "midnight"
    assert row.ref_id is None


async def test_partial_unique_allows_null_keys_but_rejects_duplicate_key(db_session: AsyncSession):
    user = await _make_user(db_session)
    # Two un-keyed (NULL idempotency_key) grants both persist — the partial index ignores NULLs.
    await record_coin_delta(db_session, user.id, 1, "contest_payout")
    await record_coin_delta(db_session, user.id, 1, "contest_payout")
    assert await _row_count(db_session, user.id) == 2

    # The service is a no-op on a duplicate non-null key (returns the existing row, no new row).
    key = f"grant:{uuid.uuid4().hex}"
    first = await record_coin_delta(db_session, user.id, 5, "streak_milestone", idempotency_key=key)
    again = await record_coin_delta(db_session, user.id, 5, "streak_milestone", idempotency_key=key)
    assert first.id == again.id
    assert await _row_count(db_session, user.id) == 3
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.coins_balance == 7  # 1 + 1 + 5, not 12
    assert profile.coins_balance == await _ledger_sum(db_session, user.id)

    # At the DB level the partial unique index rejects a raw duplicate non-null key. Wrap in a
    # SAVEPOINT so the expected IntegrityError rolls back just the bad insert, not the test txn.
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(
                CoinLedger(
                    user_id=user.id,
                    delta=5,
                    reason="streak_milestone",
                    idempotency_key=key,
                    balance_after=999,
                )
            )
            await db_session.flush()


async def test_idempotency_race_hits_integrityerror_recovery(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    """Force the TOCTOU branch: simulate the pre-check missing an existing row (the race window),
    so the service proceeds to the insert, hits the partial-unique IntegrityError, and recovers by
    re-querying — returning the winner's row and writing no second row."""
    user = await _make_user(db_session)
    key = f"grant:{uuid.uuid4().hex}"

    winner = await record_coin_delta(
        db_session, user.id, 25, "streak_milestone", idempotency_key=key
    )
    assert await _row_count(db_session, user.id) == 1

    import app.services.ledger as ledger

    real_existing = ledger._existing_by_key
    calls = {"n": 0}

    async def flaky_existing(session, idempotency_key):
        calls["n"] += 1
        if calls["n"] == 1:
            return None  # simulate the row not yet visible to the pre-check
        return await real_existing(session, idempotency_key)

    monkeypatch.setattr(ledger, "_existing_by_key", flaky_existing)

    racing = await record_coin_delta(
        db_session, user.id, 25, "streak_milestone", idempotency_key=key
    )

    # The except branch ran: pre-check (None) + post-IntegrityError re-query == 2 calls.
    assert calls["n"] == 2
    assert racing.id == winner.id
    assert await _row_count(db_session, user.id) == 1
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.coins_balance == 25
    assert profile.coins_balance == await _ledger_sum(db_session, user.id)
