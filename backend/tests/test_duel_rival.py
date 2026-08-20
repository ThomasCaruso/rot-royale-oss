"""Task 3.2: DUEL_BO7 template + deterministic make_duel_rival rival generator."""

from __future__ import annotations

import pytest
from app.services.bots import DUEL_RIVAL_TIERS, make_duel_rival
from app.services.templates import get_template


def test_duel_bo7_template() -> None:
    t = get_template("duel_bo7")
    assert len(t.rounds) == 10
    assert all(r.type == "trivia" for r in t.rounds)
    assert all(r.difficulty is None for r in t.rounds)


def test_make_duel_rival_deterministic() -> None:
    a = make_duel_rival(12345, "sharp", 10)
    b = make_duel_rival(12345, "sharp", 10)
    assert a == b


def test_make_duel_rival_varies_by_seed() -> None:
    assert make_duel_rival(1, "sharp", 10) != make_duel_rival(2, "sharp", 10)


def test_make_duel_rival_varies_by_tier() -> None:
    # Different tiers off the SAME seed must differ (tier salt feeds the RNG).
    assert make_duel_rival(7, "sharp", 10) != make_duel_rival(7, "solid", 10)


@pytest.mark.parametrize("num_rounds", [1, 7, 10])
@pytest.mark.parametrize("tier", list(DUEL_RIVAL_TIERS))
def test_make_duel_rival_shape(tier: str, num_rounds: int) -> None:
    rounds = make_duel_rival(99, tier, num_rounds)
    assert len(rounds) == num_rounds
    for r in rounds:
        assert isinstance(r["correct"], bool)
        assert isinstance(r["time_frac"], float)
        assert 0.0 <= r["time_frac"] <= 1.0


def test_make_duel_rival_tier_monotonicity() -> None:
    """Over many seeds, mean correctness ranks elite > sharp > solid > rookie."""
    seeds = range(1000, 1200)  # 200 fixed seeds → deterministic

    def mean_correct(tier: str) -> float:
        total = 0.0
        n = 0
        for s in seeds:
            rounds = make_duel_rival(s, tier, 10)
            total += sum(1 for r in rounds if r["correct"])
            n += len(rounds)
        return total / n

    rookie = mean_correct("rookie")
    solid = mean_correct("solid")
    sharp = mean_correct("sharp")
    elite = mean_correct("elite")
    assert elite > sharp > solid > rookie


def test_make_duel_rival_unknown_tier() -> None:
    with pytest.raises(ValueError):
        make_duel_rival(1, "wizard", 7)
