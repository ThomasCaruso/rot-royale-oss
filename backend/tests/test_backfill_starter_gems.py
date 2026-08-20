"""backfill_starter_gems: retroactive one-time +5 starter Gem for players who completed a Daily
Royale before Gems launched. Idempotent — re-running grants 0. See app/jobs/tasks.py."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from app.core.constants import GEM_STARTER_DAILY_ROYALE
from app.jobs.tasks import backfill_starter_gems
from app.models import ContestWindow, Entry, Profile, User
from app.models.contest import CLOSED, SUBMITTED
from app.services.gem_ledger import record_gem_delta
from sqlalchemy.ext.asyncio import AsyncSession


# ---------------- DB helpers (mirrors tests/test_settlement.py) ----------------
async def _user(session: AsyncSession, name: str) -> User:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(Profile(user_id=user.id, username=f"u{uuid.uuid4().hex[:10]}", division="Bronze"))
    await session.flush()
    return user


async def _royale_window(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    w = ContestWindow(
        contest_date=date(2025, 7, 10),
        slot="royale",
        open_at=now - timedelta(hours=12),
        close_at=now - timedelta(hours=1),
        state=CLOSED,
        template_id="dr_20_trivia",
    )
    session.add(w)
    await session.flush()
    return w


async def _legacy_window(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    w = ContestWindow(
        contest_date=date(2025, 7, 10),
        slot="midday",
        open_at=now - timedelta(hours=6),
        close_at=now - timedelta(hours=1),
        state=CLOSED,
        template_id="m4_midday",
    )
    session.add(w)
    await session.flush()
    return w


async def _entry(
    session: AsyncSession, w: ContestWindow | None, u: User, *, status: str = SUBMITTED
) -> Entry:
    e = Entry(
        window_id=w.id if w is not None else None,
        user_id=u.id,
        seed=1,
        round_set=[],
        started_at=datetime.now(UTC),
        submitted_at=datetime.now(UTC),
        total_score=500,
        status=status,
    )
    session.add(e)
    await session.flush()
    return e


# ---------------- tests ----------------
async def test_grants_starter_gem_to_royale_player_and_is_idempotent(db_session: AsyncSession):
    w = await _royale_window(db_session)
    u = await _user(db_session, "royale")
    await _entry(db_session, w, u)

    assert await backfill_starter_gems(db_session) == 1
    profile = await db_session.get(Profile, u.id)
    assert profile is not None and profile.gems_balance == GEM_STARTER_DAILY_ROYALE == 5

    # Re-run: idempotent — grants nobody, balance unchanged.
    assert await backfill_starter_gems(db_session) == 0
    await db_session.refresh(profile)
    assert profile.gems_balance == 5


async def test_non_royale_and_practice_entries_are_not_eligible(db_session: AsyncSession):
    legacy = await _legacy_window(db_session)
    legacy_player = await _user(db_session, "legacy")
    await _entry(db_session, legacy, legacy_player)

    practice_player = await _user(db_session, "practice")
    await _entry(db_session, None, practice_player)  # window_id=None → practice/category session

    assert await backfill_starter_gems(db_session) == 0
    for u in (legacy_player, practice_player):
        profile = await db_session.get(Profile, u.id)
        assert profile is not None and profile.gems_balance == 0


async def test_already_granted_player_is_not_double_granted(db_session: AsyncSession):
    w = await _royale_window(db_session)
    u = await _user(db_session, "already")
    await _entry(db_session, w, u)
    # Grant the starter gem directly (as settlement would have) before backfill runs.
    await record_gem_delta(
        db_session,
        u.id,
        GEM_STARTER_DAILY_ROYALE,
        "starter_daily_royale",
        idempotency_key=f"starter:{u.id}",
    )

    assert await backfill_starter_gems(db_session) == 0
    profile = await db_session.get(Profile, u.id)
    assert profile is not None and profile.gems_balance == 5


async def test_mixed_population_grants_only_eligible_ungranted(db_session: AsyncSession):
    royale = await _royale_window(db_session)
    legacy = await _legacy_window(db_session)

    eligible_a = await _user(db_session, "a")
    eligible_b = await _user(db_session, "b")
    already = await _user(db_session, "c")
    ineligible = await _user(db_session, "d")

    await _entry(db_session, royale, eligible_a)
    await _entry(db_session, royale, eligible_b)
    await _entry(db_session, royale, already)
    await record_gem_delta(
        db_session,
        already.id,
        GEM_STARTER_DAILY_ROYALE,
        "starter_daily_royale",
        idempotency_key=f"starter:{already.id}",
    )
    await _entry(db_session, legacy, ineligible)  # non-royale → not eligible

    assert await backfill_starter_gems(db_session) == 2
    for u in (eligible_a, eligible_b, already):
        profile = await db_session.get(Profile, u.id)
        assert profile is not None and profile.gems_balance == 5
    ineligible_profile = await db_session.get(Profile, ineligible.id)
    assert ineligible_profile is not None and ineligible_profile.gems_balance == 0
