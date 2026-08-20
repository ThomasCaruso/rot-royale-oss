"""Achievements engine + identity endpoints: earned-on-read badges/titles, equip flows."""

from __future__ import annotations

import itertools
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from app.core.achievements import BADGE_CATALOG, TITLE_CATALOG
from app.models import ContestWindow, Entry, Profile, Standing, User, UserCampaignProgress
from app.models.contest import SETTLED, SUBMITTED
from app.services.achievements import _collect, _requirement_met, earned_map, get_identity
from content.campaign import manifest as cm
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Seeding helpers
# ---------------------------------------------------------------------------

_window_seq = itertools.count()


async def _user(session: AsyncSession) -> User:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(
        Profile(
            user_id=user.id,
            username=f"u{uuid.uuid4().hex[:10]}",
            division="Bronze",
            rating=1000,
            equipped_theme="royale",
        )
    )
    await session.flush()
    return user


async def _window(session: AsyncSession) -> ContestWindow:
    """A settled window with a unique (contest_date, slot)."""
    i = next(_window_seq)
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=date(2030, 1, 1) + timedelta(days=i),
        slot="morning",
        open_at=now - timedelta(hours=6),
        close_at=now - timedelta(hours=1),
        state=SETTLED,
        template_id="t",
    )
    session.add(window)
    await session.flush()
    return window


async def _seed_standing(session: AsyncSession, user_id: uuid.UUID, place: int) -> None:
    window = await _window(session)
    session.add(
        Standing(
            window_id=window.id,
            user_id=user_id,
            place=place,
            field_size=10,
            total_score=500,
            coins_awarded=0,
            rating_before=1000,
            rating_after=1000,
        )
    )
    await session.flush()


async def _seed_ranked_entry(session: AsyncSession, user_id: uuid.UUID) -> None:
    window = await _window(session)
    now = datetime.now(UTC)
    session.add(
        Entry(
            window_id=window.id,
            user_id=user_id,
            seed=1,
            round_set=[],
            started_at=now,
            submitted_at=now,
            total_score=100,
            status=SUBMITTED,
        )
    )
    await session.flush()


async def _seed_practice_entry(session: AsyncSession, user_id: uuid.UUID) -> None:
    """A window-less entry — what practice AND campaign sessions create (is_practice, no window)."""
    now = datetime.now(UTC)
    session.add(
        Entry(
            window_id=None,
            user_id=user_id,
            is_practice=True,
            seed=1,
            round_set=[],
            started_at=now,
            submitted_at=now,
            total_score=100,
            status=SUBMITTED,
        )
    )
    await session.flush()


async def _clear_world(
    session: AsyncSession,
    user_id: uuid.UUID,
    world_key: str,
    status: str = "clear",
    *,
    skip_last: bool = False,
) -> None:
    """Mark every level of a world cleared with the given status (optionally all but the last)."""
    world = cm.get_world(world_key)
    assert world is not None
    levels = world.levels[:-1] if skip_last else world.levels
    for lvl in levels:
        session.add(
            UserCampaignProgress(
                user_id=user_id,
                world=world_key,
                level_number=lvl.level_number,
                best_correct=10,
                clear_status=status,
                first_clear_claimed=True,
                times_cleared=1,
            )
        )
    await session.flush()


# ---------------------------------------------------------------------------
# Catalog pins (ids + requirements are LOCKED — see the Identity V2 plan)
# ---------------------------------------------------------------------------


def test_badge_catalog_pinned():
    assert {a.id: a.requirement for a in BADGE_CATALOG} == {
        "medal_science": "world:Science",
        "medal_history": "world:History",
        "medal_geography": "world:Geography",
        "medal_arts": "world:Arts",
        "medal_sports": "world:Sports",
        "medal_pop": "world:Pop Culture",
        "crown_all": "all_worlds",
        "perfectionist": "perfect_world_any",
        "podium_finisher": "top3:1",
        "first_crown": "first_place:1",
    }
    assert len(BADGE_CATALOG) == 10
    assert all(a.kind == "badge" for a in BADGE_CATALOG)


def test_title_catalog_pinned():
    assert {a.id: a.requirement for a in TITLE_CATALOG} == {
        "crown_chaser": "ranked_entries:1",
        "world_traveler": "worlds_any:3",
        "perfect_clear": "perfect_world_any",
        "podium_regular": "top3:3",
        "champion": "first_place:1",
        "trivia_menace": "all_worlds",
    }
    assert len(TITLE_CATALOG) == 6
    assert all(a.kind == "title" for a in TITLE_CATALOG)


