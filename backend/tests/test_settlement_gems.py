"""Daily Royale gem grants at settlement (Task 2A): one-time starter + highest-tier placement.

Gems are granted ONLY for the `royale` slot (the Daily Royale). Legacy/non-royale windows pay zero
gems and write zero gem-ledger rows. Coins remain 0 throughout (ranked is coin-free).
"""

from __future__ import annotations

import uuid
from datetime import date

from app.models import CoinLedger, GemLedger, Profile, Standing
from app.models.contest import SETTLED
from app.services.settlement import gems_for_place, settle_window
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

# Reuse the existing settlement test helpers.
from tests.test_settlement import (
    _closed_royale_window,
    _closed_window,
    _entry,
    _user,
)


# ---------------- pure gems_for_place ----------------
def test_gems_for_place_tiers():
    assert gems_for_place(1, 100) == (12, "dr_crown")
    assert gems_for_place(2, 100) == (7, "dr_top_3")
    assert gems_for_place(3, 100) == (7, "dr_top_3")
    assert gems_for_place(10, 100) == (4, "dr_top_10pct")
    assert gems_for_place(25, 100) == (2, "dr_top_25pct")
    assert gems_for_place(50, 100) == (1, "dr_top_50pct")
    assert gems_for_place(51, 100) is None


def test_gems_for_place_small_bot_padded_field():
    # field_size=8 is a real 8-entrant field — the tier maths, not the (removed) bot padding.
    # Pin every place 1-8 so a future fraction/constant tweak can't silently re-slice the field.
    # ceil(8*0.10)=1 and ceil(8*0.25)=2 are shadowed by crown/top_3; ceil(8*0.50)=4 sets the floor.
    assert gems_for_place(1, 8) == (12, "dr_crown")
    assert gems_for_place(2, 8) == (7, "dr_top_3")
    assert gems_for_place(3, 8) == (7, "dr_top_3")
    assert gems_for_place(4, 8) == (1, "dr_top_50pct")
    for place in (5, 6, 7, 8):
        assert gems_for_place(place, 8) is None
    # 1st place returns ONLY the crown tier — never crown + top_3 + ... (tiers never stack).
    assert gems_for_place(1, 8) == (12, "dr_crown")


# ---------------- DB helpers ----------------
async def _gem_rows(session: AsyncSession, user_id: uuid.UUID, *, reason: str | None = None):
    q = select(GemLedger).where(GemLedger.user_id == user_id)
    if reason is not None:
        q = q.where(GemLedger.reason == reason)
    return list((await session.execute(q)).scalars().all())


async def _gem_balance(session: AsyncSession, user_id: uuid.UUID) -> int:
    return (
        await session.execute(
            select(func.coalesce(func.sum(GemLedger.delta), 0)).where(GemLedger.user_id == user_id)
        )
    ).scalar_one()


# ---------------- starter: once per user ever ----------------
async def test_starter_gem_granted_once_across_windows(db_session: AsyncSession):
    u = await _user(db_session, "starter")
    # Two royale windows on different ET dates; the same user enters & settles both.
    w1 = await _closed_royale_window(db_session, date(2025, 7, 10))
    await _entry(db_session, w1, u, 1500)
    await settle_window(db_session, w1.id)

    w2 = await _closed_royale_window(db_session, date(2025, 7, 11))
    await _entry(db_session, w2, u, 1500)
    await settle_window(db_session, w2.id)

    starter_rows = await _gem_rows(db_session, u.id, reason="starter_daily_royale")
    assert len(starter_rows) == 1  # exactly one starter grant ever (idempotency key)
    assert starter_rows[0].delta == 5
    assert starter_rows[0].idempotency_key == f"starter:{u.id}"


# ---------------- placement grant + standing ----------------
async def test_placement_gem_grant_and_standing(db_session: AsyncSession):
    w = await _closed_royale_window(db_session, date(2025, 7, 10))
    bots = await _winning_entry(db_session, w)
    u = bots
    await settle_window(db_session, w.id)

    s = await db_session.get(Standing, (w.id, u.id))
    assert s is not None
    assert s.place == 1  # strong entry tops the bot field
    assert s.gems_awarded == 12  # crown tier on the standing

    placement = await _gem_rows(db_session, u.id, reason="daily_royale_placement")
    assert len(placement) == 1
    row = placement[0]
    assert row.delta == 12
    assert row.ref_key == "dr_crown"
    assert row.ref_type == "window"
    assert row.ref_id == w.id
    assert row.idempotency_key == f"dr:{w.id}:{u.id}"

    # Balance cache == sum of all the user's gem rows (starter 5 + placement 12 = 17).
    profile = await db_session.get(Profile, u.id)
    assert profile is not None
    assert profile.gems_balance == await _gem_balance(db_session, u.id) == 17


