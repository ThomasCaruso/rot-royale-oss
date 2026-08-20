"""Daily Royale round-type sequencing: a constrained shuffle of round types, one order per ET
date (seeded), varying day to day. Pure function — no DB.

Rules (encoded in royale_sequencing.royale_type_sequence):
- 8 rounds.
- slot 1 (index 0): a fast visual/reaction opener (change_detection); backfilled from the pool if
  that type has no content today.
- slot 8 (index 7): the highest-difficulty type available that day (estimate > change > trivia).
- slots 2-7 (indexes 1-6): drawn from the pool, at most 2 of any one verb.
- a type with no content is dropped from the pool and backfilled; only-trivia → 8x trivia (today's
  behaviour).
"""

from __future__ import annotations

from collections import Counter

from app.services.royale_sequencing import (
    ROYALE_POOL,
    ROYALE_TYPES,
    royale_type_sequence,
    verb_of,
)

ALL = {"trivia", "estimate", "change_detection"}


def test_metadata_shape():
    assert ROYALE_POOL == ("trivia", "change_detection", "estimate")  # pool order (stable)
    assert verb_of("trivia") == "know"
    assert verb_of("change_detection") == "notice"
    assert verb_of("estimate") == "estimate"
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


def test_middle_has_at_most_two_of_any_verb():
    for seed in range(50):
        middle = royale_type_sequence(seed, ALL)[1:7]
        counts = Counter(verb_of(t) for t in middle)
        assert all(c <= 2 for c in counts.values()), counts


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
