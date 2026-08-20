"""Rot Rating domain logic (CLAUDE.md §5e) — the sharpness rating built on Glicko-2.

This module holds the PURE domain layer: verb mapping, difficulty-key resolution
and seeds, the precision-weighted headline derivation, the per-run period update,
and the anchor re-centring that keeps a floating difficulty pool from drifting the
overall scale. Persistence + run-completion wiring live in the DB helpers below the
pure functions; the daily difficulty-convergence batch lives in services alongside.

Design invariants (do not quietly break):
  * Parallel to placement Elo — never merged.
  * Speed never enters here (points reward speed; Rot Rating measures sharpness).
  * The headline is DERIVED from the three sub-ratings, so it can never disagree.
  * Trivia ("know") difficulties are the FIXED anchor; only estimate/notice float.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from app.core import constants as C
from app.services.glicko2 import Glicko, Result, update_rating


def verb_of_type(round_type: str) -> str:
    """Map a Royale round type to its Rot Rating verb (notice/estimate/know)."""
    return C.ROT_TYPE_VERB.get(round_type, "know")


def difficulty_key(verb: str, band: str) -> str:
    """Resolvable difficulty key: ``"<verb>:<band>"`` today; ``"<verb>:item:<uuid>"`` later
    can slot in without a rewrite (the key is opaque to the rating math)."""
    return f"{verb}:{band}"


def difficulty_seed(key: str) -> Glicko:
    """Seed rating for a difficulty key, from its band. Trivia keys never move off this."""
    band = key.rsplit(":", 1)[-1]
    rating = C.ROT_DIFFICULTY_SEED.get(band, C.ROT_DIFFICULTY_SEED_DEFAULT)
    return Glicko(rating=rating, rd=C.ROT_SEED_RD, vol=C.ROT_SEED_VOL)


def seed_glicko() -> Glicko:
    return Glicko(rating=C.ROT_SEED_RATING, rd=C.ROT_SEED_RD, vol=C.ROT_SEED_VOL)


@dataclass(frozen=True)
class SubRating:
    """A per-verb sub-rating plus how many of that verb's rounds have been rated."""

    glicko: Glicko
    rounds: int


def seed_sub_rating() -> SubRating:
    return SubRating(glicko=seed_glicko(), rounds=0)


@dataclass(frozen=True)
class JudgedRound:
    """One resolved Royale round as a Rot Rating game: its verb, the difficulty it played
    against (the opponent rating), and pass/fail. No timing — sharpness only."""

    verb: str
    opponent: Glicko
    passed: bool


@dataclass(frozen=True)
class RunUpdate:
    subs: dict[str, SubRating]
    headline: Glicko
    headline_provisional: bool
    sub_provisional: dict[str, bool]
    direction: str  # "up" | "down" | "flat"


def derive_headline(subs: dict[str, SubRating]) -> Glicko:
    """Precision-weighted mean of the PLAYED sub-ratings (weight = 1/rd^2). Because the headline
    is a deterministic function of the parts, it can never disagree with them; unplayed verbs
    (still at the prior) are excluded so the number reflects demonstrated sharpness. With nothing
    played it is the seed."""
    played = [s for s in subs.values() if s.rounds > 0]
    if not played:
        return seed_glicko()
    wsum = 0.0
    rating_wsum = 0.0
    for s in played:
        w = 1.0 / (s.glicko.rd * s.glicko.rd)
        wsum += w
        rating_wsum += s.glicko.rating * w
    rating = rating_wsum / wsum
    rd = (1.0 / wsum) ** 0.5
    # vol is not exposed for the derived headline; carry the seed value.
    return Glicko(rating=rating, rd=rd, vol=C.ROT_SEED_VOL)


def _direction(before: float, after: float) -> str:
    if after > before + 1e-9:
        return "up"
    if after < before - 1e-9:
        return "down"
    return "flat"


def update_run(subs: dict[str, SubRating], rounds: list[JudgedRound]) -> RunUpdate:
    """Apply one Royale run to the sub-ratings. Each verb's rounds form that verb's rating
    period (a Glicko-2 batch update); untouched verbs are unchanged. Returns the new sub-ratings,
    the derived headline, provisional flags, and the direction the headline moved."""
    before_headline = derive_headline(subs).rating

    by_verb: dict[str, list[Result]] = {}
    for r in rounds:
        by_verb.setdefault(r.verb, []).append(
            Result(opponent=r.opponent, score=1.0 if r.passed else 0.0)
        )

    new_subs: dict[str, SubRating] = {}
    for verb, sub in subs.items():
        games = by_verb.get(verb)
        if not games:
            new_subs[verb] = sub
            continue
        updated = update_rating(sub.glicko, games, tau=C.ROT_TAU, rd_floor=C.ROT_RD_FLOOR)
        new_subs[verb] = SubRating(glicko=updated, rounds=sub.rounds + len(games))

    headline = derive_headline(new_subs)
    total_rounds = sum(s.rounds for s in new_subs.values())
    sub_provisional = {v: new_subs[v].rounds < C.ROT_SUB_PROVISIONAL_ROUNDS for v in new_subs}
    return RunUpdate(
        subs=new_subs,
        headline=headline,
        headline_provisional=total_rounds < C.ROT_PROVISIONAL_ROUNDS,
        sub_provisional=sub_provisional,
        direction=_direction(before_headline, headline.rating),
    )


def recenter_floating_pool(pool: dict[str, Glicko], seeds: dict[str, float]) -> dict[str, Glicko]:
    """Anchor the floating difficulty pool: shift every rating by a constant so the pool's
    (equal-weight) mean returns to the seed mean, preserving the spread between items. This is
    what stops a strong-player cohort from co-inflating player and item ratings — the pool mean
    is pinned each batch, so players can only move relative to a fixed reference. A pool already
    on its seed mean is left untouched."""
    if not pool:
        return dict(pool)
    current_mean = sum(g.rating for g in pool.values()) / len(pool)
    seed_mean = sum(seeds[k] for k in pool) / len(pool)
    shift = seed_mean - current_mean
    if abs(shift) < 1e-9:
        return dict(pool)
    return {k: replace(g, rating=g.rating + shift) for k, g in pool.items()}
