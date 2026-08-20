"""Viral share loop: challenge snapshots, public /c/<id> pages, and the guest-create rate limit.

Anti-cheat guard: the public challenge surfaces are display-only snapshots — these tests assert no
question/option/answer ever leaks through them.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.api import auth as auth_api
from app.core.constants import DEFAULT_THEME_ID
from app.core.ratelimit import check_rate_limit, reset_rate_limits
from app.core.timezone import ET
from app.models import ContestWindow, Entry, Profile, User
from app.models.contest import OPEN, SUBMITTED
from app.services.challenge import (
    ChallengeEntryNotPlayable,
    ChallengeNotYours,
    contest_no_for_date,
    create_challenge,
    percentile,
)
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def _royale_window(session: AsyncSession, *, state: str = OPEN) -> ContestWindow:
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=now.astimezone(ET).date(),
        slot="royale",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=state,
        template_id="dr_8_trivia",
    )
    session.add(window)
    await session.flush()
    return window


async def _finished_entry(
    session: AsyncSession, window: ContestWindow, user_id, *, score: int = 742
) -> Entry:
    entry = Entry(
        window_id=window.id,
        user_id=user_id,
        is_practice=False,
        seed=123,
        round_set=[],
        started_at=datetime.now(UTC),
        submitted_at=datetime.now(UTC),
        total_score=score,
        status=SUBMITTED,
    )
    session.add(entry)
    await session.flush()
    return entry


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register", json={"email": email, "username": username, "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _user(session: AsyncSession, email: str) -> User:
    user = await session.scalar(select(User).where(User.email == email))
    assert user is not None
    return user


def test_contest_no_and_percentile_are_sane():
    from app.core.constants import DAILY_ROYALE_EPOCH

    assert contest_no_for_date(DAILY_ROYALE_EPOCH) == 1
    assert contest_no_for_date(DAILY_ROYALE_EPOCH + timedelta(days=141)) == 142
    assert percentile(1, 100) == 1  # 1st of 100 → top 1% (smaller = better)
    assert percentile(100, 100) == 99  # last → top 99%, clamped, never 100
    assert percentile(None, None) is None


async def test_create_challenge_is_idempotent_per_entry(
    client: AsyncClient, db_session: AsyncSession
):
    window = await _royale_window(db_session)
    await _register(client, "p1@example.com", "player1")
    user = await _user(db_session, "p1@example.com")
    entry = await _finished_entry(db_session, window, user.id)

    a = await create_challenge(db_session, creator=user, entry_id=entry.id)
    b = await create_challenge(db_session, creator=user, entry_id=entry.id)
    assert a.id == b.id  # re-sharing the same result returns the same link


async def test_create_challenge_rejects_practice_and_others(
    client: AsyncClient, db_session: AsyncSession
):
    window = await _royale_window(db_session)
    await _register(client, "a@example.com", "alice")
    await _register(client, "b@example.com", "bob")
    alice = await _user(db_session, "a@example.com")
    bob = await _user(db_session, "b@example.com")
    entry = await _finished_entry(db_session, window, alice.id)

    # Bob cannot make a challenge from Alice's entry.
    import pytest

    with pytest.raises(ChallengeNotYours):
        await create_challenge(db_session, creator=bob, entry_id=entry.id)

    # An unfinished (no score) entry is not shareable.
    unfinished = Entry(
        window_id=window.id,
        user_id=bob.id,
        is_practice=False,
        seed=1,
        round_set=[],
        started_at=datetime.now(UTC),
        total_score=None,
        status="IN_PROGRESS",
    )
    db_session.add(unfinished)
    await db_session.flush()
    with pytest.raises(ChallengeEntryNotPlayable):
        await create_challenge(db_session, creator=bob, entry_id=unfinished.id)


async def test_post_challenge_returns_a_real_link(client: AsyncClient, db_session: AsyncSession):
    window = await _royale_window(db_session)
    token = await _register(client, "p1@example.com", "player1")
    user = await _user(db_session, "p1@example.com")
    entry = await _finished_entry(db_session, window, user.id, score=742)

    r = await client.post("/challenges", json={"entry_id": str(entry.id)}, headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["score"] == 742
    assert body["id"]
    assert body["url"].endswith(f"/c/{body['id']}")  # a real, tappable share link
    assert body["contest_no"] >= 1


async def test_public_snapshot_is_spoiler_free(client: AsyncClient, db_session: AsyncSession):
    window = await _royale_window(db_session)
    token = await _register(client, "p1@example.com", "player1")
    user = await _user(db_session, "p1@example.com")
    entry = await _finished_entry(db_session, window, user.id, score=742)
    created = (
        await client.post("/challenges", json={"entry_id": str(entry.id)}, headers=_auth(token))
    ).json()

    # PUBLIC (no auth) snapshot.
    r = await client.get(f"/api/challenges/{created['id']}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["username"] == "player1"
    assert body["score"] == 742
    assert body["percentile"] is None or 1 <= body["percentile"] <= 99
    # today's royale is OPEN → the landing can offer immediate play.
    assert body["playable_window_id"] == str(window.id)
    # No spoilers anywhere in the payload.
    raw = r.text.lower()
    for leak in ("correctindex", "answer", "options", "prompt", "question"):
        assert leak not in raw

    assert (await client.get("/api/challenges/nope-nope")).status_code == 404


async def test_entry_lookup_feeds_challenge_create(client: AsyncClient, db_session: AsyncSession):
    """`GET /contests/{id}/entry` → `POST /challenges` must chain without any extra plumbing.

    The Daily-Royale results screen only holds a `window_id`, so it resolves the entry through this
    endpoint before minting the share link. If that hand-off ever breaks, the primary acquisition
    surface silently shares a brag with no link — which is exactly the regression this pins.
    """
    window = await _royale_window(db_session)
    token = await _register(client, "p1@example.com", "player1")
    user = await _user(db_session, "p1@example.com")
    entry = await _finished_entry(db_session, window, user.id, score=742)

    looked_up = (await client.get(f"/contests/{window.id}/entry", headers=_auth(token))).json()
    assert looked_up["entry_id"] == str(entry.id)

    created = await client.post(
        "/challenges", json={"entry_id": looked_up["entry_id"]}, headers=_auth(token)
    )
    assert created.status_code == 200, created.text
    assert created.json()["url"].endswith(f"/c/{created.json()['id']}")


async def test_public_snapshot_carries_the_sharers_current_theme(
    client: AsyncClient, db_session: AsyncSession
):
    """The landing paints itself in the sharer's skin — and follows a re-equip, not share time."""
    window = await _royale_window(db_session)
    token = await _register(client, "p1@example.com", "player1")
    user = await _user(db_session, "p1@example.com")
    entry = await _finished_entry(db_session, window, user.id, score=742)
    created = (
        await client.post("/challenges", json={"entry_id": str(entry.id)}, headers=_auth(token))
    ).json()

    body = (await client.get(f"/api/challenges/{created['id']}")).json()
    assert body["theme"] == DEFAULT_THEME_ID

    # Re-equipping restyles links ALREADY sent: the theme is read live, never snapshotted onto
    # the challenge row.
    profile = await db_session.scalar(select(Profile).where(Profile.user_id == user.id))
    assert profile is not None
    profile.equipped_theme = "royale"
    await db_session.flush()

    body = (await client.get(f"/api/challenges/{created['id']}")).json()
    assert body["theme"] == "royale"

    # And the card image renders in that theme rather than 404/500ing.
    img = await client.get(f"/c/{created['id']}/og.png")
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/png"
    assert img.content.startswith(b"\x89PNG")


