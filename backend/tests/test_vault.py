"""Vault service + API: purchases spend through the ledger, grant user_themes, never touch rank."""

from __future__ import annotations

import uuid

import pytest
from app.models import (
    CoinLedger,
    GemLedger,
    Profile,
    Standing,
    User,
    UserCampaignProgress,
    UserCosmetic,
    UserTheme,
)
from app.services.gem_ledger import InsufficientGemsError, record_gem_delta
from app.services.ledger import record_coin_delta
from app.services.vault import (
    AlreadyOwnedError,
    InsufficientCoinsError,
    NotOwnedError,
    RequirementNotMetError,
    buy_item,
    equip_item,
    get_vault,
)
from content.campaign import manifest as cm
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def _user(session: AsyncSession, *, coins: int = 0, gems: int = 0) -> User:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(
        Profile(
            user_id=user.id,
            username=f"u{uuid.uuid4().hex[:10]}",
            division="Bronze",
            rating=1000,
            equipped_theme="royale",  # mirrors registration (DEFAULT_THEME_ID)
        )
    )
    session.add(UserTheme(user_id=user.id, theme_id="royale"))  # mirrors registration
    await session.flush()
    if coins:
        await record_coin_delta(session, user.id, coins, "signup_bonus")
    if gems:
        await record_gem_delta(session, user.id, gems, "test")
    return user


async def _gem_ledger_rows(session: AsyncSession, user_id: uuid.UUID) -> list[GemLedger]:
    return list(
        (await session.execute(select(GemLedger).where(GemLedger.user_id == user_id))).scalars()
    )


async def _ledger_rows(session: AsyncSession, user_id: uuid.UUID) -> list[CoinLedger]:
    return list(
        (await session.execute(select(CoinLedger).where(CoinLedger.user_id == user_id))).scalars()
    )


async def test_buy_spends_through_ledger_and_grants_ownership(db_session: AsyncSession):
    user = await _user(db_session, coins=1000)
    coins_balance, gems_balance = await buy_item(db_session, user.id, "gold_crown")
    assert coins_balance == 850 and gems_balance == 0

    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.coins_balance == 850
    assert await db_session.get(UserCosmetic, (user.id, "gold_crown")) is not None

    rows = await _ledger_rows(db_session, user.id)
    purchase = [r for r in rows if r.reason.endswith("_purchase")]
    assert len(purchase) == 1
    assert purchase[0].delta == -150
    assert purchase[0].ref_type == "frame" and purchase[0].ref_key == "gold_crown"
    # invariant: cache equals ledger sum
    total = sum(r.delta for r in rows)
    assert profile.coins_balance == total


async def test_buy_insufficient_coins_changes_nothing(db_session: AsyncSession):
    user = await _user(db_session, coins=100)  # gold_crown is 150 — short by 50
    with pytest.raises(InsufficientCoinsError):
        await buy_item(db_session, user.id, "gold_crown")
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.coins_balance == 100  # untouched
    assert await db_session.get(UserCosmetic, (user.id, "gold_crown")) is None
    assert all(not r.reason.endswith("_purchase") for r in await _ledger_rows(db_session, user.id))


async def test_buy_twice_raises_already_owned_and_never_double_debits(db_session: AsyncSession):
    user = await _user(db_session, coins=1000)
    await buy_item(db_session, user.id, "gold_crown")
    with pytest.raises(AlreadyOwnedError):
        await buy_item(db_session, user.id, "gold_crown")
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.coins_balance == 850  # debited exactly once


async def test_free_items_are_implicitly_owned_not_buyable(db_session: AsyncSession):
    user = await _user(db_session, coins=100)
    with pytest.raises(AlreadyOwnedError):
        await buy_item(db_session, user.id, "blank_light")


async def test_gated_item_raises_requirement_not_met(db_session: AsyncSession, monkeypatch):
    from app.core import cosmetics

    gated = cosmetics.CosmeticItem(id="gated", kind="theme", cost=10, requirement="world:Science")
    monkeypatch.setitem(cosmetics.CATALOG_BY_ID, "gated", gated)
    user = await _user(db_session, coins=100)
    with pytest.raises(RequirementNotMetError):
        await buy_item(db_session, user.id, "gated")


