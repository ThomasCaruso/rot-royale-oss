"""Daily Royale round-type sequencing: a constrained shuffle of round types, one order per ET
date (seeded), varying day to day. Pure function — no DB.

Rules (encoded in royale_sequencing.royale_type_sequence):
- 8 rounds.
- slot 1 (index 0): a fast visual/reaction opener (change_detection); backfilled from the pool if
  that type has no content today.
- slot 8 (index 7): the highest-difficulty type available that day (estimate > change > trivia).
- CAPPED types (everything except trivia) are budgeted across the WHOLE run: 1 or 2 each, chosen per
  date so the mix varies, except `video` and `memory_flash` which are exactly one. Trivia fills the
  rest and never drops below MIN_TRIVIA, which is what keeps the headline mode mostly questions.
  The pinned slots 1 and 8 are taken OUT of that budget, never added to it.
- a type with no content is dropped from the pool and backfilled; only-trivia → 8x trivia.

Note the split is FILLER_TYPE, not `interactive`. Those were the same set until `memory_flash`
joined the pool: it is atomic (generated, no cognition instance) yet still capped, because two
Simon grids in one run is the same puzzle twice.
"""

from __future__ import annotations

from collections import Counter

from app.services.royale_sequencing import (
    FILLER_TYPE,
    MIN_TRIVIA,
    ROYALE_POOL,
    ROYALE_TYPES,
    royale_type_sequence,
    verb_of,
)

ALL = {"trivia", "estimate", "change_detection"}


def test_metadata_shape():
    assert ROYALE_POOL == (
        "trivia",
        "change_detection",
        "estimate",
        "video",
        "memory_flash",
    )  # stable order
    assert verb_of("trivia") == "know"
    assert verb_of("change_detection") == "notice"
    assert verb_of("estimate") == "estimate"
    # Video shares `notice` with change detection: both ask the player to SPOT something rather
    # than recall or reason, so they feed the same sub-rating.
    assert verb_of("video") == "notice"
    # change_detection is the only opener; estimate is the hardest.
    assert ROYALE_TYPES["change_detection"].is_opener is True
    assert ROYALE_TYPES["trivia"].is_opener is False
    assert ROYALE_TYPES["estimate"].is_opener is False
    hardest = max(ROYALE_TYPES.values(), key=lambda m: m.difficulty_rank).type
    assert hardest == "estimate"
    # estimate + change are interactive; trivia is atomic.
    assert ROYALE_TYPES["estimate"].interactive is True
    assert ROYALE_TYPES["change_detection"].interactive is True
    assert ROYALE_TYPES["trivia"].interactive is False
    assert ROYALE_TYPES["video"].interactive is True
    # memory_flash is ATOMIC but still capped — it is generated, so it needs no cognition instance,
    # yet a second Simon grid in one run is the same puzzle twice. `interactive` and "is capped"
    # were the same set until this type existed; FILLER_TYPE is what the budget keys on now.
    assert ROYALE_TYPES["memory_flash"].interactive is False
    assert ROYALE_TYPES["memory_flash"].is_opener is True
    # NOT "know": it would otherwise feed the fixed trivia anchor (§5e).
    assert verb_of("memory_flash") == "notice"
    # Video must never open (the opener has to be fast) and must never be the finale (rank below
    # estimate), because a run that always ends on its longest round drags at the worst moment.
    assert ROYALE_TYPES["video"].is_opener is False
    assert ROYALE_TYPES["video"].difficulty_rank < ROYALE_TYPES["estimate"].difficulty_rank


def test_length_and_determinism():
    a = royale_type_sequence(12345, ALL)
    b = royale_type_sequence(12345, ALL)
    assert a == b
    assert len(a) == 8
    assert all(t in ALL for t in a)


def test_slots_1_and_8_constraints_full_pool():
    for seed in range(30):
        seq = royale_type_sequence(seed, ALL)
        assert seq[0] == "change_detection", "opener must be the visual/reaction type"
        assert seq[7] == "estimate", "finale must be the highest-difficulty type available"