async def test_share_page_has_og_meta_and_redirects(client: AsyncClient, db_session: AsyncSession):
    window = await _royale_window(db_session)
    token = await _register(client, "p1@example.com", "player1")
    user = await _user(db_session, "p1@example.com")
    entry = await _finished_entry(db_session, window, user.id, score=742)
    created = (
        await client.post("/challenges", json={"entry_id": str(entry.id)}, headers=_auth(token))
    ).json()

    r = await client.get(f"/c/{created['id']}")
    assert r.status_code == 200, r.text
    doc = r.text
    assert 'property="og:image"' in doc
    assert 'name="twitter:card"' in doc
    assert "/og.png" in doc  # points at the dynamic image
    assert f"/?c={created['id']}" in doc  # redirects a human into the SPA to play


async def test_og_image_renders_png(client: AsyncClient, db_session: AsyncSession):
    window = await _royale_window(db_session)
    token = await _register(client, "p1@example.com", "player1")
    user = await _user(db_session, "p1@example.com")
    entry = await _finished_entry(db_session, window, user.id, score=742)
    created = (
        await client.post("/challenges", json={"entry_id": str(entry.id)}, headers=_auth(token))
    ).json()

    r = await client.get(f"/c/{created['id']}/og.png")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"  # valid PNG signature
    assert len(r.content) > 1000


def test_rate_limiter_blocks_after_the_cap():
    reset_rate_limits()
    key = "guest:203.0.113.9"
    for _ in range(3):
        assert check_rate_limit(key, limit=3) is True
    assert check_rate_limit(key, limit=3) is False  # 4th over a cap of 3 → blocked
    reset_rate_limits()


async def test_guest_endpoint_is_rate_limited(client: AsyncClient, monkeypatch):
    reset_rate_limits()
    monkeypatch.setattr(auth_api, "GUEST_CREATE_MAX_PER_IP_PER_HOUR", 2)
    ip = {"X-Forwarded-For": "198.51.100.7"}
    assert (await client.post("/auth/guest", headers=ip)).status_code == 200
    assert (await client.post("/auth/guest", headers=ip)).status_code == 200
    assert (await client.post("/auth/guest", headers=ip)).status_code == 429  # capped
    reset_rate_limits()
