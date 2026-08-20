"""Gem ledger service (app.services.gem_ledger). The ledger is the source of truth; gems_balance
is a cache that must always equal SUM(delta). Adds idempotency (one-time grants) + a non-negative
balance guard the coin ledger lacks."""

from __future__ import annotations

import uuid

import pytest
from app.models import GemLedger, Profile, User
from app.services.gem_ledger import InsufficientGemsError, record_gem_delta
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


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
            select(func.coalesce(func.sum(GemLedger.delta), 0)).where(GemLedger.user_id == user_id)
        )
    ).scalar_one()


async def _row_count(session: AsyncSession, user_id: uuid.UUID) -> int:
    return (
        await session.execute(
            select(func.count()).select_from(GemLedger).where(GemLedger.user_id == user_id)
        )
    ).scalar_one()


async def test_grant_writes_row_and_updates_cache(db_session: AsyncSession):
    user = await _make_user(db_session)
    row = await record_gem_delta(db_session, user.id, 10, "duel_win")
    assert row.delta == 10
    assert row.reason == "duel_win"
    assert row.balance_after == 10
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.gems_balance == 10


async def test_balance_accumulates_and_invariant_holds(db_session: AsyncSession):
    user = await _make_user(db_session)
    await record_gem_delta(db_session, user.id, 10, "duel_win")
    await record_gem_delta(db_session, user.id, 5, "world_clear")
    last = await record_gem_delta(db_session, user.id, -3, "gem_purchase")
    assert last.balance_after == 12
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.gems_balance == 12
    assert profile.gems_balance == await _ledger_sum(db_session, user.id)


async def test_reference_fields_stored(db_session: AsyncSession):
    user = await _make_user(db_session)
    ref = uuid.uuid4()
    row = await record_gem_delta(
        db_session, user.id, 7, "duel_win", ref_type="duel", ref_id=ref, ref_key="world:Science"
    )
    assert row.ref_type == "duel"
    assert row.ref_id == ref
    assert row.ref_key == "world:Science"


async def test_idempotency_grants_once(db_session: AsyncSession):
    user = await _make_user(db_session)
    key = f"grant:{uuid.uuid4().hex}"
    first = await record_gem_delta(db_session, user.id, 25, "world_clear", idempotency_key=key)
    second = await record_gem_delta(db_session, user.id, 25, "world_clear", idempotency_key=key)
    # Same row returned; only ONE row written; balance reflects a single grant.
    assert first.id == second.id
    assert await _row_count(db_session, user.id) == 1
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.gems_balance == 25


async def test_insufficient_gems_raises_and_writes_nothing(db_session: AsyncSession):
    user = await _make_user(db_session)
    await record_gem_delta(db_session, user.id, 10, "duel_win")
    with pytest.raises(InsufficientGemsError):
        await record_gem_delta(db_session, user.id, -11, "gem_purchase")
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.gems_balance == 10
    assert await _row_count(db_session, user.id) == 1  # only the +10 grant persisted


async def test_debit_to_exactly_zero_succeeds(db_session: AsyncSession):
    user = await _make_user(db_session)
    await record_gem_delta(db_session, user.id, 10, "duel_win")
    row = await record_gem_delta(db_session, user.id, -10, "gem_purchase")
    assert row.balance_after == 0
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.gems_balance == 0


async def test_partial_unique_allows_null_keys_but_rejects_duplicate_key(db_session: AsyncSession):
    user = await _make_user(db_session)
    # Two un-keyed (NULL idempotency_key) grants both persist — the partial index ignores NULLs.
    await record_gem_delta(db_session, user.id, 1, "duel_win")
    await record_gem_delta(db_session, user.id, 1, "duel_win")
    assert await _row_count(db_session, user.id) == 2

    # The service is a no-op on a duplicate non-null key (returns the existing row, no new row).
    key = f"grant:{uuid.uuid4().hex}"
    await record_gem_delta(db_session, user.id, 5, "world_clear", idempotency_key=key)
    await record_gem_delta(db_session, user.id, 5, "world_clear", idempotency_key=key)
    assert await _row_count(db_session, user.id) == 3

    # At the DB level the partial unique index rejects a raw duplicate non-null key. Wrap in a
    # SAVEPOINT so the expected IntegrityError rolls back just the bad insert, not the test txn.
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(
                GemLedger(
                    user_id=user.id,
                    delta=5,
                    reason="world_clear",
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

    # Seed the "winner" row that already exists when our racing call reaches the insert.
    winner = await record_gem_delta(db_session, user.id, 25, "world_clear", idempotency_key=key)
    assert await _row_count(db_session, user.id) == 1
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.gems_balance == 25

    # Make _existing_by_key return None exactly once (the stale pre-check), then behave normally so
    # the post-IntegrityError re-query finds the winner. This drives execution past the pre-check
    # into begin_nested() → flush() → except IntegrityError → re-query → return existing.
    import app.services.gem_ledger as gem_ledger

    real_existing = gem_ledger._existing_by_key
    calls = {"n": 0}

    async def flaky_existing(session, idempotency_key):
        calls["n"] += 1
        if calls["n"] == 1:
            return None  # simulate the row not yet visible to the pre-check
        return await real_existing(session, idempotency_key)

    monkeypatch.setattr(gem_ledger, "_existing_by_key", flaky_existing)

    racing = await record_gem_delta(db_session, user.id, 25, "world_clear", idempotency_key=key)

    # The except branch ran: pre-check (None) + post-IntegrityError re-query == 2 calls.
    assert calls["n"] == 2
    # Returned the pre-existing winner, wrote no second row, balance unchanged.
    assert racing.id == winner.id
    assert await _row_count(db_session, user.id) == 1
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.gems_balance == 25
    assert profile.gems_balance == await _ledger_sum(db_session, user.id)