async def _winning_entry(db_session: AsyncSession, w):
    """A user who places 1st. The field is real entries only, so a single entrant IS 1st."""
    u = await _user(db_session, "crown")
    await _entry(db_session, w, u, 900)
    return u


# ---------------- highest tier only ----------------
async def test_first_place_gets_only_crown(db_session: AsyncSession):
    w = await _closed_royale_window(db_session, date(2025, 7, 10))
    u = await _winning_entry(db_session, w)
    await settle_window(db_session, w.id)

    placement = await _gem_rows(db_session, u.id, reason="daily_royale_placement")
    assert len(placement) == 1
    assert placement[0].delta == 12  # exactly 12, not 12+7+...
    s = await db_session.get(Standing, (w.id, u.id))
    assert s is not None and s.gems_awarded == 12


# ---------------- None boundary: real user outside all tiers gets 0 placement gems ----------------
async def test_no_placement_gem_when_outside_all_tiers(db_session: AsyncSession):
    """A real user who finishes OUTSIDE every gem tier gets gems_awarded == 0 and NO
    daily_royale_placement ledger row — but still receives the one-time +5 starter row."""
    w = await _closed_royale_window(db_session, date(2025, 7, 10))
    # The field is real entries only now, so the "outside every tier" case needs REAL rivals: eight
    # entrants, and our subject scores lowest. For a field of 8 the top-50% tier reaches place 4, so
    # 8th is comfortably outside every tier.
    for i in range(7):
        await _entry(db_session, w, await _user(db_session, f"rival{i}"), 500 + i)
    u = await _user(db_session, "outsider")
    await _entry(db_session, w, u, 0)
    await settle_window(db_session, w.id)

    s = await db_session.get(Standing, (w.id, u.id))
    assert s is not None
    assert s.field_size == 8  # eight REAL entrants
    # Robust, not brittle to exact placement: assert the place is in the None range for fs=8 AND
    # that gems_for_place agrees there's no tier there.
    assert s.place >= 5
    assert gems_for_place(s.place, s.field_size) is None
    assert s.gems_awarded == 0

    # No placement gem ledger row...
    assert await _gem_rows(db_session, u.id, reason="daily_royale_placement") == []
    # ...but the one-time starter row is still granted (+5).
    starter = await _gem_rows(db_session, u.id, reason="starter_daily_royale")
    assert len(starter) == 1 and starter[0].delta == 5
    # Balance cache == ledger sum == just the starter (5).
    profile = await db_session.get(Profile, u.id)
    assert profile is not None
    assert profile.gems_balance == await _gem_balance(db_session, u.id) == 5


# ---------------- re-settle is idempotent on gems ----------------
async def test_resettle_does_not_double_grant_gems(db_session: AsyncSession):
    w = await _closed_royale_window(db_session, date(2025, 7, 10))
    u = await _winning_entry(db_session, w)
    assert await settle_window(db_session, w.id) is True
    # Window is SETTLED now, so a second settle is a no-op — but even if it ran, the gem ledger
    # idempotency keys would prevent double grants. Assert the grants are single.
    assert await settle_window(db_session, w.id) is False
    assert len(await _gem_rows(db_session, u.id, reason="starter_daily_royale")) == 1
    assert len(await _gem_rows(db_session, u.id, reason="daily_royale_placement")) == 1


# ---------------- legacy / non-royale: no gems ----------------
async def test_legacy_window_grants_no_gems(db_session: AsyncSession):
    w = await _closed_window(db_session)  # midday (legacy) window
    u = await _user(db_session, "legacy")
    await _entry(db_session, w, u, 700)

    await settle_window(db_session, w.id)
    await db_session.refresh(w)
    assert w.state == SETTLED

    # No gem-ledger rows at all, and the standing records 0 gems.
    assert await _gem_rows(db_session, u.id) == []
    s = await db_session.get(Standing, (w.id, u.id))
    assert s is not None and s.gems_awarded == 0
    profile = await db_session.get(Profile, u.id)
    assert profile is not None and profile.gems_balance == 0


# ---------------- coins remain 0 on a royale settle ----------------
async def test_royale_settle_still_pays_no_coins(db_session: AsyncSession):
    w = await _closed_royale_window(db_session, date(2025, 7, 10))
    u = await _winning_entry(db_session, w)
    await settle_window(db_session, w.id)

    coin_rows = (
        await db_session.execute(select(func.count()).select_from(CoinLedger))
    ).scalar_one()
    assert coin_rows == 0
    profile = await db_session.get(Profile, u.id)
    assert profile is not None and profile.coins_balance == 0
    s = await db_session.get(Standing, (w.id, u.id))
    assert s is not None and s.coins_awarded == 0
