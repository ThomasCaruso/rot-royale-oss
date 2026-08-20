"""Unlock-source engine: the pure requirement grammar + the pending/ack earn-moment flow.

Two halves:
  1. `requirement_met` — pure, table-driven per verb (no DB).
  2. `pending_unlocks` / `acknowledge_unlocks` — the DB flow: earn → pending → reveal (ack) → owned,
     permanence under source regression, and exactly-once.
"""

from __future__ import annotations

import uuid

import pytest
from app.models import (
    DuelUserStats,
    Profile,
    User,
    UserCampaignProgress,
    UserCosmetic,
    UserTheme,
    UserUnlockAck,
)
from app.services.unlocks import (
    PlayerProgress,
    acknowledge_unlocks,
    pending_unlocks,
    requirement_met,
)
from app.services.vault import get_vault
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

# --- 1. pure grammar --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("req", "kw", "expected"),
    [
        (None, {}, True),
        # specific level
        ("level:Science:10", {"cleared_levels": frozenset({("Science", 10)})}, True),
        ("level:Science:10", {"cleared_levels": frozenset({("Science", 9)})}, False),
        ("level:Science:10", {}, False),
        # streak (>= boundary)
        ("streak:7", {"streak": 7}, True),
        ("streak:7", {"streak": 8}, True),
        ("streak:7", {"streak": 6}, False),
        # royales played (>= boundary) — Daylight is gated on royales:7
        ("royales:7", {"royales_played": 7}, True),
        ("royales:7", {"royales_played": 12}, True),
        ("royales:7", {"royales_played": 6}, False),
        ("royales:7", {}, False),
        # division (ordered >=)
        ("division:Gold", {"division": "Gold"}, True),
        ("division:Gold", {"division": "Apex"}, True),
        ("division:Gold", {"division": "Silver"}, False),
        ("division:Gold", {"division": "Bronze"}, False),
        # duel tier (ordered >=) + counts
        ("duel_tier:gold", {"duel_tier": "gold"}, True),
        ("duel_tier:gold", {"duel_tier": "crown"}, True),
        ("duel_tier:gold", {"duel_tier": "silver"}, False),
        ("duel_wins:5", {"duel_wins": 5}, True),
        ("duel_wins:5", {"duel_wins": 4}, False),
        ("duel_perfect:1", {"duel_perfect": 2}, True),
        ("duel_perfect:1", {"duel_perfect": 0}, False),
        # founder (registration order, 1-based; 0 = unknown → safely not met)
        ("founder:200", {"registration_rank": 1}, True),
        ("founder:200", {"registration_rank": 200}, True),
        ("founder:200", {"registration_rank": 201}, False),
        ("founder:200", {}, False),
        ("founder:abc", {"registration_rank": 1}, False),
        # safe defaults: unknown verb, unknown enum value, malformed int → never met
        ("nonsense:1", {}, False),
        ("division:Mythic", {"division": "Apex"}, False),
        ("streak:abc", {"streak": 999}, False),
    ],
)
def test_requirement_met_grammar(req, kw, expected):
    assert requirement_met(req, PlayerProgress(**kw)) is expected


# --- 2. DB flow -------------------------------------------------------------------------------


async def _user(session: AsyncSession, *, division: str = "Bronze", streak: int = 0) -> User:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(
        Profile(
            user_id=user.id,
            username=f"u{uuid.uuid4().hex[:10]}",
            division=division,
            rating=1000,
            streak_count=streak,
            equipped_theme="royale",
        )
    )
    session.add(UserTheme(user_id=user.id, theme_id="royale"))
    await session.flush()
    return user


def _pending_ids(items) -> set[str]:
    return {i.id for i in items}


@pytest.mark.asyncio
async def test_earned_free_theme_pends_then_grants_on_ack(db_session: AsyncSession):
    # division:Apex earns BOTH halves of the apex set (frame + theme). The catalog is fully live
    # (no coming-soon holds), so both pend; the grant mechanics are exercised on the frame half.
    user = await _user(db_session, division="Apex")
    assert "apex_frame" in _pending_ids(await pending_unlocks(db_session, user.id))
    assert "apex" in _pending_ids(await pending_unlocks(db_session, user.id))

    done = await acknowledge_unlocks(db_session, user.id, ["apex_frame"])
    assert "apex_frame" in [i.id for i in done]

    # No longer pending; an explicit ownership grant + an ack row exist.
    assert "apex_frame" not in _pending_ids(await pending_unlocks(db_session, user.id))
    assert await db_session.get(UserCosmetic, (user.id, "apex_frame")) is not None
    assert await db_session.get(UserUnlockAck, (user.id, "apex_frame")) is not None

    # Vault reports it owned + unlocked.
    items, _, _ = await get_vault(db_session, user.id)
    apex_frame = next(i for i in items if i.id == "apex_frame")
    assert apex_frame.owned and not apex_frame.locked


