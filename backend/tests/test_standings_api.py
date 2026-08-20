"""Standings + history API (PLAN.md §8) — results visible after settlement."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from app.core.security import create_access_token
from app.models import ContestWindow, Entry, Profile, User
from app.models.contest import CLOSED, SUBMITTED
from app.services.settlement import settle_window
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


async def _seed_settled(db_session: AsyncSession) -> tuple[User, ContestWindow]:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        Profile(user_id=user.id, username=f"u{uuid.uuid4().hex[:10]}", division="Bronze")
    )
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=date(2025, 7, 12),
        slot="night",
        open_at=now - timedelta(hours=6),
        close_at=now - timedelta(hours=1),
        state=CLOSED,
        template_id="m4_night",
    )
    db_session.add(window)
    await db_session.flush()
    db_session.add(
        Entry(
            window_id=window.id,
            user_id=user.id,
            seed=1,
            round_set=[],
            started_at=now,
            submitted_at=now,
            total_score=777,
            status=SUBMITTED,
        )
    )
    await db_session.flush()
    await settle_window(db_session, window.id)
    return user, window


def _auth(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


async def test_standings_returns_settled_placement(client: AsyncClient, db_session: AsyncSession):
    user, window = await _seed_settled(db_session)
    r = await client.get(f"/contests/{window.id}/standings", headers=_auth(user))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "SETTLED"
    mine = next(s for s in body["standings"] if s["total_score"] == 777)
    assert mine["place"] >= 1
    assert mine["field_size"] == 1  # real entries only — one entrant means a field of one
    assert mine["coins_awarded"] == 0  # ranked pays no coins (campaign is the faucet)


async def test_history_shows_placement_and_coins(client: AsyncClient, db_session: AsyncSession):
    user, window = await _seed_settled(db_session)
    r = await client.get("/me/history", headers=_auth(user))
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["state"] == "SETTLED"
    assert item["slot"] == "night"
    assert item["place"] is not None
    assert item["coins_awarded"] is not None
    assert item["rating_after"] is not None