async def test_equip_owned_and_free_themes(db_session: AsyncSession):
    user = await _user(db_session, coins=1000)
    await buy_item(db_session, user.id, "gold_crown")
    assert (await equip_item(db_session, user.id, "gold_crown")).equipped_frame == "gold_crown"
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.equipped_frame == "gold_crown"
    # free theme equips without an ownership row
    assert (await equip_item(db_session, user.id, "blank_light")).equipped_theme == "blank_light"


async def test_equip_unowned_paid_theme_raises(db_session: AsyncSession):
    user = await _user(db_session)
    with pytest.raises(NotOwnedError):
        await equip_item(db_session, user.id, "gold_crown")


async def test_purchase_never_touches_rank_or_standings(db_session: AsyncSession):
    """The fairness contract: buying cosmetics changes coins_balance and nothing else."""
    user = await _user(db_session, coins=1000)
    before = await db_session.get(Profile, user.id)
    assert before is not None
    rating, division, streak = before.rating, before.division, before.streak_count

    await buy_item(db_session, user.id, "gold_crown")

    after = await db_session.get(Profile, user.id)
    assert after is not None
    assert (after.rating, after.division, after.streak_count) == (rating, division, streak)
    standings = (await db_session.execute(select(func.count()).select_from(Standing))).scalar_one()
    assert standings == 0


async def test_get_vault_reports_owned_equipped_and_locked(db_session: AsyncSession):
    user = await _user(db_session, coins=1000)
    await buy_item(db_session, user.id, "gold_crown")

    items, balance, gems = await get_vault(db_session, user.id)
    assert balance == 850 and gems == 0
    by_id = {i.id: i for i in items}
    assert by_id["royale"].owned and by_id["royale"].equipped  # registration default
    assert (
        by_id["blank_light"].owned and not by_id["blank_light"].equipped
    )  # free = implicitly owned
    assert not by_id["bubblegum"].owned and by_id["bubblegum"].cost == 400
    # Coin-priced/free ungated themes are never locked; requirement-gated (earned-only) themes are
    # locked for a cold user (champion=all_worlds, apex=division:Apex, daylight=royales:7).
    # Nothing in the live catalog is held back as coming-soon.
    assert not by_id["bubblegum"].locked and not by_id["bubblegum"].coming_soon
    assert not by_id["midnight"].locked and not by_id["midnight"].coming_soon
    assert by_id["champion"].locked and by_id["apex"].locked
    assert by_id["daylight"].locked and not by_id["daylight"].owned  # gated on 7 Daily Royales


async def test_get_vault_cold_start_user_has_zero_balance_and_defaults(db_session: AsyncSession):
    """A brand-new user (zero ledger rows) sees balance 0, royale owned+equipped, paid unowned."""
    user = await _user(db_session)  # no coins seeded → zero ledger rows
    items, balance, gems = await get_vault(db_session, user.id)
    assert balance == 0 and gems == 0
    by_id = {i.id: i for i in items}
    assert by_id["royale"].owned and by_id["royale"].equipped
    assert by_id["blank_light"].owned and not by_id["blank_light"].equipped
    assert by_id["daylight"].locked and not by_id["daylight"].owned  # gated on 7 Daily Royales
    assert all(not by_id[paid].owned for paid in ("bubblegum", "forest", "midnight"))


# --- frames (identity v1): campaign-gated requirements, user_cosmetics ownership ---


async def _clear_world_levels(
    session: AsyncSession, user_id: uuid.UUID, world_key: str, level_numbers: list[int]
) -> None:
    """Seed user_campaign_progress rows marking the given levels of a world CLEARED."""
    for n in level_numbers:
        session.add(
            UserCampaignProgress(
                user_id=user_id,
                world=world_key,
                level_number=n,
                best_correct=8,
                clear_status="clear",
                first_clear_claimed=True,
                times_cleared=1,
            )
        )
    await session.flush()


