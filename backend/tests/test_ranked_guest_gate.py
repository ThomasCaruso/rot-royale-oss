"""Ranked leaderboard permanence requires a SAVED profile.

Guests (anonymous-first accounts) may PLAY the Daily Royale end to end — enter, answer, appear in
the live field — but settlement excludes anyone still a guest: no standing, no rating, no streak,
no gems. Upgrading before settlement makes them an ordinary ranked player. Non-guest behavior is
byte-for-byte unchanged (the whole existing settlement suite still covers that).
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from app.models import ContestWindow, Entry, Profile, Standing, User
from app.models.contest import CLOSED, SETTLED, SUBMITTED
from app.models.user import GUEST_STATUS
from app.services.registration import register_guest, upgrade_guest
from app.services.settlement import settle_window
from content.loader import load_trivia
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def _saved_user(session: AsyncSession) -> User:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(
        Profile(
            user_id=user.id, username=f"u{uuid.uuid4().hex[:10]}", division="Bronze", rating=1000
        )
    )
    await session.flush()
    return user


async def _closed_royale(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    w = ContestWindow(
        contest_date=date(2026, 7, 2),
        slot="royale",
        open_at=now - timedelta(hours=25),
        close_at=now - timedelta(hours=1),
        state=CLOSED,
        template_id="dr_8_trivia",
    )
    session.add(w)
    await session.flush()
    return w


async def _submitted_entry(session: AsyncSession, w: ContestWindow, u: User, score: int) -> Entry:
    e = Entry(
        window_id=w.id,
        user_id=u.id,
        seed=1,
        round_set=[],
        started_at=datetime.now(UTC),
        submitted_at=datetime.now(UTC),
        total_score=score,
        status=SUBMITTED,
    )
    session.add(e)
    await session.flush()
    return e


async def test_guest_can_play_ranked_but_gets_no_permanent_result(
    db_session: AsyncSession,
) -> None:
    window = await _closed_royale(db_session)
    guest = await register_guest(db_session)
    saved = await _saved_user(db_session)
    await _submitted_entry(db_session, window, guest, score=900)  # guest even outscored them
    await _submitted_entry(db_session, window, saved, score=500)

    assert await settle_window(db_session, window.id)
    assert (await db_session.get(ContestWindow, window.id)).state == SETTLED  # type: ignore[union-attr]

    standings = (
        (await db_session.execute(select(Standing).where(Standing.window_id == window.id)))
        .scalars()
        .all()
    )
    ranked_users = {s.user_id for s in standings}
    assert saved.id in ranked_users
    assert guest.id not in ranked_users  # the score was never locked in

    guest_profile = await db_session.get(Profile, guest.id)
    assert guest_profile is not None
    assert guest_profile.rating == 1000  # untouched
    assert guest_profile.streak_count == 0
    assert guest_profile.last_streak_date is None


async def test_guest_upgraded_before_settlement_is_ranked_normally(
    db_session: AsyncSession,
) -> None:
    window = await _closed_royale(db_session)
    guest = await register_guest(db_session)
    await _submitted_entry(db_session, window, guest, score=800)

    # "Save your profile to lock in your rank" — before settlement runs.
    await upgrade_guest(db_session, guest, "locked-in@example.com", "super-secret-pw")
    assert guest.status != GUEST_STATUS

    assert await settle_window(db_session, window.id)
    standing = await db_session.scalar(
        select(Standing).where(Standing.window_id == window.id, Standing.user_id == guest.id)
    )
    assert standing is not None
    assert standing.place >= 1

    profile = await db_session.get(Profile, guest.id)
    assert profile is not None
    assert profile.streak_count == 1  # streak started — full ranked identity
    assert profile.rating != 1000 or standing.rating_after == standing.rating_before


async def test_saved_users_ranked_exactly_as_before_with_guests_in_the_field(
    db_session: AsyncSession,
) -> None:
    """A guest in the field must not shift saved players' placements.

    Scores sit far above any cold-start bot total (bots simulate plausible 8-question runs), so
    the two saved players must land adjacent at the top — the guest between them takes no place.
    """
    window = await _closed_royale(db_session)
    top = await _saved_user(db_session)
    bottom = await _saved_user(db_session)
    guest = await register_guest(db_session)
    await _submitted_entry(db_session, window, top, score=9000)
    await _submitted_entry(db_session, window, guest, score=8700)  # would have been 2nd
    await _submitted_entry(db_session, window, bottom, score=8500)

    assert await settle_window(db_session, window.id)
    places = {
        s.user_id: s.place
        for s in (
            await db_session.execute(select(Standing).where(Standing.window_id == window.id))
        ).scalars()
    }
    assert places[top.id] == 1
    assert places[bottom.id] == 2  # ranked directly behind — the guest took no place
    assert guest.id not in places


async def test_guest_can_still_enter_and_answer_ranked_live(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Play paths stay open: the gate is settlement-only, never the live experience."""
    await load_trivia(db_session)
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=date(2026, 7, 3),
        slot="royale",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=8),
        state="OPEN",
        template_id="dr_8_trivia",
    )
    db_session.add(window)
    await db_session.flush()

    r = await client.post("/auth/guest")
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    r = await client.post(f"/contests/{window.id}/enter", headers=headers)
    assert r.status_code == 200, r.text
    entry_id = r.json()["entry_id"]

    r = await client.post(
        f"/entries/{entry_id}/answer",
        json={"idx": 0, "result": {"choice": 0, "elapsed_ms": 2000}},
        headers=headers,
    )
    assert r.status_code == 200, r.text  # answering works — no wall mid-run
