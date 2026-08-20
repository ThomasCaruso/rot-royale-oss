"""Duel rivals, Daily Royale LIVE-BOARD fillers, and the shared window seed.

Two different synthetic things live here. Keeping them straight is the point of this docstring.

**Duel rivals** — a disclosed 1v1 opponent the player chose to face, deterministic given
(seed, tier) so a match is regenerable from its stored seed. Never presented as another human.

**Royale fillers** — entrants shown in the LIVE Daily Royale board while the window is open, so a
thin day doesn't render as a two-person podium with an empty third step. Reinstated deliberately
(they had been removed entirely); the boundary that makes them acceptable is narrow, and it is
load-bearing.

  - They exist ONLY in the live field read (`services/field_fillers.py`, called from the field
    endpoint). `window_field` itself still returns real entries only.
  - **Settlement never sees them.** `settle_window` ranks entries from the DB, so placement, Elo,
    Gems, streak and `standings` remain human-only. Nobody earns currency for beating a filler.
  - **Public share links never see them.** `create_challenge` computes its own count, so a link that
    says "3rd of 8" still means eight people played. That number outlives the window; the live board
    does not.

So the inflated count is confined to the provisional board a player is looking at right now — which
the UI already labels as still updating — and never reaches anything settled, paid or published.
`tests/test_no_synthetic_field.py` pins each of those boundaries.
"""

from __future__ import annotations

from random import Random
from typing import Any

from app.models import ContestWindow

_SPEED_JITTER = 0.15  # per-round wobble around the bot's mean speed

# Duel rival skill (P(correct)) + speed (mean time_frac, higher = faster) ranges per tier. The
# tier is chosen server-side from the player's duel strength + duel type (never client-chosen), so
# a stronger player faces a sharper rival; the rival is deterministic given (seed, tier) and is
# regenerable from the stored match seed for audit. Beatable-but-not-trivial at every tier.
DUEL_RIVAL_TIERS: dict[str, tuple[tuple[float, float], tuple[float, float]]] = {
    # tier: ((skill_min, skill_max), (speed_min, speed_max))
    "rookie": ((0.50, 0.62), (0.30, 0.50)),
    "solid": ((0.62, 0.74), (0.45, 0.62)),
    "sharp": ((0.74, 0.86), (0.58, 0.74)),
    "elite": ((0.84, 0.95), (0.70, 0.85)),
}

# How full a live Daily Royale board should look before fillers stop being added. Eight fills the
# podium and leaves a few rows beneath it; past that a real field carries itself.
MIN_LIVE_FIELD_SIZE = 8

# Royale filler skill (P(correct)) + speed (mean time_frac), deliberately BELOW the weakest duel
# tier. Mean correct is exactly 8 * midpoint(skill), which is the dial to turn if this is ever
# retuned — the width then controls only how fat the top tail is, since P(a filler goes 8/8) rises
# as skill_max^8.
#
# THE CEILING IS THE NUMBER THAT MATTERS and it is set low on purpose. A band centred on 0.65 (mean
# 5.2/8) was tried and rejected: it reads as "competent players", but it also puts a synthetic name
# on top of a thin day's podium about a quarter of the time and beats an ordinary human 6/8 on 13%
# of runs. Erring low is the instruction — a board that flatters the player beats one that makes a
# real 6/8 feel like a loss to someone who does not exist.
#
# Measured over 3,200 generated runs (tests/test_no_synthetic_field.py pins the shape):
#   mean 3.40/8 · median 3/8 · p95 6/8 · median score 440 · p95 901 · max 1411
#   8/8 on 0.12% of runs, so a filler almost never tops the board.
#   vs a human: 3/8 slow  =  462 (a filler beats it 48% of the time — a bad day can still lose)
#               6/8 mid   = 1092 (1.4%)
#               7/8 quick = 1450 (never)
#               8/8 fast  = 1784 (never)
ROYALE_FILLER_SKILL: tuple[float, float] = (0.30, 0.55)
ROYALE_FILLER_SPEED: tuple[float, float] = (0.20, 0.45)

