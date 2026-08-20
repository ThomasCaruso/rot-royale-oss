"""Funnel analytics beacon — optional auth, allowlisted events, append-only rows."""

from __future__ import annotations

from app.models import FunnelEvent
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def test_anonymous_event_is_recorded_with_no_user(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    r = await client.post("/analytics/funnel", json={"event": "intro_viewed"})
    assert r.status_code == 202, r.text
    assert r.json() == {"recorded": True}

    row = await db_session.scalar(select(FunnelEvent))
    assert row is not None
    assert row.event == "intro_viewed"
    assert row.user_id is None
    assert row.source is None


async def test_authenticated_event_carries_the_user(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    guest = await client.post("/auth/guest")
    token = guest.json()["access_token"]

    r = await client.post(
        "/analytics/funnel",
        json={"event": "upgrade_completed", "source": "ranked_gate"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 202

    row = await db_session.scalar(
        select(FunnelEvent).where(FunnelEvent.event == "upgrade_completed")
    )
    assert row is not None
    assert row.user_id is not None
    assert row.source == "ranked_gate"


async def test_a_garbage_token_still_records_anonymously(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The beacon must never 401 — a stale/invalid token degrades to an anonymous event."""
    r = await client.post(
        "/analytics/funnel",
        json={"event": "start_check_clicked"},
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert r.status_code == 202
    row = await db_session.scalar(
        select(FunnelEvent).where(FunnelEvent.event == "start_check_clicked")
    )
    assert row is not None and row.user_id is None


async def test_unknown_event_names_are_rejected(client: AsyncClient) -> None:
    r = await client.post("/analytics/funnel", json={"event": "totally_made_up"})
    assert r.status_code == 422  # allowlist keeps the funnel queryable
