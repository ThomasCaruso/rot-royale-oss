"""Anonymous-first auth: guest accounts, instant play, upgrade-in-place ("save your profile")."""

from __future__ import annotations

import uuid

from app.models import RoundAnswer
from content.loader import load_trivia
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _guest(client: AsyncClient) -> str:
    r = await client.post("/auth/guest")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"] and body["refresh_token"]
    return str(body["access_token"])


async def test_guest_gets_seeded_profile_with_no_form(client: AsyncClient) -> None:
    token = await _guest(client)
    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["is_guest"] is True
    assert me["username"].startswith("rot_")
    assert me["rating"] == 1000  # same seed flow as a registered account
    assert me["email"].endswith("@guest.invalid")


async def test_guest_can_play_practice_immediately(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await load_trivia(db_session)
    token = await _guest(client)
    r = await client.post("/practice/start", json={"mode": "quick"}, headers=_auth(token))
    assert r.status_code == 200, r.text
    assert len(r.json()["rounds"]) == 8


async def test_upgrade_keeps_progress_on_same_account(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await load_trivia(db_session)
    token = await _guest(client)
    me_before = (await client.get("/me", headers=_auth(token))).json()

    # Earn some progress as a guest: play one practice round-set to completion, answering
    # correctly via the stored server answers (options are server-shuffled — choice 0 is luck).
    start = (
        await client.post("/practice/start", json={"mode": "quick"}, headers=_auth(token))
    ).json()
    answers = (
        (
            await db_session.execute(
                select(RoundAnswer)
                .where(RoundAnswer.entry_id == uuid.UUID(start["entry_id"]))
                .order_by(RoundAnswer.idx)
            )
        )
        .scalars()
        .all()
    )
    for a in answers:
        r = await client.post(
            f"/practice/{start['entry_id']}/answer",
            json={
                "idx": a.idx,
                "result": {"choice": a.server_answer["correctIndex"], "elapsed_ms": 2000},
            },
            headers=_auth(token),
        )
        assert r.status_code == 200, r.text

    r = await client.post(
        "/auth/upgrade",
        json={"email": "saved@example.com", "password": "super-secret-pw"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    new_token = r.json()["access_token"]

    me_after = (await client.get("/me", headers=_auth(new_token))).json()
    assert me_after["user_id"] == me_before["user_id"]  # SAME account — nothing to merge
    assert me_after["is_guest"] is False
    assert me_after["email"] == "saved@example.com"
    assert me_after["username"] == me_before["username"]  # auto-handle kept
    assert me_after["sharpness"] > 0  # guest progress retained

    # The saved credentials now log in normally.
    r = await client.post(
        "/auth/login", json={"email": "saved@example.com", "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text


async def test_upgrade_rejects_taken_email_and_non_guests(client: AsyncClient) -> None:
    r = await client.post(
        "/auth/register",
        json={"email": "real@example.com", "username": "realuser", "password": "super-secret-pw"},
    )
    real_token = r.json()["access_token"]

    guest_token = await _guest(client)
    r = await client.post(
        "/auth/upgrade",
        json={"email": "real@example.com", "password": "super-secret-pw"},
        headers=_auth(guest_token),
    )
    assert r.status_code == 409  # email already registered

    # A non-guest (already-saved) account can't upgrade again.
    r = await client.post(
        "/auth/upgrade",
        json={"email": "other@example.com", "password": "super-secret-pw"},
        headers=_auth(real_token),
    )
    assert r.status_code == 409

    # And after a successful upgrade, a second upgrade is rejected too.
    r = await client.post(
        "/auth/upgrade",
        json={"email": "mine@example.com", "password": "super-secret-pw"},
        headers=_auth(guest_token),
    )
    assert r.status_code == 200
    r = await client.post(
        "/auth/upgrade",
        json={"email": "again@example.com", "password": "super-secret-pw"},
        headers=_auth(guest_token),
    )
    assert r.status_code == 409


async def test_registered_users_are_not_guests(client: AsyncClient) -> None:
    r = await client.post(
        "/auth/register",
        json={"email": "ng@example.com", "username": "notguest", "password": "super-secret-pw"},
    )
    me = (await client.get("/me", headers=_auth(r.json()["access_token"]))).json()
    assert me["is_guest"] is False


# ---------------------------------------------------------------- choosing a username on upgrade


async def test_upgrade_sets_the_chosen_username(client: AsyncClient) -> None:
    """The save screen asks for email + username + password; the chosen handle takes effect."""
    token = await _guest(client)
    auto_handle = (await client.get("/me", headers=_auth(token))).json()["username"]

    r = await client.post(
        "/auth/upgrade",
        json={
            "email": "chosen@example.com",
            "username": "ChosenName",
            "password": "super-secret-pw",
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text

    me = (await client.get("/me", headers=_auth(r.json()["access_token"]))).json()
    assert me["username"] == "ChosenName"
    assert me["username"] != auto_handle
    assert me["is_guest"] is False


async def test_upgrade_without_a_username_keeps_the_guest_handle(client: AsyncClient) -> None:
    """Optional field: an older client that sends only credentials must still work."""
    token = await _guest(client)
    auto_handle = (await client.get("/me", headers=_auth(token))).json()["username"]

    r = await client.post(
        "/auth/upgrade",
        json={"email": "nohandle@example.com", "password": "super-secret-pw"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    me = (await client.get("/me", headers=_auth(r.json()["access_token"]))).json()
    assert me["username"] == auto_handle


async def test_upgrade_accepts_the_players_own_handle_unchanged(client: AsyncClient) -> None:
    """The form PRE-FILLS the current handle, so submitting it unchanged is the common path.

    It must not collide with the player's own profile row — otherwise simply accepting the
    pre-filled value would fail with "username taken" against themselves.
    """
    token = await _guest(client)
    auto_handle = (await client.get("/me", headers=_auth(token))).json()["username"]

    r = await client.post(
        "/auth/upgrade",
        json={
            "email": "samename@example.com",
            "username": auto_handle,
            "password": "super-secret-pw",
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    me = (await client.get("/me", headers=_auth(r.json()["access_token"]))).json()
    assert me["username"] == auto_handle


async def test_upgrade_rejects_a_taken_username_with_a_code(client: AsyncClient) -> None:
    await client.post(
        "/auth/register",
        json={
            "email": "holder@example.com",
            "username": "TakenName",
            "password": "super-secret-pw",
        },
    )
    token = await _guest(client)

    r = await client.post(
        "/auth/upgrade",
        json={"email": "new@example.com", "username": "TakenName", "password": "super-secret-pw"},
        headers=_auth(token),
    )
    assert r.status_code == 409
    # A stable CODE, so the client can render it in the player's language
    # (see frontend/src/i18n/errors.ts).
    assert r.json()["detail"] == "username_taken"

    # The failed attempt left the account untouched — still an upgradeable guest.
    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["is_guest"] is True


async def test_upgrade_rejects_a_taken_email_with_a_code(client: AsyncClient) -> None:
    await client.post(
        "/auth/register",
        json={"email": "dupe@example.com", "username": "DupeHolder", "password": "super-secret-pw"},
    )
    token = await _guest(client)

    r = await client.post(
        "/auth/upgrade",
        json={"email": "dupe@example.com", "username": "FreshName", "password": "super-secret-pw"},
        headers=_auth(token),
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "email_taken"


async def test_upgrade_validates_username_length(client: AsyncClient) -> None:
    """Same 3..32 bound as registration — one handle, one rule, whichever door it comes through."""
    token = await _guest(client)
    r = await client.post(
        "/auth/upgrade",
        json={"email": "short@example.com", "username": "ab", "password": "super-secret-pw"},
        headers=_auth(token),
    )
    assert r.status_code == 422
