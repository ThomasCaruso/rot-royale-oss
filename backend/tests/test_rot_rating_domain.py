"""Pure Rot Rating domain logic (services/rot_rating.py) — no DB.

Covers the verb mapping, difficulty-key resolution + seeds, the precision-weighted
headline derivation (the headline can never disagree with its parts), the per-run
period update (each verb updates only from its own rounds), and the anchor
re-centring that pins a floating difficulty pool so a strong cohort can't drift the
overall scale.
"""

from __future__ import annotations

from app.core import constants as C
from app.services.glicko2 import Glicko
from app.services.rot_rating import (
    JudgedRound,
    SubRating,
    derive_headline,
    difficulty_key,
    difficulty_seed,
    recenter_floating_pool,
    seed_sub_rating,
    update_run,
    verb_of_type,
)


def test_verb_of_type() -> None:
    assert verb_of_type("trivia") == "know"
    assert verb_of_type("estimate") == "estimate"
    assert verb_of_type("change_detection") == "notice"
    assert verb_of_type("something_new") == "know"  # safe default


def test_difficulty_key_and_seed() -> None:
    assert difficulty_key("estimate", "hard") == "estimate:hard"
    assert difficulty_seed("estimate:hard").rating == C.ROT_DIFFICULTY_SEED["hard"]
    assert difficulty_seed("know:easy").rating == C.ROT_DIFFICULTY_SEED["easy"]
    assert difficulty_seed("notice:unknownband").rating == C.ROT_DIFFICULTY_SEED_DEFAULT


# --- headline derivation -----------------------------------------------------------------------


def _sub(rating: float, rd: float, rounds: int) -> SubRating:
    return SubRating(glicko=Glicko(rating, rd, C.ROT_SEED_VOL), rounds=rounds)


def test_headline_single_played_verb_equals_that_verb() -> None:
    subs = {
        "know": _sub(1620, 200, 8),
        "estimate": seed_sub_rating(),
        "notice": seed_sub_rating(),
    }
    headline = derive_headline(subs)
    assert abs(headline.rating - 1620) < 1e-6  # unplayed priors do not pull it


def test_headline_is_precision_weighted_within_range() -> None:
    subs = {
        "know": _sub(1600, 200, 10),
        "estimate": _sub(1400, 200, 10),
        "notice": seed_sub_rating(),  # unplayed
    }
    headline = derive_headline(subs)
    assert abs(headline.rating - 1500) < 1e-6  # equal rd -> midpoint of the two played
    assert min(1400, 1600) <= headline.rating <= max(1400, 1600)
    assert headline.rd < 200  # combining two measurements sharpens the estimate


def test_headline_unplayed_verbs_only_seed() -> None:
    subs = {v: seed_sub_rating() for v in C.ROT_VERBS}
    headline = derive_headline(subs)
    assert abs(headline.rating - C.ROT_SEED_RATING) < 1e-6


def test_headline_moves_with_a_part() -> None:
    base = {
        "know": _sub(1500, 200, 10),
        "estimate": _sub(1500, 200, 10),
        "notice": seed_sub_rating(),
    }
    stronger = {**base, "know": _sub(1700, 200, 10)}
    assert derive_headline(stronger).rating > derive_headline(base).rating


# --- per-run period update ---------------------------------------------------------------------


def _fresh_subs() -> dict[str, SubRating]:
    return {v: seed_sub_rating() for v in C.ROT_VERBS}


def _round(verb: str, opp_rating: float, passed: bool) -> JudgedRound:
    return JudgedRound(verb=verb, opponent=Glicko(opp_rating, 100, C.ROT_SEED_VOL), passed=passed)


def test_run_updates_only_played_verbs() -> None:
    subs = _fresh_subs()
    rounds = [_round("know", 1500, True) for _ in range(8)]
    result = update_run(subs, rounds)
    assert result.subs["know"].glicko.rating > C.ROT_SEED_RATING
    assert result.subs["know"].rounds == 8
    # untouched verbs keep the seed and zero rounds
    assert result.subs["estimate"].rounds == 0
    assert result.subs["estimate"].glicko.rating == C.ROT_SEED_RATING


def test_run_all_correct_up_all_wrong_down() -> None:
    up = update_run(_fresh_subs(), [_round("know", 1500, True) for _ in range(8)])
    down = update_run(_fresh_subs(), [_round("know", 1500, False) for _ in range(8)])
    assert up.direction == "up"
    assert down.direction == "down"
    assert up.headline.rating > C.ROT_SEED_RATING > down.headline.rating


def test_run_splits_across_verbs() -> None:
    subs = _fresh_subs()
    rounds = (
        [_round("know", 1500, True) for _ in range(4)]
        + [_round("estimate", 1500, True) for _ in range(3)]
        + [_round("notice", 1500, True) for _ in range(1)]
    )
    result = update_run(subs, rounds)
    assert result.subs["know"].rounds == 4
    assert result.subs["estimate"].rounds == 3
    assert result.subs["notice"].rounds == 1


def test_provisional_flags() -> None:
    subs = _fresh_subs()
    # one run of 8 know rounds: know sub has 8 (>=5, not provisional) but total 8 (<15, provisional)
    result = update_run(subs, [_round("know", 1500, True) for _ in range(8)])
    assert result.headline_provisional is True
    assert result.sub_provisional["know"] is False
    assert result.sub_provisional["estimate"] is True  # never played


def test_headline_never_disagrees_with_parts() -> None:
    # After any run, the headline must lie within the span of the played sub-ratings.
    subs = _fresh_subs()
    rounds = [_round("know", 1500, True) for _ in range(6)] + [
        _round("estimate", 1500, False) for _ in range(2)
    ]
    result = update_run(subs, rounds)
    played = [result.subs[v].glicko.rating for v in C.ROT_VERBS if result.subs[v].rounds > 0]
    assert min(played) - 1e-6 <= result.headline.rating <= max(played) + 1e-6


# --- anchor: floating-pool re-centring ---------------------------------------------------------


def test_recenter_pins_weighted_mean_to_seed_mean() -> None:
    # A pool that has drifted +120 across the board is pulled back so its rd-weighted mean equals
    # the seed mean, while the SPREAD between items is preserved (relative difficulty intact).
    seeds = {"estimate:easy": 1300.0, "estimate:medium": 1500.0, "estimate:hard": 1700.0}
    drifted = {k: Glicko(v + 120, 180, C.ROT_SEED_VOL) for k, v in seeds.items()}
    recentered = recenter_floating_pool(drifted, seeds)
    # relative gaps unchanged
    assert (
        abs((recentered["estimate:hard"].rating - recentered["estimate:easy"].rating) - 400.0)
        < 1e-6
    )
    # weighted mean back on the seed mean (equal rd here -> simple mean 1500)
    mean = sum(g.rating for g in recentered.values()) / len(recentered)
    assert abs(mean - 1500.0) < 1e-6


def test_recenter_no_drift_is_noop() -> None:
    seeds = {"estimate:hard": 1700.0, "estimate:easy": 1300.0}
    onseed = {k: Glicko(v, 200, C.ROT_SEED_VOL) for k, v in seeds.items()}
    out = recenter_floating_pool(onseed, seeds)
    for k in seeds:
        assert abs(out[k].rating - seeds[k]) < 1e-6
