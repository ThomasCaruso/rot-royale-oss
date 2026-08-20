"""Task 3.4a — Duel config + create service.

choose_rival_tier is a pure unit; duel_config / create_duel exercise the entry construction (a clone
of practice), the Gem-debit-on-entry path (idempotent, balance-guarded), tier unlocking, the per-day
bot gem-duel cap, and the answer-free client-spec contract.
"""

from __future__ import annotations

import uuid

import pytest
from app.core.constants import DUEL_BOT_GEM_CAP_PER_DAY, DUEL_TOTAL_ROUNDS
from app.models import DuelMatch, Entry, GemLedger, Profile, RoundAnswer, User
from app.models.contest import IN_PROGRESS
from app.models.duel import DuelUserStats
from app.services.duel import (
    DuelLockedError,
    UnknownDuelTypeError,
    choose_rival_tier,
    create_duel,
    duel_config,
)
from app.services.gem_ledger import InsufficientGemsError, record_gem_delta
from content.loader import load_trivia
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def _user(session: AsyncSession, *, gems: int = 0) -> uuid.UUID:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(Profile(user_id=user.id, username=f"u{uuid.uuid4().hex[:10]}", division="Bronze"))
    await session.flush()
    if gems:
        await record_gem_delta(session, user.id, gems, "test")
    return user.id


# ---------------- choose_rival_tier (pure) ----------------
def test_choose_rival_tier_base_by_type():
    assert choose_rival_tier("training", 0, 0) == "rookie"
    assert choose_rival_tier("spark", 0, 0) == "solid"
    assert choose_rival_tier("crown", 0, 0) == "sharp"
    assert choose_rival_tier("royal", 0, 0) == "elite"


def test_choose_rival_tier_strong_player_bumps_one_step():
    # wins=10 losses=2 → 12 games, winrate 0.83 > 0.6 → bump one step.
    assert choose_rival_tier("spark", 10, 2) == "sharp"
    # royal already at top → stays elite (capped at index 3).
    assert choose_rival_tier("royal", 10, 2) == "elite"


def test_choose_rival_tier_no_bump_when_thin_sample():
    # only 4 games (< 5) → no bump despite high winrate.
    assert choose_rival_tier("spark", 4, 0) == "solid"


# ---------------- duel_config ----------------
async def test_duel_config_fresh_user(db_session: AsyncSession):
    uid = await _user(db_session, gems=7)
    cfg = await duel_config(db_session, uid)

    by_type = {t.type: t for t in cfg.tiers}
    assert [t.type for t in cfg.tiers] == ["training", "spark", "crown", "royal"]
    assert by_type["training"].unlocked is True
    assert by_type["spark"].unlocked is True
    assert by_type["crown"].unlocked is False
    assert by_type["royal"].unlocked is False
    assert by_type["crown"].unlock_wins == 5
    assert by_type["royal"].unlock_wins == 25
    assert by_type["spark"].entry_gems == 1 and by_type["spark"].pool_gems == 2
    assert cfg.bot_gem_cap == DUEL_BOT_GEM_CAP_PER_DAY
    assert cfg.bot_gem_used == 0
    assert cfg.gems_balance == 7


async def test_duel_config_crown_unlocks_at_five_wins(db_session: AsyncSession):
    uid = await _user(db_session)
    stats = DuelUserStats(user_id=uid, wins=5)
    db_session.add(stats)
    await db_session.flush()

    cfg = await duel_config(db_session, uid)
    by_type = {t.type: t for t in cfg.tiers}
    assert by_type["crown"].unlocked is True
    assert by_type["royal"].unlocked is False


# ---------------- create_duel ----------------
async def test_create_training_no_gems(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session)

    res = await create_duel(db_session, uid, "training")
    match = res.match

    assert match.status == "in_progress"
    assert match.entry_gems == 0 and match.pool_gems == 0
    assert len(match.rival_run) == DUEL_TOTAL_ROUNDS

    entry = await db_session.get(Entry, match.entry_id)
    assert entry is not None
    assert entry.window_id is None
    assert entry.is_practice is True
    assert entry.status == IN_PROGRESS

    n_answers = await db_session.scalar(
        select(func.count()).select_from(RoundAnswer).where(RoundAnswer.entry_id == entry.id)
    )
    assert n_answers == DUEL_TOTAL_ROUNDS

    assert len(res.rounds) == DUEL_TOTAL_ROUNDS
    for rnd in res.rounds:
        assert set(rnd.keys()) == {"idx", "type", "client_spec"}
        assert "correctIndex" not in rnd["client_spec"]

    # no gem ledger row written for a free duel.
    n_ledger = await db_session.scalar(
        select(func.count()).select_from(GemLedger).where(GemLedger.user_id == uid)
    )
    assert n_ledger == 0


async def test_create_spark_debits_one_gem(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session, gems=5)

    res = await create_duel(db_session, uid, "spark")
    match = res.match
    assert match.entry_gems == 1 and match.pool_gems == 2

    profile = await db_session.get(Profile, uid)
    assert profile.gems_balance == 4

    row = (
        await db_session.execute(
            select(GemLedger).where(GemLedger.idempotency_key == f"duel:{match.id}:entry")
        )
    ).scalar_one()
    assert row.delta == -1
    assert row.reason == "duel_entry"


async def test_create_spark_insufficient_gems(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session, gems=0)

    with pytest.raises(InsufficientGemsError):
        await create_duel(db_session, uid, "spark")

    # nothing created/debited.
    n_matches = await db_session.scalar(
        select(func.count()).select_from(DuelMatch).where(DuelMatch.user_id == uid)
    )
    n_entries = await db_session.scalar(
        select(func.count()).select_from(Entry).where(Entry.user_id == uid)
    )
    n_ledger = await db_session.scalar(
        select(func.count()).select_from(GemLedger).where(GemLedger.user_id == uid)
    )
    assert n_matches == 0 and n_entries == 0 and n_ledger == 0


async def test_create_locked_tier(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session, gems=20)

    with pytest.raises(DuelLockedError) as ei:
        await create_duel(db_session, uid, "crown")
    assert ei.value.wins_needed == 5

    with pytest.raises(DuelLockedError) as ei2:
        await create_duel(db_session, uid, "royal")
    assert ei2.value.wins_needed == 25


async def test_bot_gem_duels_uncapped(db_session: AsyncSession):
    # Bot Gem duels are UNCAPPED — a player can enter as many per day as they can afford; the only
    # gate is the Gem balance. Entering more than the old per-day cap all succeed.
    await load_trivia(db_session)
    uid = await _user(db_session, gems=10)

    for _ in range(DUEL_BOT_GEM_CAP_PER_DAY + 2):
        res = await create_duel(db_session, uid, "spark")
        assert res.match.status == "in_progress"


async def test_create_strong_player_bumps_rival_tier(db_session: AsyncSession):
    # A strong record (10-2, winrate 0.83 > 0.6, >=5 games) bumps the rival one step:
    # spark base = solid → sharp. Covers stats→choose_rival_tier→match.bot_rival_tier end-to-end.
    await load_trivia(db_session)
    uid = await _user(db_session, gems=5)
    db_session.add(DuelUserStats(user_id=uid, wins=10, losses=2))
    await db_session.flush()

    res = await create_duel(db_session, uid, "spark")
    assert res.match.bot_rival_tier == "sharp"


async def test_unknown_type(db_session: AsyncSession):
    uid = await _user(db_session)
    with pytest.raises(UnknownDuelTypeError):
        await create_duel(db_session, uid, "mega")