@pytest.mark.asyncio
async def test_paired_set_both_halves_pend_from_one_feat(db_session: AsyncSession):
    # Reaching Apex division earns the apex set — BOTH halves pend now that the whole catalog is
    # live (nothing held back as coming-soon).
    user = await _user(db_session, division="Apex")
    pend = _pending_ids(await pending_unlocks(db_session, user.id))
    assert "apex_frame" in pend
    assert "apex" in pend


@pytest.mark.asyncio
async def test_unlock_is_permanent_after_source_regresses(db_session: AsyncSession):
    # Earn the apex FRAME at Apex, then drop to Bronze — the grant + ack keep it owned and
    # unlocked.
    user = await _user(db_session, division="Apex")
    await acknowledge_unlocks(db_session, user.id, ["apex_frame"])

    profile = await db_session.get(Profile, user.id)
    profile.division = "Bronze"
    await db_session.flush()

    assert "apex_frame" not in _pending_ids(await pending_unlocks(db_session, user.id))
    items, _, _ = await get_vault(db_session, user.id)
    apex_frame = next(i for i in items if i.id == "apex_frame")
    assert apex_frame.owned and not apex_frame.locked


@pytest.mark.asyncio
async def test_ack_is_exactly_once(db_session: AsyncSession):
    user = await _user(db_session, division="Apex")
    first = await acknowledge_unlocks(db_session, user.id, ["apex_frame"])
    second = await acknowledge_unlocks(db_session, user.id, ["apex_frame"])
    assert "apex_frame" in [i.id for i in first]
    assert second == []  # already acked → nothing to do
    count = await db_session.scalar(
        select(func.count())
        .select_from(UserUnlockAck)
        .where(UserUnlockAck.user_id == user.id, UserUnlockAck.item_id == "apex_frame")
    )
    assert count == 1


@pytest.mark.asyncio
async def test_level_clear_unlocks_boss_frame(db_session: AsyncSession):
    user = await _user(db_session)
    db_session.add(
        UserCampaignProgress(
            user_id=user.id, world="Science", level_number=10, clear_status="clear", times_cleared=1
        )
    )
    await db_session.flush()
    assert "cosmic_boss_frame" in _pending_ids(await pending_unlocks(db_session, user.id))
    await acknowledge_unlocks(db_session, user.id, ["cosmic_boss_frame"])
    assert await db_session.get(UserCosmetic, (user.id, "cosmic_boss_frame")) is not None


@pytest.mark.asyncio
async def test_crown_duel_tier_unlocks_the_set(db_session: AsyncSession):
    # Crown duel tier earns both the standalone gold frame AND the crown set (theme + frame).
    user = await _user(db_session)
    db_session.add(DuelUserStats(user_id=user.id, duel_tier="crown"))
    await db_session.flush()
    pend = _pending_ids(await pending_unlocks(db_session, user.id))
    # The catalog is fully live, so the whole crown set pends: both frames AND the theme half.
    assert {"duelist_gold_frame", "crown_master_frame", "crown_arena"} <= pend


@pytest.mark.asyncio
async def test_nothing_progress_based_pending_for_cold_user(db_session: AsyncSession):
    """A cold user has earned NO progress-based unlock. The one exception is deliberate: in a
    fresh DB every account is within the first 200, so the Rot Champion founder exclusive
    (founder:200) is pending immediately — exactly the launch behavior. Daylight (royales:7) is
    NOT pending: a cold user has 0 completed Daily Royales."""
    user = await _user(db_session)
    pending = await pending_unlocks(db_session, user.id)
    assert [i.id for i in pending] == ["royale"]
    assert all(i.requirement == "founder:200" for i in pending)


@pytest.mark.asyncio
async def test_ack_empty_defaults_to_all_pending(db_session: AsyncSession):
    user = await _user(db_session, division="Apex")
    pend = _pending_ids(await pending_unlocks(db_session, user.id))
    assert "apex_frame" in pend
    done = await acknowledge_unlocks(db_session, user.id, list(pend))
    assert "apex_frame" in {i.id for i in done}