# ---------------------------------------------------------------------------
# Earned engine — each requirement type, earned and not-earned
# ---------------------------------------------------------------------------


async def test_world_badge_requires_every_level(db_session: AsyncSession):
    user = await _user(db_session)
    await _clear_world(db_session, user.id, "Science", skip_last=True)
    earned = await earned_map(db_session, user.id)
    assert not earned["medal_science"]

    world = cm.get_world("Science")
    assert world is not None
    last = world.levels[-1]
    db_session.add(
        UserCampaignProgress(
            user_id=user.id,
            world="Science",
            level_number=last.level_number,
            best_correct=8,
            clear_status="clear",
            first_clear_claimed=True,
            times_cleared=1,
        )
    )
    await db_session.flush()
    earned = await earned_map(db_session, user.id)
    assert earned["medal_science"]
    assert not earned["medal_history"]  # other worlds untouched


async def test_all_worlds_earns_crown_and_menace(db_session: AsyncSession):
    user = await _user(db_session)
    worlds = cm.worlds()
    for w in worlds[:-1]:
        await _clear_world(db_session, user.id, w.world)
    earned = await earned_map(db_session, user.id)
    assert not earned["crown_all"] and not earned["trivia_menace"]

    await _clear_world(db_session, user.id, worlds[-1].world)
    earned = await earned_map(db_session, user.id)
    assert earned["crown_all"] and earned["trivia_menace"]
    # every per-world medal is earned too
    for badge in (
        "medal_science",
        "medal_history",
        "medal_geography",
        "medal_arts",
        "medal_sports",
        "medal_pop",
    ):
        assert earned[badge]


async def test_worlds_any_three(db_session: AsyncSession):
    user = await _user(db_session)
    worlds = cm.worlds()
    await _clear_world(db_session, user.id, worlds[0].world)
    await _clear_world(db_session, user.id, worlds[1].world)
    earned = await earned_map(db_session, user.id)
    assert not earned["world_traveler"]  # 2 of 3

    await _clear_world(db_session, user.id, worlds[2].world)
    earned = await earned_map(db_session, user.id)
    assert earned["world_traveler"]


async def test_perfect_world_any(db_session: AsyncSession):
    user = await _user(db_session)
    # one fully-cleared world but the last level only 'strong' → not perfect
    await _clear_world(db_session, user.id, "History", status="perfect", skip_last=True)
    world = cm.get_world("History")
    assert world is not None
    last = world.levels[-1]
    db_session.add(
        UserCampaignProgress(
            user_id=user.id,
            world="History",
            level_number=last.level_number,
            best_correct=9,
            clear_status="strong",
            first_clear_claimed=True,
            times_cleared=1,
        )
    )
    await db_session.flush()
    earned = await earned_map(db_session, user.id)
    assert not earned["perfectionist"] and not earned["perfect_clear"]
    assert earned["medal_history"]  # world IS cleared, just not perfectly

    # upgrade the last level to perfect → both perfect achievements flip
    row = await db_session.get(UserCampaignProgress, (user.id, "History", last.level_number))
    assert row is not None
    row.clear_status = "perfect"
    await db_session.flush()
    earned = await earned_map(db_session, user.id)
    assert earned["perfectionist"] and earned["perfect_clear"]


async def test_top3_and_first_place_counts(db_session: AsyncSession):
    user = await _user(db_session)
    await _seed_standing(db_session, user.id, place=4)  # off the podium: counts for nothing
    earned = await earned_map(db_session, user.id)
    assert not earned["podium_finisher"] and not earned["first_crown"]
    assert not earned["podium_regular"] and not earned["champion"]

    await _seed_standing(db_session, user.id, place=2)
    earned = await earned_map(db_session, user.id)
    assert earned["podium_finisher"]  # top3:1
    assert not earned["first_crown"] and not earned["champion"]  # place 2 ≠ 1
    assert not earned["podium_regular"]  # top3:3 needs three

    await _seed_standing(db_session, user.id, place=3)
    await _seed_standing(db_session, user.id, place=1)
    earned = await earned_map(db_session, user.id)
    assert earned["podium_regular"]  # three podiums now
    assert earned["first_crown"] and earned["champion"]  # the place-1 row


async def test_ranked_entries_ignore_practice_and_campaign(db_session: AsyncSession):
    user = await _user(db_session)
    await _seed_practice_entry(db_session, user.id)  # practice/campaign shape: no window
    earned = await earned_map(db_session, user.id)
    assert not earned["crown_chaser"]

    await _seed_ranked_entry(db_session, user.id)
    earned = await earned_map(db_session, user.id)
    assert earned["crown_chaser"]


