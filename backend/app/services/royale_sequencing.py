"""Daily Royale round-type sequencing (docs/architecture.md §4 — cognition integration).

A Royale is 8 rounds whose TYPES are a constrained shuffle, one order per ET date derived from the
date seed, varying day to day — the same Wordle-style shared-seed property as the questions
themselves (services/contest.py). This is pure: given the date seed and which types have content
today, it returns the 8-type sequence. Content pinning (which specific item per round) happens in
the contest service, exactly as the gauntlet pinned it.

Two-class round model (confirmed design):
- ATOMIC round types play through the unchanged one-opaque-submit contract: trivia and memory_flash
  (+ rapid_math, which stays out of the Royale pool).
- INTERACTIVE round types own a server-side cognition instance for the round's lifetime and are
  played against the cognition endpoints, then finalized once: estimate, change_detection, video.

Pool: trivia, change_detection, estimate, video, memory_flash.

Two of these are special. `video` is ONE per run, pinned to slot 3, 6 or 7, and the only type that
asks more than one question (two about the clip, then what changed). `memory_flash` is the one
ATOMIC type that is still CAPPED — it is generated rather than drawn from a bank, so it needs no
cognition instance, but a second Simon grid in the same run is the same puzzle again. That is why
the budget splits on FILLER_TYPE rather than on `interactive`, which used to be the same set.
(`span` and `crowd` were REMOVED pre-launch rather than left registered-but-unreachable; see
app/modules/__init__.py for why, and migration e0f1a2b3c4d5 for the schema drop.)
"""

from __future__ import annotations

from collections.abc import Callable
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
    # The video round shares the `notice` verb with change detection — both ask the player to spot
    # what is there rather than recall or reason. rank 2 keeps `estimate` as the finale: video is
    # long, and a run that always ends on its longest round drags at exactly the wrong moment.
    "video": RoyaleRoundType(
        "video", verb="notice", is_opener=False, difficulty_rank=2, interactive=True
    ),
    # Simon-style flashing grid. ATOMIC (generated, one opaque submit — no cognition instance), and
    # a valid opener: it is fast, visual, and asks nothing of a cold brain except attention.
    "memory_flash": RoyaleRoundType(
        "memory_flash", verb="notice", is_opener=True, difficulty_rank=1, interactive=False
    ),
}
ROYALE_POOL: tuple[str, ...] = (
    "trivia",
    "change_detection",
    "estimate",
    "video",
    "memory_flash",
)

# Trivia is the FILLER — the only type allowed to repeat freely and fill whatever the capped types
# leave. Everything else is budgeted at 1-2 per run.
#
# This distinction used to be spelled `interactive`, and that was only ever coincidentally right:
# every capped type happened to be interactive and the only atomic type was trivia. `memory_flash`
# is atomic AND capped, which broke the coincidence — under the old rule it joined trivia in the
# filler pool, where a single `rng.choice` picks ONE type to fill every remaining slot. Half of all
# days would have been five Simon rounds in a row.
FILLER_TYPE = "trivia"

# The video round is capped at ONE per run and pinned to one of these slots (1-indexed).
#
# Not slot 1: the opener has to be fast, and this one is ~30 seconds. Not slot 8: it would end
# every run on its longest round. Not slot 2 either — arriving that early, before the run has any
# rhythm, it reads as the whole game rather than a change of pace.
VIDEO_SLOTS: tuple[int, ...] = (3, 6, 7)
VIDEO_PER_RUN = 1

ROUND_COUNT = 8

# How many rounds of each INTERACTIVE type a run may contain, in total — not per-slot-range.
#
# The old rule was "at most 2 of any verb in slots 2-7", applied only to the middle. It quietly
# produced three of each: slot 1 always took the opener (change_detection), slot 8 always took the
# hardest available (estimate), and the middle then added two more of each on top. A full-content
# day was 3 picture rounds + 3 estimates + 2 trivia — trivia, the thing the game is actually about,
# was the MINORITY of its own headline event, and the picture rounds in particular came round often
# enough to feel like the whole run.
#
# One or two of each, chosen per day from the date seed, so the mix varies rather than being a
# fixed template. Trivia fills whatever is left, which puts it back at 4-6 of the 8.
_INTERACTIVE_MIN = 1
_INTERACTIVE_MAX = 2

# Types capped at EXACTLY one per run, whatever else the day draws.
#
# `video` because it is three questions and several minutes — two would stop being a change of pace
# and become the mode. `memory_flash` because it is one four-step sequence with no content behind
# it: a second one in the same run is not a second puzzle, it is the same puzzle again.
_ONE_PER_RUN: frozenset[str] = frozenset({"video", "memory_flash"})

# The run must never contain fewer than this many trivia rounds.
#
# "The questions are the product. Everything else is packaging around eight questions a day" (§5c) —
# so a run that is mostly minigames is off-target however good the minigames are. This is a FLOOR
# rather than a preference because the capped budgets are drawn independently: with four capped
# types each able to take two slots, an unlucky day could leave a single trivia round in the whole
# Daily Royale. Adding a fifth type is exactly what made that reachable, which is why the floor
# arrived with `memory_flash`.
MIN_TRIVIA = 3

# How many shuffles to try before accepting a sequence that repeats an interactive type. Only ever
# reached on a day with no valid arrangement (see the note at the call site); on real content the
# first shuffle almost always passes.
_ADJACENCY_ATTEMPTS = 200


def verb_of(round_type: str) -> str:
    return ROYALE_TYPES[round_type].verb


