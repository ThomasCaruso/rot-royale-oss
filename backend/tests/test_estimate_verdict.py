"""Admin playtest-verdict capture: admin-only write, idempotent overwrite, `repetitive` distinct
from `boring`, and an unrated worklist. Verdict fields are admin-write only."""

from __future__ import annotations

import pytest
from app.core.config import settings
from app.models import CognitionEstimateItem, User
from content.estimate_ingest import ingest_estimate_items, set_estimate_verdict
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

ADMIN_EMAIL = "admin@example.com"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register", json={"email": email, "username": username, "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _item(id: str, **over) -> dict:
    it = {
        "id": id,
        "prompt": f"Prompt {id}?",
        "answer": 100,
        "unit": "things",
        "difficulty": "direct",
        "acceptable_pct": 20,
        "close_pct": 40,
        "components": [],
        "reveal_explanation": "because.",
        "category": "misc",
        "_flags": {"dimension": "count"},
    }
    it.update(over)
    return it


async def _row(session: AsyncSession, source_id: str) -> CognitionEstimateItem:
    return (
        await session.execute(
            select(CognitionEstimateItem).where(CognitionEstimateItem.source_id == source_id)
        )
    ).scalar_one()


@pytest.fixture
def _admin(monkeypatch):
    """Grant admin to an already-registered user.

    Admin is keyed on user id now, not email, so it cannot be pre-granted the way an email allowlist
    could — the id does not exist until the account does. That asymmetry IS the security property:
    there is no allowlist entry sitting around waiting for someone to claim it.
    """

    async def grant(session: AsyncSession, email: str) -> None:
        uid = (await session.execute(select(User.id).where(User.email == email))).scalar_one()
        monkeypatch.setattr(settings, "admin_user_ids", str(uid))

    return grant


async def test_verdict_requires_admin(client: AsyncClient, db_session: AsyncSession, _admin):
    await ingest_estimate_items(db_session, [_item("fer_0001")])
    admin = await _register(client, ADMIN_EMAIL, "adminuser")
    await _admin(db_session, ADMIN_EMAIL)
    player = await _register(client, "player@example.com", "playeruser")

    r = await client.post(
        "/cognition/estimate/items/fer_0001/verdict",
        headers=_auth(player),
        json={"verdict": "good", "note": "x"},
    )
    assert r.status_code == 403

    r = await client.post(
        "/cognition/estimate/items/fer_0001/verdict",
        headers=_auth(admin),
        json={"verdict": "good", "note": "x"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["verdict"] == "good"


async def test_verdict_roundtrips_and_overwrites(
    client: AsyncClient, db_session: AsyncSession, _admin
):
    await ingest_estimate_items(db_session, [_item("fer_0001")])
    admin = await _register(client, ADMIN_EMAIL, "adminuser")
    await _admin(db_session, ADMIN_EMAIL)

    r = await client.post(
        "/cognition/estimate/items/fer_0001/verdict",
        headers=_auth(admin),
        json={"verdict": "boring", "note": "first"},
    )
    assert r.status_code == 200
    row = await _row(db_session, "fer_0001")
    assert row.playtest_verdict == "boring"
    assert row.playtest_note == "first"
    assert row.playtest_rated_at is not None

    # Re-rating overwrites (idempotent capture).
    r = await client.post(
        "/cognition/estimate/items/fer_0001/verdict",
        headers=_auth(admin),
        json={"verdict": "good", "note": "second"},
    )
    assert r.status_code == 200
    await db_session.refresh(row)
    assert row.playtest_verdict == "good"
    assert row.playtest_note == "second"


async def test_repetitive_is_distinct_from_boring(
    client: AsyncClient, db_session: AsyncSession, _admin
):
    await ingest_estimate_items(db_session, [_item("a"), _item("b")])
    admin = await _register(client, ADMIN_EMAIL, "adminuser")
    await _admin(db_session, ADMIN_EMAIL)

    await client.post(
        "/cognition/estimate/items/a/verdict",
        headers=_auth(admin),
        json={"verdict": "repetitive", "note": "4th ratio question in a row"},
    )
    await client.post(
        "/cognition/estimate/items/b/verdict",
        headers=_auth(admin),
        json={"verdict": "boring", "note": None},
    )
    assert (await _row(db_session, "a")).playtest_verdict == "repetitive"
    assert (await _row(db_session, "b")).playtest_verdict == "boring"

    # An unknown verdict is rejected.
    r = await client.post(
        "/cognition/estimate/items/a/verdict",
        headers=_auth(admin),
        json={"verdict": "meh", "note": None},
    )
    assert r.status_code == 422


async def test_verdict_unknown_item_404(client: AsyncClient, db_session: AsyncSession, _admin):
    admin = await _register(client, ADMIN_EMAIL, "adminuser")
    await _admin(db_session, ADMIN_EMAIL)
    r = await client.post(
        "/cognition/estimate/items/nope_9999/verdict",
        headers=_auth(admin),
        json={"verdict": "good", "note": None},
    )
    assert r.status_code == 404


async def test_unrated_worklist_admin_only_and_filtered(
    client: AsyncClient, db_session: AsyncSession, _admin
):
    await ingest_estimate_items(db_session, [_item("a"), _item("b"), _item("c")])
    admin = await _register(client, ADMIN_EMAIL, "adminuser")
    await _admin(db_session, ADMIN_EMAIL)
    player = await _register(client, "player@example.com", "playeruser")

    await set_estimate_verdict(db_session, "a", "good", None)  # a is now rated

    r = await client.get("/cognition/estimate/items/unrated?limit=10", headers=_auth(admin))
    assert r.status_code == 200
    ids = {it["id"] for it in r.json()["items"]}
    assert ids == {"b", "c"}  # only unrated

    # limit is honoured.
    r = await client.get("/cognition/estimate/items/unrated?limit=1", headers=_auth(admin))
    assert len(r.json()["items"]) == 1

    # Not for players.
    r = await client.get("/cognition/estimate/items/unrated", headers=_auth(player))
    assert r.status_code == 403
