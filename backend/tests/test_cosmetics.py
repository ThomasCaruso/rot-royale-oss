"""Catalog sanity: the server is the source of truth for prices and gating."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from app.core.constants import AVATAR_PRESETS, DEFAULT_THEME_ID
from app.core.cosmetics import CATALOG_BY_ID, COSMETIC_CATALOG, UnknownItemError, get_item

# Cross-side parity contract: frontend/src/theme/cosmeticIds.json is imported by the frontend
# tests and read here by path so both sides assert against the same literal fixture.  Any id
# drift — backend adds a frame without a matching FRAME_STYLES entry in identity.ts, or vice-versa
# — causes a failure on both sides.  The fixture is the contract; neither side owns it alone.
_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "theme" / "cosmeticIds.json"
)


def _load_fixture() -> dict:  # type: ignore[type-arg]
    if not _FIXTURE_PATH.exists():
        raise FileNotFoundError(
            f"Cross-side cosmetic fixture missing: {_FIXTURE_PATH}\n"
            "Create frontend/src/theme/cosmeticIds.json with keys "
            "presets / frames / themes matching the backend catalog."
        )
    return json.loads(_FIXTURE_PATH.read_text(encoding="utf-8"))


def test_catalog_ids_are_unique_and_indexed():
    ids = [item.id for item in COSMETIC_CATALOG]
    assert len(ids) == len(set(ids))
    assert set(CATALOG_BY_ID) == set(ids)


def test_default_theme_is_free_and_present():
    item = get_item(DEFAULT_THEME_ID)
    assert item.kind == "theme" and item.cost == 0 and item.requirement is None


def test_catalog_shape():
    # coin/free ungated themes + the unlock-foundation gated starter themes, at locked prices/gates
    themes = {
        i.id: (i.cost, i.currency, i.requirement) for i in COSMETIC_CATALOG if i.kind == "theme"
    }
    assert themes == {
        # "starter" IS the default theme (the ivory/purple/gold identity); the Blank pair are the
        # other free themes; "Daylight" is free but earned (locked until 7 Daily Royales); "Rot
        # Champion" (id royale) is the first-300 founder exclusive — earned-free, never buyable;
        # bubblegum/forest/midnight remain the only purchasable themes.
        "starter": (0, "coins", None),
        "blank_light": (0, "coins", None),
        "blank": (0, "coins", None),
        "daylight": (0, "coins", "royales:7"),
        "royale": (0, "coins", "founder:200"),
        "bubblegum": (400, "coins", None),
        "forest": (600, "coins", None),
        "midnight": (900, "coins", None),
        # earned-only prestige themes — the hardest tier, each half of a super-hard frame+theme set
        "champion": (0, "coins", "all_worlds"),
        "apex": (0, "coins", "division:Apex"),
        "crown_arena": (0, "coins", "duel_tier:crown"),
    }

    frames = {
        i.id: (i.cost, i.currency, i.requirement) for i in COSMETIC_CATALOG if i.kind == "frame"
    }
    assert frames == {
        "frame_none": (0, "coins", None),
        "bronze_ring": (60, "coins", None),
        "violet_glow": (100, "coins", None),
        "gold_crown": (150, "coins", None),
        # gated requirements use the EXACT campaign manifest world keys
        "science_orbit": (150, "coins", "world:Science"),
        "history_relic": (150, "coins", "world:History"),
        "geo_compass": (150, "coins", "world:Geography"),
        "arts_brush": (150, "coins", "world:Arts"),
        "sports_champion": (150, "coins", "world:Sports"),
        "pop_neon": (150, "coins", "world:Pop Culture"),
        "crowned_scholar": (0, "coins", "all_worlds"),
        # Gem-priced duel frames (no requirement; bought with Gems)
        "violet_duel_frame": (25, "gems", None),
        "crown_duel_frame": (60, "gems", None),
        # paired-set frames (earned halves of the Apex + Crown prestige sets)
        "apex_frame": (0, "coins", "division:Apex"),
        "crown_master_frame": (0, "coins", "duel_tier:crown"),
        # standalone earned frames (specific level + duel tier)
        "cosmic_boss_frame": (0, "coins", "level:Science:10"),
        "duelist_gold_frame": (0, "coins", "duel_tier:gold"),
    }
    assert set(COSMETIC_CATALOG) == {
        *(i for i in COSMETIC_CATALOG if i.kind == "theme"),
        *(i for i in COSMETIC_CATALOG if i.kind == "frame"),
    }  # no other kinds


def test_gated_world_keys_match_the_campaign_manifest():
    """A catalog requirement pointing at a world that doesn't exist would be permanently locked
    (the checker's safe default) — pin that every world:<key> resolves in the manifest."""
    from content.campaign import manifest as cm

    manifest_worlds = {w.world for w in cm.worlds()}
    for item in COSMETIC_CATALOG:
        if item.requirement and item.requirement.startswith("world:"):
            assert item.requirement.removeprefix("world:") in manifest_worlds


def test_get_item_raises_on_unknown():
    with pytest.raises(UnknownItemError):
        get_item("nope")


def test_cross_side_cosmetic_id_parity():
    """Assert that the backend catalog matches the shared frontend/src/theme/cosmeticIds.json
    fixture exactly.  The fixture is the cross-side contract: the frontend imports it in
    identity.test.ts and tokens.test.ts; the backend reads it here by path.  If either side
    diverges (e.g. a new frame added to the catalog without a FRAME_STYLES entry on the frontend)
    this test — and the corresponding frontend test — will fail loudly."""
    fixture = _load_fixture()

    catalog_frame_ids = {i.id for i in COSMETIC_CATALOG if i.kind == "frame"}
    catalog_theme_ids = {i.id for i in COSMETIC_CATALOG if i.kind == "theme"}
    backend_preset_ids = set(AVATAR_PRESETS)

    fixture_frames = set(fixture["frames"])
    fixture_themes = set(fixture["themes"])
    fixture_presets = set(fixture["presets"])

    assert catalog_frame_ids == fixture_frames, (
        f"Frame id mismatch between catalog and fixture.\n"
        f"  In catalog only:  {catalog_frame_ids - fixture_frames}\n"
        f"  In fixture only:  {fixture_frames - catalog_frame_ids}"
    )
    assert len(fixture["frames"]) == len(catalog_frame_ids), (
        "Fixture frames list has duplicates — each id must appear exactly once."
    )

    assert catalog_theme_ids == fixture_themes, (
        f"Theme id mismatch between catalog and fixture.\n"
        f"  In catalog only:  {catalog_theme_ids - fixture_themes}\n"
        f"  In fixture only:  {fixture_themes - catalog_theme_ids}"
    )
    assert len(fixture["themes"]) == len(catalog_theme_ids), (
        "Fixture themes list has duplicates — each id must appear exactly once."
    )

    assert backend_preset_ids == fixture_presets, (
        f"Avatar preset id mismatch between AVATAR_PRESETS and fixture.\n"
        f"  In AVATAR_PRESETS only: {backend_preset_ids - fixture_presets}\n"
        f"  In fixture only:        {fixture_presets - backend_preset_ids}"
    )
    assert len(fixture["presets"]) == len(backend_preset_ids), (
        "Fixture presets list has duplicates — each id must appear exactly once."
    )


def test_cross_side_badge_title_world_parity():
    """Assert that the fixture's badges/titles/worlds arrays match the backend achievement catalogs
    and campaign manifest exactly.  Frontend identity.test.ts asserts the same arrays against
    BADGE_STYLES, TITLE_STYLES, and WORLD_FRAMES — so any id drift (catalog gains a badge without a
    matching BADGE_STYLES entry) fails loudly on both sides."""
    from app.core.achievements import BADGE_CATALOG, TITLE_CATALOG
    from content.campaign import manifest as cm

    fixture = _load_fixture()

    # --- badges ---
    catalog_badge_ids = {a.id for a in BADGE_CATALOG}
    fixture_badge_ids = set(fixture.get("badges", []))
    assert catalog_badge_ids == fixture_badge_ids, (
        f"Badge id mismatch between BADGE_CATALOG and fixture.\n"
        f"  In catalog only:  {catalog_badge_ids - fixture_badge_ids}\n"
        f"  In fixture only:  {fixture_badge_ids - catalog_badge_ids}"
    )
    assert len(fixture["badges"]) == len(catalog_badge_ids), (
        "Fixture badges list has duplicates — each id must appear exactly once."
    )

    # --- titles ---
    catalog_title_ids = {a.id for a in TITLE_CATALOG}
    fixture_title_ids = set(fixture.get("titles", []))
    assert catalog_title_ids == fixture_title_ids, (
        f"Title id mismatch between TITLE_CATALOG and fixture.\n"
        f"  In catalog only:  {catalog_title_ids - fixture_title_ids}\n"
        f"  In fixture only:  {fixture_title_ids - catalog_title_ids}"
    )
    assert len(fixture["titles"]) == len(catalog_title_ids), (
        "Fixture titles list has duplicates — each id must appear exactly once."
    )

    # --- worlds ---
    manifest_world_keys = {w.world for w in cm.worlds()}
    fixture_world_keys = set(fixture.get("worlds", []))
    assert manifest_world_keys == fixture_world_keys, (
        f"World key mismatch between campaign manifest and fixture.\n"
        f"  In manifest only: {manifest_world_keys - fixture_world_keys}\n"
        f"  In fixture only:  {fixture_world_keys - manifest_world_keys}"
    )
    assert len(fixture["worlds"]) == len(manifest_world_keys), (
        "Fixture worlds list has duplicates — each key must appear exactly once."
    )
