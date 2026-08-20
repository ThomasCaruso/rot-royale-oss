"""Map the skill model's category ability (theta) to a player-facing mastery level (Phase 3)."""

from __future__ import annotations

from typing import Any

from app.core.constants import MASTERY_LEVEL_CUTS, MASTERY_LEVELS, MASTERY_MIN_ATTEMPTS


def theta_to_level(theta: float, attempts: int) -> int:
    """Mastery level 1..MASTERY_LEVELS, or 0 ("warming up") until the player has answered enough in
    this category to trust the estimate."""
    if attempts < MASTERY_MIN_ATTEMPTS:
        return 0
    level = 1
    for cut in MASTERY_LEVEL_CUTS:
        if theta >= cut:
            level += 1
    return level


def mastery_from_state(state: Any | None, categories: tuple[str, ...]) -> list[dict[str, Any]]:
    """Per-category mastery, one entry per canonical category, in the given order."""
    ability = (getattr(state, "category_ability", None) or {}) if state is not None else {}
    out: list[dict[str, Any]] = []
    for cat in categories:
        c = ability.get(cat)
        theta = float(c["theta"]) if c else 0.0
        attempts = int(c["attempts"]) if c else 0
        level = theta_to_level(theta, attempts)
        out.append(
            {
                "category": cat,
                "level": level,
                "attempts": attempts,
                "mastered": level >= MASTERY_LEVELS,
            }
        )
    return out