async def test_buy_frame_spends_through_ledger_and_grants_cosmetic(db_session: AsyncSession):
    user = await _user(db_session, coins=200)
    coins_balance, gems_balance = await buy_item(db_session, user.id, "bronze_ring")
    assert coins_balance == 140 and gems_balance == 0

    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.coins_balance == 140
    cosmetic = await db_session.get(UserCosmetic, (user.id, "bronze_ring"))
    assert cosmetic is not None and cosmetic.kind == "frame"
    # frames never land in the themes table
    assert await db_session.get(UserTheme, (user.id, "bronze_ring")) is None

    rows = await _ledger_rows(db_session, user.id)
    purchase = [r for r in rows if r.reason == "frame_purchase"]
    assert len(purchase) == 1
    assert purchase[0].delta == -60
    assert purchase[0].ref_type == "frame" and purchase[0].ref_key == "bronze_ring"
    # invariant: cache equals ledger sum
    assert profile.coins_balance == sum(r.delta for r in rows)


async def test_buy_frame_twice_raises_already_owned_and_never_double_debits(
    db_session: AsyncSession,
):
    user = await _user(db_session, coins=200)
    await buy_item(db_session, user.id, "bronze_ring")
    with pytest.raises(AlreadyOwnedError):
        await buy_item(db_session, user.id, "bronze_ring")
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.coins_balance == 140  # debited exactly once


async def test_equip_frame_and_clear_with_frame_none(db_session: AsyncSession):
    user = await _user(db_session, coins=100)
    await buy_item(db_session, user.id, "bronze_ring")

    profile = await equip_item(db_session, user.id, "bronze_ring")
    assert profile.equipped_frame == "bronze_ring"
    assert profile.equipped_theme == "royale"  # theme slot untouched by a frame equip
    items, _, _ = await get_vault(db_session, user.id)
    by_id = {i.id: i for i in items}
    assert by_id["bronze_ring"].equipped and not by_id["frame_none"].equipped

    # frame_none is the unequip sentinel: clears the slot to NULL
    profile = await equip_item(db_session, user.id, "frame_none")
    assert profile.equipped_frame is None
    items, _, _ = await get_vault(db_session, user.id)
    by_id = {i.id: i for i in items}
    assert by_id["frame_none"].equipped and not by_id["bronze_ring"].equipped


async def test_equip_unowned_paid_frame_raises(db_session: AsyncSession):
    user = await _user(db_session)
    with pytest.raises(NotOwnedError):
        await equip_item(db_session, user.id, "bronze_ring")


async def test_gated_frame_unlocks_only_after_full_world_completion(db_session: AsyncSession):
    user = await _user(db_session, coins=300)
    world = cm.get_world("Science")  # the real manifest key behind science_orbit's requirement
    assert world is not None
    level_numbers = [lvl.level_number for lvl in world.levels]

    # before any progress: locked + buy refused
    items, _, _ = await get_vault(db_session, user.id)
    by_id = {i.id: i for i in items}
    assert by_id["science_orbit"].locked and not by_id["science_orbit"].owned
    with pytest.raises(RequirementNotMetError):
        await buy_item(db_session, user.id, "science_orbit")

    # all levels but the last cleared, last level attempted-but-failed (clear_status NULL):
    # still locked — EVERY level must be cleared, and a NULL clear_status doesn't count.
    await _clear_world_levels(db_session, user.id, world.world, level_numbers[:-1])
    db_session.add(
        UserCampaignProgress(
            user_id=user.id,
            world=world.world,
            level_number=level_numbers[-1],
            best_correct=3,
            clear_status=None,
            first_clear_claimed=False,
            times_cleared=0,
        )
    )
    await db_session.flush()
    items, _, _ = await get_vault(db_session, user.id)
    assert {i.id: i for i in items}["science_orbit"].locked
    with pytest.raises(RequirementNotMetError):
        await buy_item(db_session, user.id, "science_orbit")

    # clear the last level → unlocked and buyable
    last = await db_session.get(UserCampaignProgress, (user.id, world.world, level_numbers[-1]))
    assert last is not None
    last.clear_status = "clear"
    await db_session.flush()

    items, _, _ = await get_vault(db_session, user.id)
    item = {i.id: i for i in items}["science_orbit"]
    assert not item.locked and not item.owned  # unlocked, still must be purchased
    coins_balance, _ = await buy_item(db_session, user.id, "science_orbit")
    assert coins_balance == 150
    cosmetic = await db_session.get(UserCosmetic, (user.id, "science_orbit"))
    assert cosmetic is not None and cosmetic.kind == "frame"


