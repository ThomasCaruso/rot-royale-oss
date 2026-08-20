"""Cognition schema (cognitive round types): the `cognition.*` tables persist, defaults land,
and the constraints that gameplay integrity leans on hold.

Pure schema tests in the style of test_duel_models.py — rows go in directly via the session; the
duplicate-insert assertions run inside begin_nested() SAVEPOINTs so the IntegrityError doesn't
poison the outer test transaction.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from app.models import (
    CognitionAttempt,
    CognitionEstimateItem,
    CognitionRoundInstance,
    CognitionRoundType,
    Profile,
    User,
)
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


async def _user(session: AsyncSession) -> User:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(Profile(user_id=user.id, username=f"u{uuid.uuid4().hex[:10]}", division="Bronze"))
    await session.flush()
    return user


async def _round_type(session: AsyncSession, key: str = "estimate") -> CognitionRoundType:
    rt = (
        await session.execute(select(CognitionRoundType).where(CognitionRoundType.key == key))
    ).scalar_one()
    return rt


async def _instance(
    session: AsyncSession, user: User, key: str = "estimate"
) -> CognitionRoundInstance:
    rt = await _round_type(session, key)
    inst = CognitionRoundInstance(round_type_id=rt.id, user_id=user.id, seed=12345)
    session.add(inst)
    await session.flush()
    return inst


@pytest.mark.asyncio
async def test_round_types_seeded(db_session: AsyncSession):
    """The migration seeds one registry row per cognitive round type, active by default."""
    rows = (await db_session.execute(select(CognitionRoundType))).scalars().all()
    keys = {r.key for r in rows}
    assert {"estimate", "change_detection"} <= keys
    # span/crowd were dropped pre-launch (migration e0f1a2b3c4d5) — they must not come back.
    assert not ({"span", "crowd"} & keys)
    for r in rows:
        assert r.active is True
        assert isinstance(r.config, dict)
        assert r.display_name


@pytest.mark.asyncio
async def test_round_type_key_unique(db_session: AsyncSession):
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(CognitionRoundType(key="estimate", display_name="dup", config={}))
            await db_session.flush()


@pytest.mark.asyncio
async def test_round_instance_and_attempts_persist(db_session: AsyncSession):
    user = await _user(db_session)
    inst = await _instance(db_session, user)
    await db_session.refresh(inst)

    assert inst.created_at is not None
    assert inst.completed_at is None
    assert inst.final_score is None

    for i in range(2):
        db_session.add(
            CognitionAttempt(
                round_instance_id=inst.id,
                attempt_index=i,
                payload={"digits": [1, 2, 3]},
                is_correct=True,
            )
        )
    await db_session.flush()

    attempts = (
        (
            await db_session.execute(
                select(CognitionAttempt).where(CognitionAttempt.round_instance_id == inst.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(attempts) == 2
    for a in attempts:
        assert a.points_awarded == 0  # server default
        assert a.created_at is not None

    # Duplicate (round_instance_id, attempt_index) is rejected — the DB backstop against a
    # double-submit racing the sequence guard (same shape as uq_round_result_entry_idx).
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(CognitionAttempt(round_instance_id=inst.id, attempt_index=0, payload={}))
            await db_session.flush()


@pytest.mark.asyncio
async def test_estimate_item_is_fermi_shaped(db_session: AsyncSession):
    """estimate_item carries Fermi-style content: component quantities, the arithmetic reveal,
    difficulty, and acceptable_pct (which replaced close_threshold_pct)."""
    item = CognitionEstimateItem(
        prompt="How many minutes of video are uploaded to YouTube while you brush your teeth?",
        answer=Decimal("1000"),
        unit="minutes",
        magnitude_band="thousands",
        components=[
            {"label": "upload rate", "value": 500, "unit": "min/min", "source_url": "https://s1"},
            {"label": "brushing time", "value": 2, "unit": "min", "source_url": "https://s2"},
        ],
        reveal_explanation="500 minutes uploaded per minute × 2 minutes brushing = 1,000 minutes.",
        intuition_note="Most people guess far too low.",
        difficulty="two_step",
        acceptable_pct=Decimal("30"),
        source_url="https://example.test",
        source_name="Example",
        stability="stable",
        category="internet",
    )
    db_session.add(item)
    await db_session.flush()
    await db_session.refresh(item)

    assert item.active is True  # server default
    assert item.answer == Decimal("1000")
    assert item.acceptable_pct == Decimal("30")
    assert len(item.components) == 2
    assert item.components[0]["label"] == "upload rate"
    assert "×" in item.reveal_explanation
    assert item.difficulty == "two_step"

    # intuition_note is optional.
    bare = CognitionEstimateItem(
        prompt="p",
        answer=Decimal("5"),
        components=[],
        reveal_explanation="e",
        difficulty="direct",
        acceptable_pct=Decimal("20"),
    )
    db_session.add(bare)
    await db_session.flush()
    assert bare.intuition_note is None


@pytest.mark.asyncio
async def test_round_instance_scoring_version(db_session: AsyncSession):
    """New cognition rounds are scoring version 2; anything that predates the column (or is
    inserted without one) stays version 1 via the DB default — so v1 and v2 scores can never be
    silently mixed on a shared leaderboard."""
    user = await _user(db_session)

    # DB-level default: a raw insert without the column lands as version 1.
    rt = await _round_type(db_session, "estimate")
    legacy_id = uuid.uuid4()
    await db_session.execute(
        CognitionRoundInstance.__table__.insert().values(
            id=legacy_id, round_type_id=rt.id, user_id=user.id, seed=1
        )
    )
    legacy = (
        await db_session.execute(
            select(CognitionRoundInstance).where(CognitionRoundInstance.id == legacy_id)
        )
    ).scalar_one()
    assert legacy.scoring_version == 1

    # The service creates version-2 instances (pinned properly in the estimate flow tests).
    inst = CognitionRoundInstance(round_type_id=rt.id, user_id=user.id, seed=2, scoring_version=2)
    db_session.add(inst)
    await db_session.flush()
    await db_session.refresh(inst)
    assert inst.scoring_version == 2


@pytest.mark.asyncio
async def test_instance_cascades_from_user(db_session: AsyncSession):
    """Deleting a user takes their cognition instances/attempts with them (ondelete CASCADE)."""
    user = await _user(db_session)
    inst = await _instance(db_session, user)
    db_session.add(CognitionAttempt(round_instance_id=inst.id, attempt_index=0, payload={}))
    await db_session.flush()

    # Core DELETE (not session.delete) so this exercises the DB's ondelete=CASCADE, not ORM
    # relationship cascade — the User↔Profile mapping has no ORM delete cascade configured.
    await db_session.execute(delete(User).where(User.id == user.id))

    left = (
        await db_session.execute(
            select(CognitionRoundInstance).where(CognitionRoundInstance.id == inst.id)
        )
    ).scalar_one_or_none()
    assert left is None
