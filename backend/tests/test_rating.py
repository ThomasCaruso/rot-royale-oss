"""Division derivation from rating (app.services.rating)."""

from __future__ import annotations

import pytest
from app.services.rating import division_for_rating


def test_starting_rating_is_bronze():
    assert division_for_rating(1000) == "Bronze"


@pytest.mark.parametrize(
    ("rating", "division"),
    [
        (0, "Bronze"),
        (1099, "Bronze"),
        (1100, "Silver"),
        (1300, "Gold"),
        (1500, "Platinum"),
        (1700, "Diamond"),
        (1900, "Apex"),
        (5000, "Apex"),
    ],
)
def test_division_brackets(rating: int, division: str):
    assert division_for_rating(rating) == division