def test_interactive_rounds_are_capped_across_the_WHOLE_run():
    """One or two picture rounds and one or two estimates per run — never three.

    This replaces a rule that counted only slots 2-7, and counted trivia too. Counting just the
    middle was the bug: slot 1 always took the visual opener and slot 8 always took the hardest
    type, so each interactive type got a third round that the rule never saw. A full-content day
    was 3 change + 3 estimate + 2 trivia, which made the picture rounds feel like the whole event
    and left trivia — the thing the game is about — as the minority of its own headline mode.
    """
    for seed in range(200):
        counts = Counter(royale_type_sequence(seed, ALL))
        assert 1 <= counts["change_detection"] <= 2, counts
        assert 1 <= counts["estimate"] <= 2, counts
        # Trivia is deliberately UNCAPPED — it is the filler that makes the rest add up to 8.
        assert counts["trivia"] >= 4, counts


def test_the_mix_actually_varies_day_to_day():
    """1-or-2 must mean both, not a fixed template that happens to satisfy the bounds."""
    mixes = {
        (
            Counter(royale_type_sequence(s, ALL))["change_detection"],
            Counter(royale_type_sequence(s, ALL))["estimate"],
        )
        for s in range(60)
    }
    assert len(mixes) >= 3, mixes


def test_varies_across_dates():
    seqs = {tuple(royale_type_sequence(s, ALL)) for s in range(40)}
    assert len(seqs) > 1  # the order changes day to day


def test_absent_type_never_appears_and_is_backfilled():
    # No change content: opener backfills from the pool; change_detection never appears.
    seq = royale_type_sequence(7, {"trivia", "estimate"})
    assert "change_detection" not in seq
    assert len(seq) == 8
    assert seq[7] == "estimate"  # still the hardest available

    # No estimate content: finale falls back to the next-hardest available (change_detection).
    seq2 = royale_type_sequence(7, {"trivia", "change_detection"})
    assert "estimate" not in seq2
    assert seq2[0] == "change_detection"
    assert seq2[7] == "change_detection"


def test_only_trivia_degrades_to_eight_trivia():
    seq = royale_type_sequence(99, {"trivia"})
    assert seq == ["trivia"] * 8


def test_empty_pool_raises():
    import pytest

    with pytest.raises(ValueError):
        royale_type_sequence(1, set())


def test_no_two_interactive_rounds_of_the_same_type_are_adjacent():
    """Never two picture rounds in a row, never two estimates in a row.

    Two of the same interactive type back to back is the same puzzle twice — the same flicker, the
    same verb, the same posture — and reads as the run stalling rather than progressing. Trivia is
    deliberately EXEMPT: consecutive trivia is just the game, and it is the filler that makes the
    rest add up to eight.
    """
    for seed in range(1000):
        seq = royale_type_sequence(seed, ALL)
        repeats = [a for a, b in zip(seq, seq[1:], strict=False) if a == b and a != FILLER_TYPE]
        assert not repeats, f"seed {seed}: {seq}"


def test_trivia_may_still_repeat():
    """The exemption is real, not incidental — trivia fills 4-6 of 8, so it MUST be able to."""
    assert any(
        any(a == b == "trivia" for a, b in zip(seq, seq[1:], strict=False))
        for seq in (royale_type_sequence(s, ALL) for s in range(40))
    )


def test_a_pool_with_no_valid_arrangement_still_returns_a_full_run():
    """Content starvation degrades, it does not fail.

    An estimate-only day cannot avoid adjacency: eight slots, one type. Serving a slightly
    repetitive Royale beats serving none, so the constraint relaxes rather than raising.
    """
    seq = royale_type_sequence(3, {"estimate"})
    assert seq == ["estimate"] * 8


# ── the video round ──────────────────────────────────────────────────────────────────────────


WITH_VIDEO = {"trivia", "estimate", "change_detection", "video"}


def test_exactly_one_video_round_per_run():
    """Never two. Two video rounds is six questions and several minutes inside an eight-round run —
    it stops being a change of pace and becomes the mode."""
    for seed in range(500):
        assert Counter(royale_type_sequence(seed, WITH_VIDEO))["video"] == 1, seed