async def test_crowned_scholar_implicitly_owned_only_after_all_worlds(db_session: AsyncSession):
    user = await _user(db_session, coins=50)

    # fresh user: locked, NOT owned (cost 0 alone is not enough — requirement must be met too)
    items, _, _ = await get_vault(db_session, user.id)
    item = {i.id: i for i in items}["crowned_scholar"]
    assert item.locked and not item.owned and item.cost == 0
    with pytest.raises(NotOwnedError):
        await equip_item(db_session, user.id, "crowned_scholar")
    with pytest.raises(RequirementNotMetError):
        await buy_item(db_session, user.id, "crowned_scholar")

    # complete every world in the manifest
    for w in cm.worlds():
        await _clear_world_levels(
            db_session, user.id, w.world, [lvl.level_number for lvl in w.levels]
        )

    items, _, _ = await get_vault(db_session, user.id)
    item = {i.id: i for i in items}["crowned_scholar"]
    assert item.owned and not item.locked  # implicitly owned: cost 0 AND requirement met
    profile = await equip_item(db_session, user.id, "crowned_scholar")
    assert profile.equipped_frame == "crowned_scholar"
    with pytest.raises(AlreadyOwnedError):
        await buy_item(db_session, user.id, "crowned_scholar")

    # nothing was ever debited for it
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.coins_balance == 50
    assert all(r.reason != "frame_purchase" for r in await _ledger_rows(db_session, user.id))


async def test_frame_purchase_never_touches_rank_or_standings(db_session: AsyncSession):
    """The fairness contract holds for frames too: a buy changes coins_balance and nothing else."""
    user = await _user(db_session, coins=200)
    before = await db_session.get(Profile, user.id)
    assert before is not None
    rating, division, streak = before.rating, before.division, before.streak_count

    await buy_item(db_session, user.id, "bronze_ring")

    after = await db_session.get(Profile, user.id)
    assert after is not None
    assert (after.rating, after.division, after.streak_count) == (rating, division, streak)
    standings = (await db_session.execute(select(func.count()).select_from(Standing))).scalar_one()
    assert standings == 0


async def test_get_vault_cold_user_frame_states(db_session: AsyncSession):
    """Fresh user: frame_none equipped+owned, paid frames unowned, gated frames locked,
    themes section unchanged."""
    user = await _user(db_session)
    items, _, _ = await get_vault(db_session, user.id)
    by_id = {i.id: i for i in items}

    none = by_id["frame_none"]
    assert none.kind == "frame" and none.owned and none.equipped and not none.locked
    for paid in ("bronze_ring", "violet_glow", "gold_crown"):
        assert not by_id[paid].owned and not by_id[paid].locked and not by_id[paid].equipped
    gated = (
        "science_orbit",
        "history_relic",
        "geo_compass",
        "arts_brush",
        "sports_champion",
        "pop_neon",
    )
    for frame in gated:
        assert by_id[frame].locked and not by_id[frame].owned
        assert by_id[frame].requirement is not None
    assert by_id["crowned_scholar"].locked and not by_id["crowned_scholar"].owned
    # themes section unchanged by the frames feature
    assert by_id["royale"].kind == "theme" and by_id["royale"].owned and by_id["royale"].equipped
    assert by_id["blank_light"].owned and not by_id["blank_light"].equipped
    assert not by_id["midnight"].owned and not by_id["midnight"].locked


