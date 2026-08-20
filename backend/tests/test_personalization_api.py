"""Personalization API — event intake, question resolution, debug-gated profile view."""

from __future__ import annotations

import uuid

import pytest
from app.core.config import settings
from app.models import Question, QuestionInteractionEvent, UserTasteProfile
from content.loader import load_trivia
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register",
        json={"email": email, "username": username, "password": "super-secret-pw"},
    )
    assert r.status_code == 200, r.text
    return str(r.json()["access_token"])


def _event_body(**over: object) -> dict[str, object]:
    base: dict[str, object] = {
        "mode": "practice",
        "is_correct": True,
        "response_ms": 1500,
    }
    base.update(over)
    return base


async def test_event_with_question_id_updates_profile(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "pz1@example.com", "pz1")
    q = Question(
        module_type="trivia",
        category="History",
        icon="🏺",
        payload={"prompt": "When?", "options": ["a", "b", "c", "d"], "correctIndex": 0},
        difficulty="easy",
        status="approved",
    )
    db_session.add(q)
    await db_session.flush()

    r = await client.post(
        "/personalization/events",
        json=_event_body(question_id=str(q.id)),
        headers=_auth(token),
    )
    assert r.status_code == 202, r.text
    assert r.json() == {"recorded": True}

    event = await db_session.scalar(select(QuestionInteractionEvent))
    assert event is not None and event.question_id == q.id

    profile = await db_session.scalar(select(UserTasteProfile))
    assert profile is not None
    assert profile.interaction_count == 0  # /events is engagement-only; server owns the count
    assert profile.category_affinity != {}  # signal still shaped the profile


async def test_event_resolves_question_from_entry(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await load_trivia(db_session)
    token = await _register(client, "pz2@example.com", "pz2")

    r = await client.post("/practice/start", json={"mode": "quick"}, headers=_auth(token))
    assert r.status_code == 200, r.text
    entry_id = r.json()["entry_id"]

    r = await client.post(
        "/personalization/events",
        json=_event_body(entry_id=entry_id, idx=0),
        headers=_auth(token),
    )
    assert r.status_code == 202, r.text

    event = await db_session.scalar(select(QuestionInteractionEvent))
    assert event is not None
    assert event.question_id is not None  # resolved server-side from round_answers


async def test_event_stored_but_profile_untouched_when_disabled(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "personalization_enabled", False)
    token = await _register(client, "pz3@example.com", "pz3")

    r = await client.post("/personalization/events", json=_event_body(), headers=_auth(token))
    assert r.status_code == 202
    assert await db_session.scalar(select(QuestionInteractionEvent)) is not None
    assert await db_session.scalar(select(UserTasteProfile)) is None


async def test_event_with_unknown_question_id_recorded_without_link(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "pz4@example.com", "pz4")
    r = await client.post(
        "/personalization/events",
        json=_event_body(question_id=str(uuid.uuid4())),
        headers=_auth(token),
    )
    assert r.status_code == 202
    event = await db_session.scalar(select(QuestionInteractionEvent))
    assert event is not None and event.question_id is None


async def test_event_validation_and_auth(client: AsyncClient) -> None:
    token = await _register(client, "pz5@example.com", "pz5")
    r = await client.post("/personalization/events", json={}, headers=_auth(token))
    assert r.status_code == 422  # mode is required
    r = await client.post("/personalization/events", json=_event_body())
    assert r.status_code == 401  # auth required


async def test_ai_status_public(client: AsyncClient, db_session: AsyncSession) -> None:
    """GET /personalization/status is public (no auth) and returns the correct shape.

    On the test DB coverage is 0 (no AI metadata rows), so ready must be False.
    """
    r = await client.get("/personalization/status")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "coverage" in data
    assert "ready" in data
    assert isinstance(data["coverage"], float)
    # Test DB has no AI metadata rows → coverage 0.0 → well below the 0.8 threshold.
    assert data["ready"] is False


async def test_profile_endpoint_debug_gate(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = await _register(client, "pz6@example.com", "pz6")

    # non-production (default local/test env): visible
    r = await client.get("/personalization/me/profile", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["interaction_count"] == 0

    # production + debug off: hidden
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "personalization_debug", False)
    r = await client.get("/personalization/me/profile", headers=_auth(token))
    assert r.status_code == 404

    # production + debug on: visible
    monkeypatch.setattr(settings, "personalization_debug", True)
    r = await client.get("/personalization/me/profile", headers=_auth(token))
    assert r.status_code == 200
