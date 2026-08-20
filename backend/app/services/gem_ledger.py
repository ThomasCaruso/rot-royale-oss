"""Gem ledger service. The single chokepoint for every gem movement.

A parallel mirror of services/ledger.py (coins): appends an immutable gem_ledger row and keeps the
profiles.gems_balance cache equal to SUM(delta). Adds two guarantees the coin ledger lacks:

  - **Idempotency:** pass a stable `idempotency_key` for a one-time grant; a repeat call returns the
    existing row and writes nothing (DB-enforced by the partial unique index, race-safe via a
    SAVEPOINT around the insert).
  - **Non-negative balance:** a debit that would drive gems_balance below 0 raises
    InsufficientGemsError and writes nothing (gems are scarce — never go negative).

Services never commit — the request boundary commits once; tests roll back.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import GemLedger, Profile


class InsufficientGemsError(Exception):
    """A debit would drive gems_balance below zero. Nothing is written."""


async def _existing_by_key(session: AsyncSession, idempotency_key: str) -> GemLedger | None:
    # scalar_one_or_none() is safe here precisely because the partial unique index
    # (uq_gem_ledger_idempotency, WHERE idempotency_key IS NOT NULL) guarantees at most one row
    # per non-null key — so this query can never match more than one row.
    return (
        await session.execute(select(GemLedger).where(GemLedger.idempotency_key == idempotency_key))
    ).scalar_one_or_none()


async def record_gem_delta(
    session: AsyncSession,
    user_id: uuid.UUID,
    delta: int,
    reason: str,
    *,
    ref_type: str | None = None,
    ref_id: uuid.UUID | None = None,
    ref_key: str | None = None,
    idempotency_key: str | None = None,
) -> GemLedger:
    """Append a gem ledger row and update the cached balance. Caller's boundary commits.

    Returns the (possibly pre-existing) ledger row. Raises ValueError if the user has no profile,
    InsufficientGemsError if the resulting balance would be negative.
    """
    # Idempotency: a one-time grant already recorded returns unchanged — no row, no balance change.
    if idempotency_key is not None:
        existing = await _existing_by_key(session, idempotency_key)
        if existing is not None:
            return existing

    # Lock the profile row AND refresh its columns under the lock. `populate_existing=True` is
    # load-bearing — see the long note in services/ledger.py. Without it the InsufficientGemsError
    # guard below reads a stale gems_balance, so concurrent duel/vault spends both pass it and the
    # ledger sum goes negative even though the cache does not.
    profile = await session.get(Profile, user_id, with_for_update=True, populate_existing=True)
    if profile is None:
        raise ValueError(f"No profile for user {user_id}")

    balance_after = profile.gems_balance + delta
    if balance_after < 0:
        raise InsufficientGemsError(
            f"User {user_id} has {profile.gems_balance} gems; delta {delta} would go negative"
        )

    row = GemLedger(
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
            await session.flush()  # uq_gem_ledger_idempotency enforced here
    except IntegrityError:
        if idempotency_key is not None:
            existing = await _existing_by_key(session, idempotency_key)
            if existing is not None:
                return existing
        raise

    profile.gems_balance = balance_after
    return row