# --- gem-priced frames (duel economy): debit the GEM ledger, never the coin ledger ---


async def test_buy_gem_frame_debits_gem_ledger_and_grants_cosmetic(db_session: AsyncSession):
    user = await _user(db_session, coins=200, gems=100)
    coins_balance, gems_balance = await buy_item(db_session, user.id, "violet_duel_frame")
    assert coins_balance == 200  # coins UNTOUCHED
    assert gems_balance == 75  # 100 - 25

    profile = await db_session.get(Profile, user.id)
    assert profile is not None
    assert profile.coins_balance == 200 and profile.gems_balance == 75

    # ownership granted in user_cosmetics, equippable
    cosmetic = await db_session.get(UserCosmetic, (user.id, "violet_duel_frame"))
    assert cosmetic is not None and cosmetic.kind == "frame"
    profile = await equip_item(db_session, user.id, "violet_duel_frame")
    assert profile.equipped_frame == "violet_duel_frame"

    # a gem_ledger frame_purchase row of -25; NO coin_ledger purchase row
    gem_rows = await _gem_ledger_rows(db_session, user.id)
    purchase = [r for r in gem_rows if r.reason == "frame_purchase"]
    assert len(purchase) == 1
    assert purchase[0].delta == -25
    assert purchase[0].ref_type == "frame" and purchase[0].ref_key == "violet_duel_frame"
    # gem cache equals gem ledger sum
    assert profile.gems_balance == sum(r.delta for r in gem_rows)
    # no coin ledger movement for the gem purchase
    assert all(r.reason != "frame_purchase" for r in await _ledger_rows(db_session, user.id))


async def test_buy_gem_frame_insufficient_gems_raises_and_changes_nothing(db_session: AsyncSession):
    user = await _user(db_session, coins=200, gems=20)  # 20 < 25
    with pytest.raises(InsufficientGemsError):
        await buy_item(db_session, user.id, "violet_duel_frame")
    profile = await db_session.get(Profile, user.id)
    assert profile is not None
    assert profile.gems_balance == 20 and profile.coins_balance == 200
    assert await db_session.get(UserCosmetic, (user.id, "violet_duel_frame")) is None
    assert all(r.reason != "frame_purchase" for r in await _gem_ledger_rows(db_session, user.id))


async def test_buy_gem_frame_twice_raises_already_owned_and_debits_once(db_session: AsyncSession):
    user = await _user(db_session, gems=100)
    await buy_item(db_session, user.id, "crown_duel_frame")  # -60
    with pytest.raises(AlreadyOwnedError):
        await buy_item(db_session, user.id, "crown_duel_frame")
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.gems_balance == 40  # debited exactly once


