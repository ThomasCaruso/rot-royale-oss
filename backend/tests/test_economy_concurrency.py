"""Adversarial concurrency against every path that moves money or grants a reward (Audit 2B §2).

These tests deliberately do NOT use the `db_session` fixture. That fixture wraps a test in a single
connection and rolls it back, which SERIALISES everything — a race test on it proves nothing because
the two "concurrent" callers are the same transaction. Each test here opens independent engines and
COMMITS, which is the only way a unique constraint, a row lock or an idempotency key is actually
exercised. Rows are cleaned up explicitly afterwards.

The invariants under test:

    one logical action   -> at most one reward
    one purchase         -> exactly one debit
    one Daily attempt    -> no duplicate entry
    replayed request     -> no additional economic effect
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.core.config import settings
from app.models import ContestWindow, Entry, Profile, User
from app.models.contest import IN_PROGRESS, OPEN
from app.models.gem_ledger import GemLedger
from app.models.ledger import CoinLedger
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

pytestmark = pytest.mark.anyio


@pytest.fixture
async def scratch():
    """Tracks rows these tests COMMIT and removes them in teardown.

    Teardown, not a trailing call: an assertion failure would skip an inline cleanup and leave
    committed rows behind — which is exactly how a first run of this file poisoned
    uq_window_date_slot for every other test in the suite.
    """
    created: dict[str, list] = {"users": [], "windows": []}
    try:
        yield created
    finally:
        for uid in created["users"]:
            await _cleanup(uid)
        for wid in created["windows"]:
            engine, s = await _fresh_session()
            try:
                await s.execute(delete(Entry).where(Entry.window_id == wid))
                await s.execute(delete(ContestWindow).where(ContestWindow.id == wid))
                await s.commit()
            finally:
                await s.close()
                await engine.dispose()


async def _fresh_session():
    """An engine+session with its own connection, so two of them really do race."""
    engine = create_async_engine(settings.test_database_url)
    return engine, AsyncSession(bind=engine, expire_on_commit=False)


async def _make_user(coins: int = 10_000, gems: int = 500) -> uuid.UUID:
    engine, s = await _fresh_session()
    try:
        from app.services.registration import register_guest

        user = await register_guest(s)
        prof = await s.get(Profile, user.id)
        prof.coins_balance, prof.gems_balance = coins, gems
        await s.commit()
        return user.id
    finally:
        await s.close()
        await engine.dispose()


async def _cleanup(user_id: uuid.UUID, window_id: uuid.UUID | None = None) -> None:
    engine, s = await _fresh_session()
    try:
        await s.execute(delete(Entry).where(Entry.user_id == user_id))
        if window_id:
            await s.execute(delete(ContestWindow).where(ContestWindow.id == window_id))
        await s.execute(delete(CoinLedger).where(CoinLedger.user_id == user_id))
        await s.execute(delete(GemLedger).where(GemLedger.user_id == user_id))
        from app.models.cosmetic import UserCosmetic
        from app.models.theme import UserTheme

        await s.execute(delete(UserCosmetic).where(UserCosmetic.user_id == user_id))
        await s.execute(delete(UserTheme).where(UserTheme.user_id == user_id))
        await s.execute(delete(Profile).where(Profile.user_id == user_id))
        await s.execute(delete(User).where(User.id == user_id))
        await s.commit()
    finally:
        await s.close()
        await engine.dispose()


async def _run_racing(fn, n: int = 2):
    """Run `fn(session)` n times, each on its own connection, truly concurrently."""
    pairs = [await _fresh_session() for _ in range(n)]

    async def one(engine, session):
        try:
            r = await fn(session)
            await session.commit()
            return ("ok", r)
        except Exception as exc:  # noqa: BLE001 - the exception IS the result under test
            await session.rollback()
            return ("err", type(exc).__name__)
        finally:
            await session.close()
            await engine.dispose()

    return await asyncio.gather(*(one(e, s) for e, s in pairs))


# ---------------------------------------------------------------- Daily Royale attempt


async def test_concurrent_entry_creates_exactly_one_attempt(scratch):
    """The Daily Royale is one attempt per player. Two simultaneous /enter calls must not both
    land — that would be two scored runs at the same crown."""
    user_id = await _make_user()
    scratch["users"].append(user_id)
    engine, s = await _fresh_session()
    now = datetime.now(UTC)
    # A far-future date: these tests COMMIT, and uq_window_date_slot means today's royale window may
    # already exist (created by another committing test, or by the scheduler).
    win_date = (now + timedelta(days=3650)).date()
    win = ContestWindow(
        contest_date=win_date,
        slot="royale",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=OPEN,
        template_id="dr_8_trivia",
    )
    s.add(win)
    await s.commit()
    wid = win.id
    scratch["windows"].append(wid)
    await s.close()
    await engine.dispose()

    def make(session: AsyncSession):
        session.add(
            Entry(
                window_id=wid,
                user_id=user_id,
                seed=1,
                round_set=[],
                started_at=datetime.now(UTC),
                status=IN_PROGRESS,
            )
        )
        return session.flush()

    results = await _run_racing(lambda sess: make(sess))

    engine, s = await _fresh_session()
    try:
        n = await s.scalar(
            select(func.count())
            .select_from(Entry)
            .where(Entry.window_id == wid, Entry.user_id == user_id)
        )
    finally:
        await s.close()
        await engine.dispose()

    assert n == 1, f"uq_entry_window_user did not hold: {n} entries, results={results}"
    assert sum(1 for r in results if r[0] == "ok") == 1


# ---------------------------------------------------------------- purchases


async def test_concurrent_purchase_debits_exactly_once(scratch):
    """Two simultaneous buys of the same item must produce one debit and one ownership row —
    otherwise a double-tap (or a scripted pair of requests) buys one item for one price twice, or
    worse, grants the item while debiting once."""
    from app.services.vault import buy_item, get_vault

    user_id = await _make_user(coins=10_000)
    scratch["users"].append(user_id)
    engine, s = await _fresh_session()
    try:
        items, _, _ = await get_vault(s, user_id)
        buyable = next(
            (
                i
                for i in items
                if i.cost > 0 and not i.owned and i.currency != "gems" and not i.locked
            ),
            None,
        )
    finally:
        await s.close()
        await engine.dispose()
    if buyable is None:
        await _cleanup(user_id)
        pytest.skip("no coin-priced unlocked item available in the catalog to race")

    results = await _run_racing(lambda sess: buy_item(sess, user_id, buyable.id))

    engine, s = await _fresh_session()
    try:
        debits = (
            (
                await s.execute(
                    select(CoinLedger).where(CoinLedger.user_id == user_id, CoinLedger.delta < 0)
                )
            )
            .scalars()
            .all()
        )
        prof = await s.get(Profile, user_id)
        balance = int(prof.coins_balance)
    finally:
        await s.close()
        await engine.dispose()

    assert sum(1 for r in results if r[0] == "ok") == 1, results
    assert len(debits) == 1, f"expected exactly one debit, got {len(debits)}"
    assert balance == 10_000 - buyable.cost, "balance does not match a single debit"


# ---------------------------------------------------------------- idempotent grants


async def test_concurrent_idempotent_grant_pays_once(scratch):
    """The goodwill/reward path keys on an idempotency key. Racing it must not double-credit —
    this is the guarantee that lets an interrupted payout job simply be re-run."""
    from app.services.ledger import record_coin_delta

    user_id = await _make_user(coins=0)
    scratch["users"].append(user_id)
    key = f"race-test:{uuid.uuid4()}"

    results = await _run_racing(
        lambda sess: record_coin_delta(sess, user_id, 50, "goodwill_outage", idempotency_key=key),
        n=4,
    )

    engine, s = await _fresh_session()
    try:
        rows = (
            (await s.execute(select(CoinLedger).where(CoinLedger.idempotency_key == key)))
            .scalars()
            .all()
        )
        prof = await s.get(Profile, user_id)
        balance = int(prof.coins_balance)
    finally:
        await s.close()
        await engine.dispose()

    assert len(rows) == 1, f"idempotency key produced {len(rows)} ledger rows"
    assert balance == 50, f"balance {balance} != 50 — the grant was applied more than once"
    assert sum(1 for r in results if r[0] == "ok") >= 1, results
