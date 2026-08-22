"""Daily Royale round-type sequencing (docs/architecture.md §4 — cognition integration).

A Royale is 8 rounds whose TYPES are a constrained shuffle, one order per ET date derived from the
date seed, varying day to day — the same Wordle-style shared-seed property as the questions
themselves (services/contest.py). This is pure: given the date seed and which types have content
today, it returns the 8-type sequence. Content pinning (which specific item per round) happens in
the contest service, exactly as the gauntlet pinned it.

Two-class round model (confirmed design):
- ATOMIC round types play through the unchanged one-opaque-submit contract: trivia (+ rapid_math,
  memory_flash, not in the Royale pool at launch).
- INTERACTIVE round types own a server-side cognition instance for the round's lifetime and are
  played against the cognition endpoints, then finalized once: estimate, change_detection.

Launch pool: trivia, estimate, change_detection — every registered type is now Royale-eligible.
(`span` and `crowd` were REMOVED pre-launch rather than left registered-but-unreachable; see
app/modules/__init__.py for why, and migration e0f1a2b3c4d5 for the schema drop.)
"""

from __future__ import annotations

from dataclasses import dataclass
from random import Random

# The cognitive verb per type, for the max-2-per-verb rule and (later) the per-verb sub-ratings.
VERBS = ("know", "notice", "estimate")


@dataclass(frozen=True)
class RoyaleRoundType:
    type: str  # the round-module type
    verb: str  # one of VERBS
    is_opener: bool  # a fast visual/reaction type, eligible to open (slot 1)
    difficulty_rank: int  # higher = harder; slot 8 takes the hardest available type
    interactive: bool  # owns a cognition instance for the round (else atomic one-shot submit)


# Registry of Royale-eligible round types. Pool ORDER is stable (used for deterministic backfill).
ROYALE_TYPES: dict[str, RoyaleRoundType] = {
    "trivia": RoyaleRoundType(
        "trivia", verb="know", is_opener=False, difficulty_rank=1, interactive=False
    ),
    "change_detection": RoyaleRoundType(
        "change_detection", verb="notice", is_opener=True, difficulty_rank=2, interactive=True
    ),
    "estimate": RoyaleRoundType(
        "estimate", verb="estimate", is_opener=False, difficulty_rank=3, interactive=True
    ),
}
ROYALE_POOL: tuple[str, ...] = ("trivia", "change_detection", "estimate")

ROUND_COUNT = 8
_MAX_PER_VERB_MIDDLE = 2  # slots 2-7: at most 2 of any one verb (when content allows)


def verb_of(round_type: str) -> str:
    return ROYALE_TYPES[round_type].verb


def royale_type_sequence(date_seed: int, available_types: set[str]) -> list[str]:
    """The 8-type sequence for a date. `available_types` is the set of pool types with content
    today; anything else is dropped and backfilled. Deterministic in (date_seed, available)."""
    pool = [t for t in ROYALE_POOL if t in available_types]
    if not pool:
        raise ValueError("no Royale round types have content today")

    rng = Random(f"{date_seed}:royale-seq")

    # Slot 1: a fast visual/reaction opener; backfill from the pool if none is available.
    openers = [t for t in pool if ROYALE_TYPES[t].is_opener]
    opener = rng.choice(openers) if openers else rng.choice(pool)

    # Slot 8: the highest-difficulty type available (ties broken by seed).
    top_rank = max(ROYALE_TYPES[t].difficulty_rank for t in pool)
    hardest = [t for t in pool if ROYALE_TYPES[t].difficulty_rank == top_rank]
    finale = rng.choice(hardest)

    # Slots 2-7: at most 2 per verb (each pool type is one verb, so ≤2 per type). A bag of two of
    # each available type gives ≤2 per verb; if that can't fill 6 (thin content), backfill by
    # repeating the pool (the max-2 preference relaxes rather than short the round set).
    middle_len = ROUND_COUNT - 2
    bag: list[str] = []
    for t in pool:
        bag.extend([t] * _MAX_PER_VERB_MIDDLE)
    rng.shuffle(bag)
    while len(bag) < middle_len:
        backfill = list(pool)
        rng.shuffle(backfill)
        bag.extend(backfill)
    middle = bag[:middle_len]
    rng.shuffle(middle)

    return [opener, *middle, finale]
