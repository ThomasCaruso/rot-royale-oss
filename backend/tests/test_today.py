"""Today Command Center aggregate (GET /me/today) + chest claim endpoint (POST /missions/claim).

Pure helpers (next streak milestone, next-unlock pick) are unit-tested directly; the endpoints are
covered for shape, auth-gated wiring, the not-eligible guard, and claim idempotency.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from app.core.timezone import ET, window_bounds_utc
from app.models import ContestWindow, DuelMatch, Entry, Profile
from app.models.contest import CLOSED, SUBMITTED
from app.services.missions import weekday_reward
from app.services.today import next_streak_milestone, pick_next_unlock
from app.services.vault import VaultItemView
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register", json={"email": email, "username": username, "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _user_id(session: AsyncSession) -> uuid.UUID:
    return await session.scalar(select(Profile.user_id).limit(1))


# ---------------- pure helpers ----------------
def test_next_streak_milestone():
    assert next_streak_milestone(0) == 3
    assert next_streak_milestone(2) == 3
    assert next_streak_milestone(3) == 5
    assert next_streak_milestone(4) == 5
    assert next_streak_milestone(5) == 7
    assert next_streak_milestone(7) is None  # past the last rung
    assert next_streak_milestone(12) is None


def _item(
    id, kind, cost, currency, *, owned=False, locked=False, coming_soon=False
) -> VaultItemView:
    return VaultItemView(
        id=id,
        kind=kind,
        cost=cost,
        currency=currency,
        owned=owned,
        equipped=False,
        locked=locked,
        coming_soon=coming_soon,
        requirement=None,
    )


def test_pick_next_unlock_prefers_closest_then_cheapest():
    items = [
        _item("royale", "theme", 0, "coins", owned=True),
        _item("bronze_ring", "frame", 60, "coins"),
        _item("violet_duel_frame", "frame", 25, "gems"),
        _item("science_orbit", "frame", 150, "coins", locked=True),  # requirement-locked → skip
    ]
    # With 50 coins the player is closest to bronze_ring (50/60) → surfaced over the 0-progress gem.
    pick = pick_next_unlock(items, coins=50, gems=0)
    assert pick is not None and pick.id == "bronze_ring"
    assert pick.remaining == 10

    # With nothing, all progress 0 → tie broken by cheapest cost (the 25-gem frame).
    pick0 = pick_next_unlock(items, coins=0, gems=0)
    assert pick0 is not None and pick0.id == "violet_duel_frame"

    # Locked/owned-only catalog → no goal to surface.
    assert pick_next_unlock([items[0], items[3]], coins=0, gems=0) is None


# ---------------- GET /me/today ----------------
async def test_me_today_shape(client: AsyncClient):
    token = await _register(client, "today1@example.com", "todayone")
    r = await client.get("/me/today", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()

    # status strip
    assert body["status"]["duel_tier"] == "bronze"
    assert body["status"]["streak_count"] == 0

    # missions: three, none done, chest in progress
    assert [m["id"] for m in body["missions"]["missions"]] == [
        "play_royale",
        "complete_duel",
        "clear_campaign",
    ]
    assert body["missions"]["completed_count"] == 0
    assert body["missions"]["chest_state"] == "in_progress"
    assert body["missions"]["required"] == 2

    # streak ladder: next milestone is day 3 for a fresh streak
    assert body["streak"]["current"] == 0
    assert body["streak"]["next_milestone"] == 3
    assert body["streak"]["next_reward"]["gems"] == 1

    # campaign next step: first world, level 1 (unlocked, uncleared)
    assert body["campaign_next"] is not None
    assert body["campaign_next"]["level_number"] == 1

    # next unlock: a cost-gated cosmetic goal exists for a fresh wallet
    assert body["next_unlock"] is not None
    assert body["next_unlock"]["cost"] > 0


async def test_me_today_requires_auth(client: AsyncClient):
    r = await client.get("/me/today")
    assert r.status_code == 401


# ---------------- POST /missions/claim ----------------
async def _seed_two_missions_today(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Insert a SUBMITTED royale entry + a completed duel for the REAL ET day (what the live
    endpoint scopes to), satisfying 2 of 3 missions."""
    today = datetime.now(UTC).astimezone(ET).date()
    open_at, close_at = window_bounds_utc(today, "royale")
    w = ContestWindow(
        contest_date=today,
        slot="royale",
        open_at=open_at,
        close_at=close_at,
        state=CLOSED,
        template_id="dr_8_trivia",
    )
    session.add(w)
    await session.flush()
    session.add(
        Entry(
            window_id=w.id,
            user_id=user_id,
            seed=1,
            round_set=[],
            started_at=datetime.now(UTC),
            submitted_at=datetime.now(UTC),
            total_score=500,
            status=SUBMITTED,
        )
    )
    duel_entry = Entry(
        window_id=None,
        user_id=user_id,
        is_practice=True,
        seed=2,
        round_set=[],
        started_at=datetime.now(UTC),
        status="IN_PROGRESS",
    )
    session.add(duel_entry)
    await session.flush()
    session.add(
        DuelMatch(
            user_id=user_id,
            entry_id=duel_entry.id,
            duel_type="training",
            seed=3,
            rival_run=[],
            status="completed",
            contest_date=today,
        )
    )
    await session.flush()


async def test_claim_endpoint_rejects_when_not_eligible(client: AsyncClient):
    token = await _register(client, "claimno@example.com", "claimno")
    r = await client.post("/missions/claim", headers=_auth(token))
    assert r.status_code == 400
    assert r.json()["detail"] == "not_eligible"


async def test_claim_endpoint_grants_once(client: AsyncClient, db_session: AsyncSession):
    token = await _register(client, "claimyes@example.com", "claimyes")
    uid = await _user_id(db_session)
    await _seed_two_missions_today(db_session, uid)

    today = datetime.now(UTC).astimezone(ET).date()
    reward = weekday_reward(today)

    r = await client.post("/missions/claim", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["already_claimed"] is False
    assert body["coins_awarded"] == reward.coins
    assert body["gems_awarded"] == reward.gems
    assert body["coins_balance"] == reward.coins
    assert body["gems_balance"] == reward.gems
    assert body["missions"]["chest_state"] == "claimed"

    # Idempotent: a second claim re-reports the grant without paying again.
    r2 = await client.post("/missions/claim", headers=_auth(token))
    assert r2.status_code == 200, r2.text
    assert r2.json()["already_claimed"] is True
    assert r2.json()["coins_balance"] == reward.coins
    assert r2.json()["gems_balance"] == reward.gems
