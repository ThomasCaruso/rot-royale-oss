"""Coin ledger service (docs/architecture.md).

The single chokepoint for every coin movement. Appends an immutable ledger row and keeps the
profiles.coins_balance cache equal to SUM(delta). All coin changes — signup, payouts, purchases —
must go through here so the invariant holds and there is a complete audit trail.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CoinLedger, Profile


class InsufficientCoinsError(Exception):
    """A debit would drive coins_balance below zero. Nothing is written.

    A last-resort backstop, mirroring gem_ledger's guard. The spend paths (vault, username) still
    pre-check and raise their own domain errors for a clean 409; this only fires if a caller reached
    the ledger without pre-checking, in which case refusing the write beats minting a negative
    balance. See the CHECK(coins_balance >= 0) constraint that also enforces this at the DB.
    """


async def _existing_by_key(session: AsyncSession, idempotency_key: str) -> CoinLedger | None:
    # scalar_one_or_none() is safe here precisely because the partial unique index
    # (uq_coin_ledger_idempotency, WHERE idempotency_key IS NOT NULL) guarantees at most one row
    # per non-null key — so this query can never match more than one row.
    return (
        await session.execute(
            select(CoinLedger).where(CoinLedger.idempotency_key == idempotency_key)
        )
    ).scalar_one_or_none()


async def record_coin_delta(
    session: AsyncSession,
    user_id: uuid.UUID,
    delta: int,
    reason: str,
    *,
    ref_type: str | None = None,
    ref_id: uuid.UUID | None = None,
    ref_key: str | None = None,
    idempotency_key: str | None = None,
) -> CoinLedger:
    """Append a ledger row and update the cached balance. Caller's boundary commits.

    Returns the (possibly pre-existing) ledger row. Pass a stable `idempotency_key` for a one-time
    grant: a repeat call returns the existing row and writes nothing (DB-enforced by the partial
    unique index, race-safe via a SAVEPOINT around the insert).
    """
    # Idempotency: a one-time grant already recorded returns unchanged — no row, no balance change.
    if idempotency_key is not None:
        existing = await _existing_by_key(session, idempotency_key)
        if existing is not None:
            return existing

    # Lock the profile row AND refresh its columns under the lock. `populate_existing=True` is
    # load-bearing: without it, a profile already in this session's identity map (the vault/username
    # paths load it before spending) keeps its PRE-LOCK column values, so `balance_after` is
    # computed off a stale snapshot and two racing debits both "succeed" — the cache lost-updates
    # and diverges from SUM(delta). With it, the FOR UPDATE row's committed values overwrite the
    # stale copy, so the lock actually serializes the read-modify-write. (Verified live: without it
    # the locked get returns the stale balance; with it, the committed one.)
    profile = await session.get(Profile, user_id, with_for_update=True, populate_existing=True)
    if profile is None:
        raise ValueError(f"No profile for user {user_id}")

    balance_after = profile.coins_balance + delta
    if balance_after < 0:
        raise InsufficientCoinsError(
            f"User {user_id} has {profile.coins_balance} coins; delta {delta} would go negative"
        )
    row = CoinLedger(
        user_id=user_id,
        delta=delta,
        reason=reason,
        ref_type=ref_type,
        ref_id=ref_id,
        ref_key=ref_key,
        idempotency_key=idempotency_key,
        balance_after=balance_after,
    )
    try:
        # SAVEPOINT so a concurrent same-key insert (the pre-check above is TOCTOU) rolls back just
        # this row — without poisoning the outer transaction — and we return the winner's row.
        async with session.begin_nested():
            session.add(row)
            await session.flush()  # uq_coin_ledger_idempotency enforced here
    except IntegrityError:
        if idempotency_key is not None:
            existing = await _existing_by_key(session, idempotency_key)
            if existing is not None:
                return existing
        raise

    profile.coins_balance = balance_after
    return row