# A pool of plausible player handles, deterministically sampled per window. Large enough (>> the
# 8-slot field) that the same names don't recur every window. Deliberately NOT obviously-bot names.
USERNAME_POOL: tuple[str, ...] = (
    "NovaStrike",
    "QuasarFox",
    "EmberWolf",
    "PixelNomad",
    "VoidRunner",
    "AstroKnight",
    "LunarHawk",
    "CobaltJinx",
    "NeonDrift",
    "IronTalon",
    "ZephyrAce",
    "CrimsonByte",
    "FrostQuill",
    "SolarVibe",
    "ShadowMint",
    "TurboLark",
    "VortexRay",
    "GildedOwl",
    "MysticVolt",
    "RapidFern",
    "OnyxFalcon",
    "PlasmaPine",
    "DuskRaven",
    "JadeComet",
    "ArcSparrow",
    "NebulaKoi",
    "ValiantElk",
    "CipherMoth",
    "RuneWisp",
    "GleamHusky",
    "BlitzOtter",
    "AmberLynx",
    "StaticDove",
    "QuillBeck",
    "MarbleFox",
    "TidalGrove",
    "EchoMallow",
    "PrismHart",
    "FableWren",
    "GritStone",
    "HazeVireo",
    "InkySwift",
    "KiteMarrow",
    "LoftSparrow",
    "MossbyJin",
    "NorthQuail",
    "OpalDrake",
    "PennyGale",
    "RiverKestrel",
    "SaltyPip",
    "TawnyMer",
    "UmberFinch",
    "VeloChia",
    "WispRowan",
    "XenonReef",
    "YarnBadger",
    "ZinniaFox",
    "BravoPeck",
    "CedarLute",
    "DapperMoss",
    "ElmCrane",
    "FernGable",
    "GoldyWren",
    "HollyBex",
    "IvoryQuest",
    "JuniperLo",
    "KettleSky",
    "LumenArc",
    "MapleDart",
    "NimbusJay",
    "OakleyVim",
    "PebbleRun",
    "QuokkaZed",
    "RustleBee",
    "SableMint",
    "ThistleRo",
    "UpdraftLi",
    "VelvetPaw",
    "WrenlyFox",
    "YuccaBlaze",
    "AzureKite",
    "BramblePip",
    "CalicoVex",
    "DriftwoodNa",
    "EmberlyQu",
    "FlintRoan",
    "GravelLux",
    "HiveMarlo",
    "IndigoFen",
    "JollyKestrel",
    "KaleidoVi",
    "LarkspurNo",
    "MossyTalon",
    "NettleRune",
    "OrbitWren",
    "PlumeHarrow",
    "QuietStag",
    "RookeryBe",
    "SiltFalcon",
    "TempestLo",
    "UnderhillKa",
    "ViperGleam",
    "WillowByte",
    "XanderMoss",
    "YonderPip",
    "ZanyHeron",
    "AlderVex",
    "BirchNova",
    "CloverDash",
    "DewMarrow",
    "ElkwoodRi",
    "FableNox",
    "GorseLin",
    "HarrowQu",
    "InletRaven",
    "JettyMoss",
    "KnollFinch",
    "LedgerVi",
    "MirthQuail",
    "NookHarbor",
)


def window_seed(window: ContestWindow) -> int:
    """Stable per (contest_date, slot), varied across windows, free of PYTHONHASHSEED salting.

    Matches the M5 bot seed basis — and, unlike the row id, is identical for any in-memory window
    object representing the same window (no DB round-trip needed to reproduce a field). Also the
    basis for the Daily Royale's SHARED question seed (contest.py), so every player in a window
    gets the identical puzzle."""
    return window.contest_date.toordinal() * 31 + sum(ord(c) for c in window.slot)


def _tier_salt(tier: str) -> int:
    """A small, stable per-tier int so different tiers off the same seed yield different streams."""
    return sum(ord(c) for c in tier)


def make_duel_rival(seed: int, tier: str, num_rounds: int) -> list[dict[str, Any]]:
    """A deterministic per-round rival run for a Duel. Returns
    [{correct: bool, time_frac: float}, ...] of length num_rounds. Deterministic given (seed, tier)
    so it's regenerable from the stored match seed. time_frac is the same unit the user's
    RoundResult stores (the duel adjudicator converts both sides to ms for the 350ms speed-gap tie
    rule). Unknown tier raises ValueError."""
    if tier not in DUEL_RIVAL_TIERS:
        raise ValueError(f"unknown duel rival tier {tier!r}")

    (skill_min, skill_max), (speed_min, speed_max) = DUEL_RIVAL_TIERS[tier]
    rng = Random(seed * 1_000_003 + _tier_salt(tier))
    skill = skill_min + rng.random() * (skill_max - skill_min)
    speed = speed_min + rng.random() * (speed_max - speed_min)

    rounds: list[dict[str, Any]] = []
    for _ in range(num_rounds):
        time_frac = min(1.0, max(0.0, rng.uniform(speed - _SPEED_JITTER, speed + _SPEED_JITTER)))
        correct = rng.random() < skill
        rounds.append({"correct": correct, "time_frac": time_frac})
    return rounds


def royale_filler_runs(
    seed: int, count: int, num_rounds: int
) -> list[tuple[str, list[dict[str, Any]]]]:
    """`count` deterministic filler runs for a window: [(username, [{correct, time_frac}, ...])].

    Deterministic in `seed` (use `window_seed`) so the live board is STABLE — Home re-polls the
    field every 30s, and a board that reshuffled its names and scores on every tick would read as
    broken long before anyone wondered whether the entrants were real.

    Usernames are drawn without replacement from `USERNAME_POOL`, which is much larger than the
    field so the same handles don't recur window to window. The pool was written for duel rivals and
    is deliberately free of bot-looking names.
    """
    if count <= 0:
        return []

    rng = Random(seed * 7_919 + 104_729)
    names = rng.sample(USERNAME_POOL, k=min(count, len(USERNAME_POOL)))

    (skill_min, skill_max) = ROYALE_FILLER_SKILL
    (speed_min, speed_max) = ROYALE_FILLER_SPEED

    runs: list[tuple[str, list[dict[str, Any]]]] = []
    for name in names:
        skill = skill_min + rng.random() * (skill_max - skill_min)
        speed = speed_min + rng.random() * (speed_max - speed_min)
        rounds: list[dict[str, Any]] = []
        for _ in range(num_rounds):
            jitter = rng.uniform(speed - _SPEED_JITTER, speed + _SPEED_JITTER)
            time_frac = min(1.0, max(0.0, jitter))
            rounds.append({"correct": rng.random() < skill, "time_frac": time_frac})
        runs.append((name, rounds))
    return runs
