"""Identity fields (avatar_preset, equipped_frame) on the field + standings APIs.

Task 3 of the avatar-identity-v1 plan.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from app.core.security import create_access_token
from app.models import ContestWindow, Entry, Profile, RoundAnswer, User
from app.models.contest import CLOSED, OPEN, SUBMITTED
from app.services.settlement import settle_window
from httpx import AsyncClient
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _auth_header(user_id: uuid.UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(user_id))}"}


async def _make_user(
    session: AsyncSession,
    *,
    avatar_preset: str = "knight",
    equipped_frame: str | None = None,
    equipped_badges: list[str] | None = None,
    equipped_title: str | None = None,
) -> User:
    """Create a user + profile with the given identity fields (no ledger, no theme ownership)."""
    user = User(email=f"{uuid.uuid4().hex}@fieldid.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(
        Profile(
            user_id=user.id,
            username=f"u{uuid.uuid4().hex[:10]}",
            division="Bronze",
            equipped_theme="royale",
            avatar_preset=avatar_preset,
            equipped_frame=equipped_frame,
            equipped_badges=equipped_badges if equipped_badges is not None else [],
            equipped_title=equipped_title,
        )
    )
    await session.flush()
    return user


async def _open_window(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=now.date(),
        slot="midday",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=OPEN,
        template_id="m2_trivia_7",
    )
    session.add(window)
    await session.flush()
    return window


async def _closed_window(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=date(2025, 8, 20),
        slot="night",
        open_at=now - timedelta(hours=6),
        close_at=now - timedelta(hours=1),
        state=CLOSED,
        template_id="m4_night",
    )
    session.add(window)
    await session.flush()
    return window


async def _submitted_entry(
    session: AsyncSession, window: ContestWindow, user: User, score: int = 500
) -> Entry:
    now = datetime.now(UTC)
    entry = Entry(
        window_id=window.id,
        user_id=user.id,
        seed=1,
        round_set=[],
        started_at=now,
        submitted_at=now,
        total_score=score,
        status=SUBMITTED,
    )
    session.add(entry)
    await session.flush()
    return entry


async def _enter_and_submit(
    client: AsyncClient, session: AsyncSession, window: ContestWindow, user: User
) -> None:
    """Enter the window and submit correct answers via the API, producing a SUBMITTED entry."""
    from content.loader import load_trivia

    await load_trivia(session)
    auth = _auth_header(user.id)
    enter_r = await client.post(f"/contests/{window.id}/enter", headers=auth)
    assert enter_r.status_code == 200, enter_r.text
    entry_id = enter_r.json()["entry_id"]

    answers = (
        (
            await session.execute(
                sa_select(RoundAnswer)
                .where(RoundAnswer.entry_id == entry_id)
                .order_by(RoundAnswer.idx)
            )
        )
        .scalars()
        .all()
    )
    subs = [
        {"idx": a.idx, "result": {"choice": a.server_answer["correctIndex"], "elapsed_ms": 5000}}
        for a in answers
    ]
    sub_r = await client.post(f"/entries/{entry_id}/submit", headers=auth, json={"rounds": subs})
    assert sub_r.status_code == 200, sub_r.text


# ---------------------------------------------------------------------------
# Field endpoint: real-user identity (default preset + no frame)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_field_real_user_default_identity(client: AsyncClient, db_session: AsyncSession):
    """A fresh user in the field shows avatar_preset='knight' and equipped_frame=None."""
    user = await _make_user(db_session)  # defaults: knight, no frame
    window = await _open_window(db_session)
    await _enter_and_submit(client, db_session, window, user)

    auth = _auth_header(user.id)
    field_r = await client.get(f"/contests/{window.id}/field", headers=auth)
    assert field_r.status_code == 200, field_r.text
    entries = field_r.json()["entries"]

    profile = await db_session.get(Profile, user.id)
    assert profile is not None
    mine = next((e for e in entries if e["username"] == profile.username), None)
    assert mine is not None, f"User not found in field. Entries: {[e['username'] for e in entries]}"
    assert mine["avatar_preset"] == "knight"
    assert mine["equipped_frame"] is None


# ---------------------------------------------------------------------------
# Field endpoint: real-user identity (patched preset + equipped frame)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_field_real_user_patched_identity(client: AsyncClient, db_session: AsyncSession):
    """A user with avatar 'rook' and frame 'bronze_ring' shows those in the field response."""
    user = await _make_user(db_session, avatar_preset="rook", equipped_frame="bronze_ring")
    window = await _open_window(db_session)
    await _enter_and_submit(client, db_session, window, user)

    auth = _auth_header(user.id)
    field_r = await client.get(f"/contests/{window.id}/field", headers=auth)
    assert field_r.status_code == 200, field_r.text
    entries = field_r.json()["entries"]

    profile = await db_session.get(Profile, user.id)
    assert profile is not None
    mine = next((e for e in entries if e["username"] == profile.username), None)
    assert mine is not None
    assert mine["avatar_preset"] == "rook"
    assert mine["equipped_frame"] == "bronze_ring"


# ---------------------------------------------------------------------------
# Standings endpoint: identity fields present (custom avatar + frame)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_standings_carry_avatar_preset_and_frame(
    client: AsyncClient, db_session: AsyncSession
):
    """After settlement, standings rows include avatar_preset and equipped_frame."""
    user = await _make_user(db_session, avatar_preset="rook", equipped_frame="violet_glow")
    window = await _closed_window(db_session)
    await _submitted_entry(db_session, window, user, score=888)
    await settle_window(db_session, window.id)

    auth = _auth_header(user.id)
    r = await client.get(f"/contests/{window.id}/standings", headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "SETTLED"

    profile = await db_session.get(Profile, user.id)
    assert profile is not None
    mine = next((s for s in body["standings"] if s["username"] == profile.username), None)
    assert mine is not None
    assert mine["avatar_preset"] == "rook"
    assert mine["equipped_frame"] == "violet_glow"


@pytest.mark.asyncio
async def test_standings_fresh_user_defaults(client: AsyncClient, db_session: AsyncSession):
    """A fresh user (no PATCH) has avatar_preset='knight' and equipped_frame=None in standings."""
    user = await _make_user(db_session)  # defaults
    window = await _closed_window(db_session)
    await _submitted_entry(db_session, window, user, score=333)
    await settle_window(db_session, window.id)

    auth = _auth_header(user.id)
    r = await client.get(f"/contests/{window.id}/standings", headers=auth)
    assert r.status_code == 200, r.text

    profile = await db_session.get(Profile, user.id)
    assert profile is not None
    mine = next(s for s in r.json()["standings"] if s["username"] == profile.username)
    assert mine["avatar_preset"] == "knight"
    assert mine["equipped_frame"] is None


# ---------------------------------------------------------------------------
# V2 Identity: equipped_badges + equipped_title on field endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_field_real_user_equipped_badges_and_title(
    client: AsyncClient, db_session: AsyncSession
):
    """A user with equipped badges and a title shows them in the field response."""
    user = await _make_user(
        db_session,
        equipped_badges=["podium_finisher", "first_crown"],
        equipped_title="champion",
    )
    window = await _open_window(db_session)
    await _enter_and_submit(client, db_session, window, user)

    auth = _auth_header(user.id)
    field_r = await client.get(f"/contests/{window.id}/field", headers=auth)
    assert field_r.status_code == 200, field_r.text
    entries = field_r.json()["entries"]

    profile = await db_session.get(Profile, user.id)
    assert profile is not None
    mine = next((e for e in entries if e["username"] == profile.username), None)
    assert mine is not None, f"User not found in field. Entries: {[e['username'] for e in entries]}"
    assert mine["equipped_badges"] == ["podium_finisher", "first_crown"], (
        f"expected badges, got {mine['equipped_badges']!r}"
    )
    assert mine["equipped_title"] == "champion", (
        f"expected title 'champion', got {mine['equipped_title']!r}"
    )


@pytest.mark.asyncio
async def test_field_fresh_user_badge_title_defaults(client: AsyncClient, db_session: AsyncSession):
    """A fresh user (no badges/title set) shows empty list and None in the field response."""
    user = await _make_user(db_session)  # defaults: [], None
    window = await _open_window(db_session)
    await _enter_and_submit(client, db_session, window, user)

    auth = _auth_header(user.id)
    field_r = await client.get(f"/contests/{window.id}/field", headers=auth)
    assert field_r.status_code == 200, field_r.text
    entries = field_r.json()["entries"]

    profile = await db_session.get(Profile, user.id)
    assert profile is not None
    mine = next((e for e in entries if e["username"] == profile.username), None)
    assert mine is not None
    assert mine["equipped_badges"] == [], (
        f"fresh user equipped_badges should be [], got {mine['equipped_badges']!r}"
    )
    assert mine["equipped_title"] is None, (
        f"fresh user equipped_title should be None, got {mine['equipped_title']!r}"
    )


# ---------------------------------------------------------------------------
# V2 Identity: equipped_badges + equipped_title on standings endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_standings_carry_equipped_badges_and_title(
    client: AsyncClient, db_session: AsyncSession
):
    """After settlement, standings rows include equipped_badges and equipped_title."""
    user = await _make_user(
        db_session,
        avatar_preset="rook",
        equipped_badges=["medal_science", "crown_all"],
        equipped_title="trivia_menace",
    )
    window = await _closed_window(db_session)
    await _submitted_entry(db_session, window, user, score=750)
    await settle_window(db_session, window.id)

    auth = _auth_header(user.id)
    r = await client.get(f"/contests/{window.id}/standings", headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "SETTLED"

    profile = await db_session.get(Profile, user.id)
    assert profile is not None
    mine = next((s for s in body["standings"] if s["username"] == profile.username), None)
    assert mine is not None
    assert mine["equipped_badges"] == ["medal_science", "crown_all"], (
        f"expected badges, got {mine['equipped_badges']!r}"
    )
    assert mine["equipped_title"] == "trivia_menace", (
        f"expected title 'trivia_menace', got {mine['equipped_title']!r}"
    )


@pytest.mark.asyncio
async def test_standings_fresh_user_badge_title_defaults(
    client: AsyncClient, db_session: AsyncSession
):
    """A fresh user (no badges/title) has equipped_badges=[] and equipped_title=None in
    standings."""
    user = await _make_user(db_session)  # defaults
    window = await _closed_window(db_session)
    await _submitted_entry(db_session, window, user, score=400)
    await settle_window(db_session, window.id)

    auth = _auth_header(user.id)
    r = await client.get(f"/contests/{window.id}/standings", headers=auth)
    assert r.status_code == 200, r.text

    profile = await db_session.get(Profile, user.id)
    assert profile is not None
    mine = next(s for s in r.json()["standings"] if s["username"] == profile.username)
    assert mine["equipped_badges"] == [], (
        f"fresh user equipped_badges should be [], got {mine['equipped_badges']!r}"
    )
    assert mine["equipped_title"] is None, (
        f"fresh user equipped_title should be None, got {mine['equipped_title']!r}"
    )
