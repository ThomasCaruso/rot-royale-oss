"""Self-serve data export (GDPR Art. 15/20, CCPA right to know).

The two properties that matter: it returns the caller's own data, and it never returns anyone
else's or anything that would compromise the anti-cheat boundary.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from app.core.timezone import ET
from app.models import ContestWindow, Entry
from app.models.contest import OPEN, SUBMITTED
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register", json={"email": email, "username": username, "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
class TestExport:
    async def test_requires_authentication(self, client: AsyncClient) -> None:
        assert (await client.get("/me/export")).status_code == 401

    async def test_returns_the_callers_own_account(self, client: AsyncClient) -> None:
        token = await _register(client, "exporter@example.com", "Exporter")
        r = await client.get("/me/export", headers=_auth(token))
        assert r.status_code == 200, r.text
        data = r.json()

        assert data["account"]["email"] == "exporter@example.com"
        assert data["profile"]["username"] == "Exporter"
        assert data["export_version"]
        assert data["generated_at"]

    async def test_covers_every_category_the_policy_promises(self, client: AsyncClient) -> None:
        """The policy lists what we hold; the export must have a section for each of those."""
        token = await _register(client, "cats@example.com", "Cats")
        data = (await client.get("/me/export", headers=_auth(token))).json()
        for key in (
            "account",
            "profile",
            "games_played",
            "standings",
            "coin_history",
            "gem_history",
            "unlocked_themes",
            "unlocked_cosmetics",
            "notification_devices",
            "share_links",
            "friendships",
        ):
            assert key in data, f"export is missing the {key!r} section"

    async def test_includes_played_games(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        token = await _register(client, "played@example.com", "Played")
        me = (await client.get("/me", headers=_auth(token))).json()

        now = datetime.now(UTC)
        window = ContestWindow(
            contest_date=now.astimezone(ET).date(),
            slot="royale",
            open_at=now - timedelta(hours=1),
            close_at=now + timedelta(hours=1),
            state=OPEN,
            template_id="dr_8_trivia",
        )
        db_session.add(window)
        await db_session.flush()
        db_session.add(
            Entry(
                window_id=window.id,
                user_id=me["user_id"],
                is_practice=False,
                seed=1,
                round_set=[],
                started_at=now,
                submitted_at=now,
                total_score=742,
                status=SUBMITTED,
            )
        )
        await db_session.flush()

        data = (await client.get("/me/export", headers=_auth(token))).json()
        assert any(g["score"] == 742 for g in data["games_played"])

    async def test_never_leaks_another_users_account(self, client: AsyncClient) -> None:
        await _register(client, "other@example.com", "OtherPerson")
        token = await _register(client, "mine@example.com", "Mine")
        body = (await client.get("/me/export", headers=_auth(token))).text
        assert "other@example.com" not in body
        assert "OtherPerson" not in body

    async def test_never_leaks_answer_keys(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """Anti-cheat boundary: the stored correct answers are not part of a subject request."""
        token = await _register(client, "nokeys@example.com", "NoKeys")
        body = (await client.get("/me/export", headers=_auth(token))).json()
        assert "round_answers" not in body
        assert "correctIndex" not in str(body)

    async def test_never_exports_a_push_token(self, client: AsyncClient) -> None:
        """A device token is a credential — reporting that a device exists is enough."""
        token = await _register(client, "push@example.com", "PushUser")
        data = (await client.get("/me/export", headers=_auth(token))).json()
        for device in data["notification_devices"]:
            assert "token" not in device
            assert "device_token" not in device
