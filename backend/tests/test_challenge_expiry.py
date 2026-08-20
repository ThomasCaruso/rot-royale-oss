"""Share links stop resolving once their Daily Royale closes.

A share page is PUBLIC — no auth, anyone holding the URL. That is justified while the link still
means "beat my score today"; it is not justified forever, because links get forwarded, pasted into
group chats and indexed long after the contest they point at has finished.

Reuses the real window/entry/user shapes rather than stubbing, so the foreign keys are genuine and
the expiry is exercised against the same rows production would see.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from app.core.timezone import ET
from app.models import Challenge, ContestWindow, Entry, User
from app.models.contest import OPEN, SUBMITTED
from app.services.challenge import (
    create_challenge,
    get_challenge,
    purge_expired_challenges,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def _window(
    session: AsyncSession, *, closes_in: timedelta, day_offset: int = 0
) -> ContestWindow:
    # One royale window per (contest_date, slot), so tests needing two windows must use two dates.
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=now.astimezone(ET).date() + timedelta(days=day_offset),
        slot="royale",
        open_at=now - timedelta(hours=2),
        close_at=now + closes_in,
        state=OPEN,
        template_id="dr_8_trivia",
    )
    session.add(window)
    await session.flush()
    return window


async def _user(session: AsyncSession, email: str) -> User:
    from app.services.registration import register_user

    return await register_user(session, email, email.split("@")[0], "super-secret-pw")


async def _shared(session: AsyncSession, window: ContestWindow, user: User) -> Challenge:
    entry = Entry(
        window_id=window.id,
        user_id=user.id,
        is_practice=False,
        seed=123,
        round_set=[],
        started_at=datetime.now(UTC),
        submitted_at=datetime.now(UTC),
        total_score=742,
        status=SUBMITTED,
    )
    session.add(entry)
    await session.flush()
    return await create_challenge(session, creator=user, entry_id=entry.id)


@pytest.mark.asyncio
class TestShareLinkExpiry:
    async def test_resolves_while_the_window_is_open(self, db_session: AsyncSession) -> None:
        w = await _window(db_session, closes_in=timedelta(hours=6))
        c = await _shared(db_session, w, await _user(db_session, "open@example.com"))
        assert await get_challenge(db_session, c.id) is not None

    async def test_stops_resolving_once_the_window_closes(self, db_session: AsyncSession) -> None:
        w = await _window(db_session, closes_in=timedelta(hours=1))
        c = await _shared(db_session, w, await _user(db_session, "expired@example.com"))
        # One second past close: nobody can enter that contest any more, so the page has no purpose.
        assert await get_challenge(db_session, c.id, now=w.close_at + timedelta(seconds=1)) is None

    async def test_expired_is_indistinguishable_from_nonexistent(
        self, db_session: AsyncSession
    ) -> None:
        """Both return None, so the endpoint never confirms a given id once existed."""
        w = await _window(db_session, closes_in=timedelta(hours=1))
        c = await _shared(db_session, w, await _user(db_session, "gone@example.com"))
        after = w.close_at + timedelta(seconds=1)
        assert await get_challenge(db_session, c.id, now=after) is None
        assert await get_challenge(db_session, "neverexisted", now=after) is None

    async def test_applies_to_links_shared_before_the_rule_existed(
        self, db_session: AsyncSession
    ) -> None:
        """Expiry is derived from the window, not stored on the row — so old links expire too."""
        w = await _window(db_session, closes_in=timedelta(days=-3))  # closed three days ago
        c = await _shared(db_session, w, await _user(db_session, "legacy@example.com"))
        assert await get_challenge(db_session, c.id) is None


@pytest.mark.asyncio
class TestPurge:
    async def test_removes_only_links_whose_window_closed(self, db_session: AsyncSession) -> None:
        live = await _window(db_session, closes_in=timedelta(hours=6))
        dead = await _window(db_session, closes_in=timedelta(hours=-1), day_offset=-1)
        keep = await _shared(db_session, live, await _user(db_session, "keep@example.com"))
        drop = await _shared(db_session, dead, await _user(db_session, "drop@example.com"))

        assert await purge_expired_challenges(db_session) == 1
        remaining = set((await db_session.execute(select(Challenge.id))).scalars())
        assert keep.id in remaining
        assert drop.id not in remaining

    async def test_is_idempotent(self, db_session: AsyncSession) -> None:
        dead = await _window(db_session, closes_in=timedelta(hours=-1))
        await _shared(db_session, dead, await _user(db_session, "twice@example.com"))
        assert await purge_expired_challenges(db_session) == 1
        assert await purge_expired_challenges(db_session) == 0
