"""Rating → division mapping (PLAN.md §7).

Divisions are derived from rating and stored on the profile (updated when rating changes, M4).
Thresholds are tunable in one place. A new player at rating 1000 is Bronze.
"""

from __future__ import annotations

# (min_rating_inclusive, division), highest first.
DIVISION_THRESHOLDS: list[tuple[int, str]] = [
    (1900, "Apex"),
    (1700, "Diamond"),
    (1500, "Platinum"),
    (1300, "Gold"),
    (1100, "Silver"),
    (0, "Bronze"),
]


def division_for_rating(rating: int) -> str:
    for threshold, division in DIVISION_THRESHOLDS:
        if rating >= threshold:
            return division
    return "Bronze"