def test_video_only_ever_lands_on_slot_3_6_or_7():
    """Not slot 1 (the opener must be fast), not slot 8 (never end on the longest round), and not
    slot 2 — that early, before the run has any rhythm, it reads as the whole game."""
    from app.services.royale_sequencing import VIDEO_SLOTS

    for seed in range(500):
        seq = royale_type_sequence(seed, WITH_VIDEO)
        assert seq.index("video") + 1 in VIDEO_SLOTS, f"seed {seed}: {seq}"


def test_video_uses_all_of_its_allowed_slots():
    """Pinned to three slots, not effectively pinned to one — otherwise the placement is a constant
    dressed up as a rule."""
    slots = {royale_type_sequence(s, WITH_VIDEO).index("video") + 1 for s in range(120)}
    assert slots == {3, 6, 7}, slots


def test_adding_video_does_not_break_the_other_guarantees():
    for seed in range(500):
        seq = royale_type_sequence(seed, WITH_VIDEO)
        counts = Counter(seq)
        assert len(seq) == 8
        assert 1 <= counts["change_detection"] <= 2, counts
        assert 1 <= counts["estimate"] <= 2, counts
        repeats = [
            a for a, b in zip(seq, seq[1:], strict=False) if a == b and ROYALE_TYPES[a].interactive
        ]
        assert not repeats, f"seed {seed}: {seq}"


def test_a_day_with_no_video_content_is_unchanged():
    """Video is dropped from the pool like any other absent type — no empty slot, no short run."""
    for seed in range(60):
        seq = royale_type_sequence(seed, ALL)
        assert "video" not in seq
        assert len(seq) == 8


# ── memory_flash: atomic, but capped and budgeted like every other non-trivia type ────────────

EVERYTHING = {"trivia", "change_detection", "estimate", "video", "memory_flash"}


def test_memory_flash_appears_and_is_capped_at_one():
    """Generated, so it has no content to run out of — it is in every run, exactly once.

    Twice would be the same four-step grid asked again in the same 90 seconds, which is not a
    second puzzle.
    """
    for seed in range(300):
        counts = Counter(royale_type_sequence(seed, EVERYTHING))
        assert counts["memory_flash"] == 1, f"seed {seed}: {counts}"


def test_trivia_never_falls_below_the_floor():
    """§5c: the questions are the product. Four capped types drawing 1-2 each could otherwise
    leave a single trivia round in the whole Daily Royale."""
    for seed in range(500):
        counts = Counter(royale_type_sequence(seed, EVERYTHING))
        assert counts[FILLER_TYPE] >= MIN_TRIVIA, f"seed {seed}: {counts}"


def test_an_atomic_capped_type_is_never_used_as_filler():
    """The regression that adding memory_flash created, and the reason FILLER_TYPE exists.

    The budget used to split on `interactive`, which was only coincidentally the same thing as
    "is capped": every capped type happened to be interactive, and trivia was the lone atomic one.
    memory_flash is atomic AND capped, so under the old rule it joined the filler pool — where a
    single rng.choice picks ONE type to fill every remaining slot. Roughly half of all days would
    have been five Simon grids in a row.
    """
    worst = max(
        Counter(royale_type_sequence(seed, EVERYTHING))["memory_flash"] for seed in range(500)
    )
    assert worst == 1, f"a run held {worst} memory_flash rounds"


def test_memory_flash_can_open_but_never_finishes_a_run():
    """It is a valid fast visual opener; it is also the lowest difficulty rank, so it must never
    be the finale — the run has to end on the hardest type available."""
    openers, finales = set(), set()
    for seed in range(300):
        seq = royale_type_sequence(seed, EVERYTHING)
        openers.add(seq[0])
        finales.add(seq[-1])
    assert "memory_flash" not in finales, finales
    # With change_detection present it wins the opener; memory_flash opens when it is not.
    only_mem = {"trivia", "estimate", "memory_flash"}
    assert royale_type_sequence(4, only_mem)[0] == "memory_flash"


def test_a_run_of_only_memory_flash_content_still_makes_eight_rounds():
    seq = royale_type_sequence(9, {"memory_flash"})
    assert seq == ["memory_flash"] * 8
