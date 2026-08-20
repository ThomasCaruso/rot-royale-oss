"""Canonical category taxonomy (categories milestone).

These strings are the LOCKED set of categories. The category picker shows exactly these; ingest
rejects any row whose category is not one of them (so a typo can't create a near-duplicate). The
legacy placeholder seed (trivia.json) used nine ad-hoc categories — LEGACY_CATEGORY_MAP folds them
into the canonical set, and a data migration applies the same map to already-seeded rows.

"Money & Business" (Brain Boost / self-improvement positioning) is the seventh: financial-literacy
and business general knowledge — money basics, investing concepts, business models, world economy,
scams & street smarts. General knowledge only, NEVER personal financial advice. It has a seed bank
(content/bank/money_business.json) but no campaign world (category sessions work standalone).

"Street Smarts" is the eighth: "fun trivia about how the world actually works" — the curiosity/
hidden-incentive lane (money moves, market madness, scam radar, brand games, world control,
internet IQ). It umbrellas that whole vibe across topics; the individual lanes live inside it as
AI topic_tags, not as separate categories. Seed bank content/bank/street_smarts.json; no
campaign world (category sessions work standalone). Curiosity first — never "practical/adulting".
"""

from __future__ import annotations

CANONICAL_CATEGORIES: tuple[str, ...] = (
    "Science & Nature",
    "History",
    "Geography",
    "Arts & Literature",
    "Sports",
    "Pop Culture & Entertainment",
    "Money & Business",
    "Street Smarts",
)

# Legacy seed category -> canonical. Every old category folds into exactly one of the six.
LEGACY_CATEGORY_MAP: dict[str, str] = {
    "Science": "Science & Nature",
    "Nature": "Science & Nature",
    "Numbers": "Science & Nature",
    "Geography": "Geography",
    "History": "History",
    "Sports": "Sports",
    "Pop Culture": "Pop Culture & Entertainment",
    "Music": "Arts & Literature",
    "Language": "Arts & Literature",
}
