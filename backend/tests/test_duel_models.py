"""Duel data model (Task 3.1): the three duel tables persist, server-defaults land, and the two
unique constraints (one Duel per Entry; one row per (match, round_index)) hold.

These are pure schema tests — they insert rows directly via the session (no services/endpoints exist
yet) and assert the DB-side defaults and constraints. Duplicate-insert assertions run inside a
begin_nested() SAVEPOINT so the IntegrityError doesn't poison the outer test transaction.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from app.models import DuelMatch, DuelRound, DuelUserStats, Entry, Profile, User
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


async def _user(session: AsyncSession) -> User:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(Profile(user_id=user.id, username=f"u{uuid.uuid4().hex[:10]}", division="Bronze"))
    await session.flush()
    return user


async def _entry(session: AsyncSession, user: User) -> Entry:
    """A window-less practice-style Entry to back a Duel (the Duel's human play reuses Entry)."""
    e = Entry(
        window_id=None,
        user_id=user.id,
        is_practice=True,
        seed=42,
        round_set=[],
        started_at=datetime.now(UTC),
        status="IN_PROGRESS",
    )
    session.add(e)
    await session.flush()
    return e


def _match(user: User, entry: Entry, **overrides) -> DuelMatch:
    kwargs = dict(
        user_id=user.id,
        entry_id=entry.id,
        duel_type="training",
        seed=12345,
        rival_run=[],
        contest_date=date(2026, 6, 11),
    )
    kwargs.update(overrides)
    return DuelMatch(**kwargs)


@pytest.mark.asyncio
async def test_duel_match_persists_with_server_defaults(db_session: AsyncSession):
    user = await _user(db_session)
    entry = await _entry(db_session, user)

    m = _match(user, entry)
    db_session.add(m)
    await db_session.flush()
    await db_session.refresh(m)

    got = await db_session.get(DuelMatch, m.id)
    assert got is not None
    assert got.status == "created"
    assert got.rival_type == "bot"
    assert got.user_round_wins == 0
    assert got.rival_round_wins == 0
    assert got.gem_delta == 0
    assert got.entry_gems == 0
    assert got.pool_gems == 0
    assert got.xp_awarded == 0
    assert got.created_at is not None
    assert got.updated_at is not None


@pytest.mark.asyncio
async def test_duel_rounds_persist_and_unique_on_match_index(db_session: AsyncSession):
    user = await _user(db_session)
    entry = await _entry(db_session, user)
    m = _match(user, entry)
    db_session.add(m)
    await db_session.flush()

    for i in range(2):
        db_session.add(
            DuelRound(
                match_id=m.id,
                round_index=i,
                phase="normal",
                user_answer=1,
                user_correct=True,
                user_time_ms=1500,
                rival_correct=False,
                rival_time_ms=2000,
                outcome="user_win",
                outcome_reason="correct_vs_wrong",
            )
        )
    await db_session.flush()

    rounds = (
        await db_session.execute(DuelRound.__table__.select().where(DuelRound.match_id == m.id))
    ).all()
    assert len(rounds) == 2

    # Duplicate (match_id, round_index) is rejected by uq_duel_round_match_index.
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(
                DuelRound(
                    match_id=m.id,
                    round_index=0,  # dup
                    phase="normal",
                    user_correct=False,
                    user_time_ms=0,
                    rival_correct=False,
                    rival_time_ms=0,
                    outcome="no_point",
                    outcome_reason="both_wrong",
                )
            )
            await db_session.flush()


@pytest.mark.asyncio
async def test_duel_match_entry_is_unique(db_session: AsyncSession):
    user = await _user(db_session)
    entry = await _entry(db_session, user)

    db_session.add(_match(user, entry))
    await db_session.flush()

    # A second DuelMatch on the SAME entry_id violates uq_duel_match_entry.
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(_match(user, entry, seed=999))
            await db_session.flush()


@pytest.mark.asyncio
async def test_duel_user_stats_defaults(db_session: AsyncSession):
    user = await _user(db_session)

    db_session.add(DuelUserStats(user_id=user.id))
    await db_session.flush()

    s = await db_session.get(DuelUserStats, user.id)
    assert s is not None
    assert s.duel_tier == "bronze"
    assert s.wins == 0
    assert s.losses == 0
    assert s.training_wins == 0
    assert s.training_losses == 0
    assert s.current_streak == 0
    assert s.best_streak == 0
    assert s.perfect_wins == 0
    assert s.comeback_wins == 0
    assert s.total_gems_won == 0
    assert s.total_gems_lost == 0
    assert s.duel_xp == 0
    assert s.updated_at is not None