# --- API half (httpx client fixture; auth helper pattern from test_campaign.py) ---


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register_and_login(client) -> tuple[str, uuid.UUID]:
    """Register a unique user, return (token, user_id)."""
    email = f"{uuid.uuid4().hex}@vault.example.com"
    username = f"v{uuid.uuid4().hex[:10]}"
    r = await client.post(
        "/auth/register",
        json={"email": email, "username": username, "password": "super-secret-pw"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    me = (await client.get("/me", headers=_auth(token))).json()
    user_id = uuid.UUID(me["user_id"])
    return token, user_id


@pytest.mark.asyncio
async def test_vault_endpoints_full_flow(client, db_session: AsyncSession):
    token, user_id = await _register_and_login(client)

    # seed coins the way campaign would
    await record_coin_delta(db_session, user_id, 1000, "campaign_first_clear")

    # GET /vault
    r = await client.get("/vault", headers=_auth(token))
    assert r.status_code == 200
    body = r.json()
    assert body["coins_balance"] == 1000
    assert body["gems_balance"] == 0
    by_id = {i["id"]: i for i in body["items"]}
    # The whole catalog is live (nothing coming-soon): a coin-priced ungated theme is surfaced at
    # its real price, unlocked and buyable.
    assert by_id["midnight"] == {
        "id": "midnight",
        "kind": "theme",
        "cost": 900,
        "currency": "coins",
        "owned": False,
        "equipped": False,
        "locked": False,
        "coming_soon": False,
        "requirement": None,
    }
    # The server still REFUSES to sell an earned-only theme before the feat is done, so the UI's
    # gating is not the only thing stopping a grant (403 = requirement not met).
    assert (await client.post("/vault/champion/buy", headers=_auth(token))).status_code == 403

    # buy a released item
    r = await client.post("/vault/gold_crown/buy", headers=_auth(token))
    assert r.status_code == 200
    assert r.json() == {
        "item_id": "gold_crown",
        "currency": "coins",
        "coins_balance": 850,
        "gems_balance": 0,
    }

    # buy again → 409
    r = await client.post("/vault/gold_crown/buy", headers=_auth(token))
    assert r.status_code == 409

    # unknown ids → 404
    assert (await client.post("/vault/nope/buy", headers=_auth(token))).status_code == 404
    assert (await client.post("/vault/nope/equip", headers=_auth(token))).status_code == 404

    # equip owned → 200 with BOTH equipped slots, and /me reflects it
    r = await client.post("/vault/gold_crown/equip", headers=_auth(token))
    assert r.status_code == 200
    assert r.json() == {"equipped_theme": "starter", "equipped_frame": "gold_crown"}
    me = (await client.get("/me", headers=_auth(token))).json()
    assert me["equipped_frame"] == "gold_crown" and me["coins_balance"] == 850

    # equip an unowned paid theme → 403
    r = await client.post("/vault/forest/equip", headers=_auth(token))
    assert r.status_code == 403 and r.json()["detail"] == "not_owned"


@pytest.mark.asyncio
async def test_vault_requirement_gated_buy_returns_403(
    client, db_session: AsyncSession, monkeypatch
):
    """Gated item → 403 requirement_not_met (requirement not met by player)."""
    from app.core import cosmetics

    gated = cosmetics.CosmeticItem(
        id="gated_api", kind="theme", cost=10, requirement="world:Science"
    )
    monkeypatch.setitem(cosmetics.CATALOG_BY_ID, "gated_api", gated)

    token, user_id = await _register_and_login(client)
    await record_coin_delta(db_session, user_id, 100, "signup_bonus")

    r = await client.post("/vault/gated_api/buy", headers=_auth(token))
    assert r.status_code == 403
    assert r.json()["detail"] == "requirement_not_met"


@pytest.mark.asyncio
async def test_vault_frame_api_flow(client, db_session: AsyncSession):
    """Frames over the wire: same machine-readable error codes, EquipResponse carries both slots."""
    token, user_id = await _register_and_login(client)
    await record_coin_delta(db_session, user_id, 100, "campaign_first_clear")

    # equip an unowned paid frame → 403 not_owned
    r = await client.post("/vault/bronze_ring/equip", headers=_auth(token))
    assert r.status_code == 403 and r.json()["detail"] == "not_owned"

    # campaign-gated frame before completion → 403 requirement_not_met
    r = await client.post("/vault/science_orbit/buy", headers=_auth(token))
    assert r.status_code == 403 and r.json()["detail"] == "requirement_not_met"

    # buy + equip → both equipped slots in the response
    r = await client.post("/vault/bronze_ring/buy", headers=_auth(token))
    assert r.status_code == 200
    assert r.json() == {
        "item_id": "bronze_ring",
        "currency": "coins",
        "coins_balance": 40,
        "gems_balance": 0,
    }
    r = await client.post("/vault/bronze_ring/equip", headers=_auth(token))
    assert r.status_code == 200
    assert r.json() == {"equipped_theme": "starter", "equipped_frame": "bronze_ring"}

    # frame_none clears the slot back to None (theme untouched)
    r = await client.post("/vault/frame_none/equip", headers=_auth(token))
    assert r.status_code == 200
    assert r.json() == {"equipped_theme": "starter", "equipped_frame": None}