async def test_unknown_or_malformed_requirements_never_earned(db_session: AsyncSession):
    user = await _user(db_session)
    await _seed_ranked_entry(db_session, user.id)
    agg = await _collect(db_session, user.id)
    assert not _requirement_met("bogus", agg)
    assert not _requirement_met("worlds_any:x", agg)  # non-int n
    assert not _requirement_met("top3:0", agg)  # n must be positive
    assert not _requirement_met("world:Atlantis", agg)  # unknown world key
    assert _requirement_met("ranked_entries:1", agg)  # sanity: the grammar does work


async def test_cold_user_earns_nothing(db_session: AsyncSession):
    user = await _user(db_session)
    earned = await earned_map(db_session, user.id)
    assert set(earned) == {a.id for a in (*BADGE_CATALOG, *TITLE_CATALOG)}  # all 16 covered
    assert not any(earned.values())


async def test_get_identity_service_shapes(db_session: AsyncSession):
    user = await _user(db_session)
    await _clear_world(db_session, user.id, "Science")
    profile = await db_session.get(Profile, user.id)
    assert profile is not None
    profile.equipped_badges = ["medal_science"]
    await db_session.flush()

    badges, titles = await get_identity(db_session, user.id)
    assert [b.id for b in badges] == [a.id for a in BADGE_CATALOG]
    assert [t.id for t in titles] == [a.id for a in TITLE_CATALOG]
    by_id = {b.id: b for b in badges}
    assert by_id["medal_science"].earned and by_id["medal_science"].equipped
    assert not by_id["medal_history"].earned and not by_id["medal_history"].equipped
    assert all(not t.equipped for t in titles)


