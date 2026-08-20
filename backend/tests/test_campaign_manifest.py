"""Validate the committed campaign manifest: structure, no-repeat coverage, the monotonic difficulty
ramp, intermixing, and that the committed artifact is in sync with its inputs and resolves to real
bank questions.

The campaign is now GENERATED (build_manifest.py) per world from its category bank: levels are
assigned purely by difficulty via a category-seeded shuffle, so sub-topics intermix across levels
and difficulty ramps monotonically (boss L10 hardest). World keys stay locked to the category names
so the cosmetics/achievements coupling (`world:<key>`) is preserved.

No DB needed — the manifest is static content. (Resolution against the *ingested servable* bank is
also exercised end-to-end in test_campaign.py, which starts a real campaign level.)
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from content.campaign import manifest as cm
from content.campaign.build_manifest import _out_path, build
from content.campaign.keys import question_key
from content.campaign.spec import difficulty_score
from content.campaign.spec import load as load_spec


def _content_root():
    """The active content package — topology is read from it, never hard-coded here."""
    from app.core.config import settings

    return settings.content_root


# Topology comes from the ACTIVE content package, not from constants in the builder — the same
# assertions therefore hold for the synthetic sample campaign and for the private production one.
_SPEC = load_spec(_content_root())
_BANK_DIR = _content_root() / "bank"
ARCS = tuple((a.name, range(a.first_level, a.last_level + 1)) for a in _SPEC.arcs)
LEVEL_TITLES = _SPEC.level_titles
RAMP = _SPEC.ramp
LEVELS_PER_WORLD = _SPEC.levels_per_world
QUESTIONS_PER_LEVEL = _SPEC.questions_per_level
QUESTIONS_PER_WORLD = _SPEC.questions_per_world

# World keys are LOCKED — cosmetics/achievements couple on `world:<key>`; changing one silently
# breaks unlock requirements. This list IS the cosmetics-coupling contract.
EXPECTED_WORLDS = ["Science", "History", "Sports", "Geography", "Arts", "Pop Culture"]
EXPECTED_ARC_NAMES = [name for name, _ in ARCS]


def _bank_keys_by_category() -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for f in _BANK_DIR.glob("*.json"):
        rows = json.loads(f.read_text(encoding="utf-8"))
        cat = rows[0]["category"]
        out[cat] = {question_key(cat, r["question"]) for r in rows}
    return out


def test_committed_manifest_matches_fresh_build():
    """The committed campaign_levels.json must equal a fresh build from the plan + bank inputs —
    catches a stale manifest someone forgot to rebuild after editing a plan."""
    committed = json.loads(Path(_out_path()).read_text(encoding="utf-8"))
    assert committed == build()


def test_six_worlds_in_product_order():
    assert [w.world for w in cm.worlds()] == EXPECTED_WORLDS


@pytest.mark.parametrize("world", EXPECTED_WORLDS)
def test_world_has_ten_contiguous_levels(world):
    w = cm.get_world(world)
    assert w is not None
    assert [lvl.level_number for lvl in w.levels] == list(range(1, 11))
    # Difficulty-band chapters: Foundations / Ascent / Mastery (every world, same generic arcs).
    assert [arc.name for arc in w.arcs] == EXPECTED_ARC_NAMES


@pytest.mark.parametrize("world", EXPECTED_WORLDS)
def test_each_level_has_ten_questions(world):
    for lvl in cm.get_world(world).levels:
        assert len(lvl.question_keys) == QUESTIONS_PER_LEVEL
        assert len(set(lvl.question_keys)) == QUESTIONS_PER_LEVEL


@pytest.mark.parametrize("world", EXPECTED_WORLDS)
def test_no_repeated_question_within_a_world(world):
    keys = [k for lvl in cm.get_world(world).levels for k in lvl.question_keys]
    assert len(keys) == QUESTIONS_PER_WORLD
    assert (
        len(set(keys)) == QUESTIONS_PER_WORLD
    )  # every question distinct across the whole world campaign


@pytest.mark.parametrize("world", EXPECTED_WORLDS)
def test_world_consumes_exactly_its_category_bank(world):
    w = cm.get_world(world)
    manifest_keys = {k for lvl in w.levels for k in lvl.question_keys}
    bank_keys = _bank_keys_by_category()[w.category]
    # Every manifest key is a real servable question; the world uses the whole 100-question bank.
    assert manifest_keys == bank_keys


@pytest.mark.parametrize("world", EXPECTED_WORLDS)
def test_boss_is_level_ten_and_strictly_hardest(world):
    levels = cm.get_world(world).levels
    bosses = [lvl.level_number for lvl in levels if lvl.is_boss]
    assert bosses == [10]
    scores = [difficulty_score(_mix_tuple(lvl)) for lvl in levels]
    # The boss is the SINGLE hardest level (strictly hardest, not merely tied for hardest).
    assert scores[-1] == max(scores)
    assert scores.count(max(scores)) == 1


@pytest.mark.parametrize("world", EXPECTED_WORLDS)
def test_difficulty_is_monotonically_non_decreasing(world):
    """The whole point of the restructure: difficulty ramps L1→L10, never stepping back down."""
    levels = cm.get_world(world).levels
    scores = [difficulty_score(_mix_tuple(lvl)) for lvl in levels]
    assert scores == sorted(scores), scores  # non-decreasing
    assert scores[0] == 0  # L1 is all-easy (the gentlest possible start)


@pytest.mark.parametrize("world", EXPECTED_WORLDS)
def test_every_level_matches_the_ramp_distribution(world):
    """Each world is generated from the SAME ramp, so every world's per-level E/M/H mix equals RAMP.
    (Sub-topic intermixing is implied by the seeded full-bank shuffle; here we pin distribution.)"""
    levels = cm.get_world(world).levels
    for lvl, mix in zip(levels, RAMP, strict=True):
        assert sum(lvl.difficulty_mix.values()) == QUESTIONS_PER_LEVEL
        assert _mix_tuple(lvl) == mix


def _mix_tuple(lvl) -> tuple[int, int, int]:
    return (lvl.difficulty_mix["easy"], lvl.difficulty_mix["medium"], lvl.difficulty_mix["hard"])


def test_world_keys_are_the_locked_category_names():
    """Cosmetics/achievements couple on `world:<key>`; the key set must never drift, and every world
    key must map to its canonical bank category (world == category identity preserved)."""
    worlds = cm.worlds()
    assert [w.world for w in worlds] == EXPECTED_WORLDS
    expected_category = {
        "Science": "Science & Nature",
        "History": "History",
        "Sports": "Sports",
        "Geography": "Geography",
        "Arts": "Arts & Literature",
        "Pop Culture": "Pop Culture & Entertainment",
    }
    assert {w.world: w.category for w in worlds} == expected_category


@pytest.mark.parametrize("world", EXPECTED_WORLDS)
def test_levels_intermix_subtopics_not_a_single_bank_block(world):
    """Bank files are authored in sub-topic blocks (contiguous index ranges). A level built as a
    single sub-topic silo would be a tight contiguous index window; the seeded full-bank shuffle
    must instead draw each level from across the whole bank.

    Asserted in AGGREGATE rather than per level. A silo build makes EVERY level tight, so the mean
    span collapses to roughly the level width — that is the signal. An individual level landing on
    adjacent indices is ordinary chance, especially on a small bank, and failing on it would be
    testing the random seed rather than the shuffle. Expressed against the spec so the intent
    survives any bank size.
    """
    w = cm.get_world(world)
    bank_rows = json.loads(_bank_file_for(w.category).read_text(encoding="utf-8"))
    key_to_index = {question_key(w.category, r["question"]): i for i, r in enumerate(bank_rows)}

    spans = []
    for lvl in w.levels:
        idxs = sorted(key_to_index[k] for k in lvl.question_keys)
        spans.append(idxs[-1] - idxs[0])

    mean_span = sum(spans) / len(spans)
    # Calibrated to SEPARATE the two signals rather than to sit on either. A silo averages about
    # the level width; a shuffled draw of k from n averages roughly n(k-1)/(k+1), and the draw is
    # further constrained to difficulty buckets. A third of the bank is several times the silo
    # figure and safely under the shuffled one at any realistic size.
    floor = QUESTIONS_PER_WORLD / 3
    assert mean_span >= floor, (
        f"{world} levels look clustered: mean span {mean_span:.1f} < {floor:.1f} "
        f"(a sub-topic silo would average about {QUESTIONS_PER_LEVEL}); spans={spans}"
    )


def _bank_file_for(category: str) -> Path:
    for f in _BANK_DIR.glob("*.json"):
        rows = json.loads(f.read_text(encoding="utf-8"))
        if rows and rows[0]["category"] == category:
            return f
    raise AssertionError(f"no bank file for category {category!r}")


def test_level_titles_match_the_generated_progression_scheme():
    """Every world uses the same generic progression titles (no sub-topic-specific titles)."""
    for w in cm.worlds():
        assert [lvl.title for lvl in w.levels] == list(LEVEL_TITLES)


# DESIGN §7 honesty: coins are cosmetic; never money/gambling framing in player-facing copy.
_BANNED = [
    "cash",
    "prize",
    "bet",
    "wager",
    "gambl",
    "jackpot",
    "casino",
    "lottery",
    "payout",
    "deposit",
]


def test_no_money_or_gambling_language_in_titles():
    offenders = []
    for w in cm.worlds():
        for arc in w.arcs:
            strings = [arc.name] + [lvl.title for lvl in arc.levels]
            for s in strings:
                low = s.casefold()
                for bad in _BANNED:
                    if bad in low:
                        offenders.append((w.world, s, bad))
    assert not offenders, offenders