def royale_type_sequence(date_seed: int, available_types: set[str]) -> list[str]:
    """The 8-type sequence for a date. `available_types` is the set of pool types with content
    today; anything else is dropped and backfilled. Deterministic in (date_seed, available)."""
    pool = [t for t in ROYALE_POOL if t in available_types]
    if not pool:
        raise ValueError("no Royale round types have content today")

    rng = Random(f"{date_seed}:royale-seq")

    # 1. How many of each CAPPED type today — 1 or 2, decided per day so the mix varies. This is a
    #    WHOLE-RUN budget: counting only the middle let slots 1 and 8 add a third of each on top
    #    without the rule noticing.
    capped = [t for t in pool if t != FILLER_TYPE]
    counts = {
        t: VIDEO_PER_RUN if t in _ONE_PER_RUN else rng.randint(_INTERACTIVE_MIN, _INTERACTIVE_MAX)
        for t in capped
    }

    #    Enforce the trivia floor by trimming the capped budgets, NOT by padding afterwards: the
    #    run is a fixed eight slots, so the only way to guarantee trivia rounds is to take them
    #    back off something else. Trim the biggest count first (a type on 2 gives one up before a
    #    type on 1 disappears entirely), ties broken by pool order so the result stays a pure
    #    function of the seed. Only runs when trivia is actually in the pool to protect.
    if FILLER_TYPE in pool:
        while sum(counts.values()) > ROUND_COUNT - MIN_TRIVIA:
            trimmable = [t for t in capped if counts[t] > 1]
            if not trimmable:
                break  # every capped type is already down to one; the floor yields to variety
            counts[max(trimmable, key=lambda t: (counts[t], -capped.index(t)))] -= 1

    # 2. Trivia fills the rest. If trivia has no content today the capped types stretch to fill the
    #    run rather than shorting it — a run must always be ROUND_COUNT rounds.
    slots: list[str] = [t for t, n in counts.items() for _ in range(n)]
    if FILLER_TYPE in pool:
        slots.extend([FILLER_TYPE] * (ROUND_COUNT - len(slots)))
    else:
        i = 0
        while len(slots) < ROUND_COUNT:
            slots.append(capped[i % len(capped)])
            i += 1
    # A very thin day could overshoot if the capped budgets alone exceed the run length.
    slots = slots[:ROUND_COUNT]

    # 3. Place the two pinned slots by REMOVING from the multiset, so neither can inflate the
    #    budget decided above. Slot 1 wants a fast visual opener; slot 8 wants the hardest type
    #    present. Both fall back to whatever is left rather than adding a round.
    def take(pred: Callable[[str], bool]) -> str:
        for i, t in enumerate(slots):
            if pred(t):
                return slots.pop(i)
        return slots.pop(0)

    opener = take(lambda t: ROYALE_TYPES[t].is_opener)
    top_rank = max(ROYALE_TYPES[t].difficulty_rank for t in slots) if slots else 0
    finale = take(lambda t: ROYALE_TYPES[t].difficulty_rank == top_rank)

    # 4. No two CAPPED rounds of the same type back to back.
    #
    #    Two picture rounds in a row is the same puzzle twice: the same 30-second flicker, the same
    #    verb, the same posture — it reads as the run stalling rather than progressing. Two
    #    estimates together, or two Simon grids, have the same problem. Trivia is exempt and
    #    deliberately so: consecutive trivia is just the game, and it is the filler that makes
    #    everything else add up to 8.
    #
    #    Rejection sampling rather than a constructive arrangement: with at most two of each
    #    capped type among eight slots, the overwhelming majority of shuffles already satisfy this,
    #    so the loop almost always exits on the first or second try and stays trivially correct.
    #    The bounded attempt count matters for the pathological case — a day with NO trivia content
    #    and only one other type has no valid arrangement at all, and a run must still be returned.
    #    Degrading to a merely-shuffled run beats failing to serve the Royale.
    for _ in range(_ADJACENCY_ATTEMPTS):
        rng.shuffle(slots)
        candidate = _place_video([opener, *slots, finale], rng)
        if _no_repeated_capped(candidate):
            return candidate

    rng.shuffle(slots)
    return _place_video([opener, *slots, finale], rng)


# 0-indexed positions of VIDEO_SLOTS. Neither the opener (0) nor the finale (7) is among them, so
# moving the video round can never disturb the two pinned slots.
_VIDEO_INDEXES: tuple[int, ...] = tuple(s - 1 for s in VIDEO_SLOTS)


def _place_video(seq: list[str], rng: Random) -> list[str]:
    """Move the video round, if present, onto one of its allowed slots.

    A swap rather than an insert: the multiset of types is already decided, so exchanging positions
    keeps every count intact. Whatever was sitting in the target slot takes video's old position.
    """
    if "video" not in seq:
        return seq
    here = seq.index("video")
    if here in _VIDEO_INDEXES:
        return seq
    there = rng.choice(_VIDEO_INDEXES)
    out = list(seq)
    out[here], out[there] = out[there], out[here]
    return out


def _no_repeated_capped(seq: list[str]) -> bool:
    """True when no two ADJACENT rounds are the same capped type. Only trivia may repeat.

    Keyed on "is not the filler" rather than on `interactive`, which is what it used to test: those
    were the same set until `memory_flash` — atomic, but every bit as repetitive twice in a row.
    """
    return not any(a == b and a != FILLER_TYPE for a, b in zip(seq, seq[1:], strict=False))