# ---------------------------------------------------------------------------
# API half (httpx client fixture; auth helper pattern from test_vault.py)
# ---------------------------------------------------------------------------


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register_and_login(client) -> tuple[str, uuid.UUID]:
    email = f"{uuid.uuid4().hex}@achievements.example.com"
    username = f"a{uuid.uuid4().hex[:10]}"
    r = await client.post(
        "/auth/register",
        json={"email": email, "username": username, "password": "super-secret-pw"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    me = (await client.get("/me", headers=_auth(token))).json()
    return token, uuid.UUID(me["user_id"])


@pytest.mark.asyncio
async def test_identity_endpoint_cold_user(client):
    token, _ = await _register_and_login(client)
    r = await client.get("/identity", headers=_auth(token))
    assert r.status_code == 200
    body = r.json()
    assert [b["id"] for b in body["badges"]] == [a.id for a in BADGE_CATALOG]
    assert [t["id"] for t in body["titles"]] == [a.id for a in TITLE_CATALOG]
    for item in (*body["badges"], *body["titles"]):
        assert item["earned"] is False and item["equipped"] is False


@pytest.mark.asyncio
async def test_identity_endpoint_requires_auth(client):
    assert (await client.get("/identity")).status_code == 401


@pytest.mark.asyncio
async def test_identity_endpoint_decorated_user(client, db_session: AsyncSession):
    token, user_id = await _register_and_login(client)
    await _clear_world(db_session, user_id, "Science")
    await _seed_standing(db_session, user_id, place=1)

    r = await client.patch(
        "/me/badges", json={"badge_ids": ["medal_science", "first_crown"]}, headers=_auth(token)
    )
    assert r.status_code == 200
    r = await client.patch("/me/title", json={"title_id": "champion"}, headers=_auth(token))
    assert r.status_code == 200

    body = (await client.get("/identity", headers=_auth(token))).json()
    badges = {b["id"]: b for b in body["badges"]}
    titles = {t["id"]: t for t in body["titles"]}
    assert badges["medal_science"] == {"id": "medal_science", "earned": True, "equipped": True}
    assert badges["first_crown"] == {"id": "first_crown", "earned": True, "equipped": True}
    assert badges["podium_finisher"]["earned"] and not badges["podium_finisher"]["equipped"]
    assert badges["medal_history"] == {"id": "medal_history", "earned": False, "equipped": False}
    assert titles["champion"] == {"id": "champion", "earned": True, "equipped": True}
    assert titles["crown_chaser"] == {"id": "crown_chaser", "earned": False, "equipped": False}


@pytest.mark.asyncio
async def test_patch_badges_happy_path_preserves_order(client, db_session: AsyncSession):
    token, user_id = await _register_and_login(client)
    for w in cm.worlds():
        await _clear_world(db_session, user_id, w.world)

    pick = ["medal_pop", "crown_all", "medal_science"]  # deliberately NOT catalog order
    r = await client.patch("/me/badges", json={"badge_ids": pick}, headers=_auth(token))
    assert r.status_code == 200
    assert r.json() == {"equipped_badges": pick}

    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["equipped_badges"] == pick

    # the empty pick clears everything
    r = await client.patch("/me/badges", json={"badge_ids": []}, headers=_auth(token))
    assert r.status_code == 200 and r.json() == {"equipped_badges": []}
    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["equipped_badges"] == []


@pytest.mark.asyncio
async def test_patch_badges_unknown_returns_422(client):
    token, _ = await _register_and_login(client)
    r = await client.patch(
        "/me/badges", json={"badge_ids": ["medal_unicorn"]}, headers=_auth(token)
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "unknown_badge"


@pytest.mark.asyncio
async def test_patch_badges_four_returns_400_too_many(client, db_session: AsyncSession):
    token, user_id = await _register_and_login(client)
    for w in cm.worlds():
        await _clear_world(db_session, user_id, w.world)
    r = await client.patch(
        "/me/badges",
        json={"badge_ids": ["medal_science", "medal_history", "medal_geography", "medal_arts"]},
        headers=_auth(token),
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "too_many_badges"
    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["equipped_badges"] == []  # nothing changed


@pytest.mark.asyncio
async def test_patch_badges_duplicate_returns_400(client, db_session: AsyncSession):
    token, user_id = await _register_and_login(client)
    await _clear_world(db_session, user_id, "Science")
    r = await client.patch(
        "/me/badges", json={"badge_ids": ["medal_science", "medal_science"]}, headers=_auth(token)
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "duplicate_badge"


@pytest.mark.asyncio
async def test_patch_badges_unearned_returns_403(client):
    token, _ = await _register_and_login(client)
    r = await client.patch(
        "/me/badges", json={"badge_ids": ["medal_science"]}, headers=_auth(token)
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "not_earned"
    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["equipped_badges"] == []


@pytest.mark.asyncio
async def test_patch_title_happy_and_clear_to_null(client, db_session: AsyncSession):
    token, user_id = await _register_and_login(client)
    await _seed_standing(db_session, user_id, place=1)

    r = await client.patch("/me/title", json={"title_id": "champion"}, headers=_auth(token))
    assert r.status_code == 200
    assert r.json() == {"equipped_title": "champion"}
    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["equipped_title"] == "champion"

    r = await client.patch("/me/title", json={"title_id": None}, headers=_auth(token))
    assert r.status_code == 200
    assert r.json() == {"equipped_title": None}
    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["equipped_title"] is None


@pytest.mark.asyncio
async def test_patch_title_unknown_returns_422(client):
    token, _ = await _register_and_login(client)
    r = await client.patch("/me/title", json={"title_id": "supreme_being"}, headers=_auth(token))
    assert r.status_code == 422
    assert r.json()["detail"] == "unknown_title"


@pytest.mark.asyncio
async def test_patch_title_unearned_returns_403(client):
    token, _ = await _register_and_login(client)
    r = await client.patch("/me/title", json={"title_id": "champion"}, headers=_auth(token))
    assert r.status_code == 403
    assert r.json()["detail"] == "not_earned"
    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["equipped_title"] is None


@pytest.mark.asyncio
async def test_me_carries_identity_fields_for_cold_user(client):
    token, _ = await _register_and_login(client)
    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["equipped_badges"] == []
    assert me["equipped_title"] is None


@pytest.mark.asyncio
async def test_equipping_never_touches_anything_competitive(client, db_session: AsyncSession):
    """The fairness contract: equipping badges/titles changes the pick and nothing else."""
    token, user_id = await _register_and_login(client)
    await _clear_world(db_session, user_id, "Science")
    await _seed_standing(db_session, user_id, place=1)

    before = await db_session.get(Profile, user_id)
    assert before is not None
    snapshot = (
        before.rating,
        before.division,
        before.streak_count,
        before.coins_balance,
        before.sharpness,
    )
    standings_before = (
        await db_session.execute(select(func.count()).select_from(Standing))
    ).scalar_one()

    r = await client.patch(
        "/me/badges", json={"badge_ids": ["medal_science", "first_crown"]}, headers=_auth(token)
    )
    assert r.status_code == 200
    r = await client.patch("/me/title", json={"title_id": "champion"}, headers=_auth(token))
    assert r.status_code == 200

    after = await db_session.get(Profile, user_id)
    assert after is not None
    assert (
        after.rating,
        after.division,
        after.streak_count,
        after.coins_balance,
        after.sharpness,
    ) == snapshot
    standings_after = (
        await db_session.execute(select(func.count()).select_from(Standing))
    ).scalar_one()
    assert standings_after == standings_before
