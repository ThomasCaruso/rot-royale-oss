"""Contest templates: a window's round composition, tunable without code changes.

Ranked is the Daily Royale: one `dr_8_trivia` template of 8 trivia rounds per ET date (the
frontend frames it as 4 presentation blocks — Opening/Pressure/Crown Climb/Final Crown — with no
scoring weight). The legacy morning/midday/night mixed templates and the original 20-question
`dr_20_trivia` run are retained ONLY so historical windows resolve their stored template_id; they
are never provisioned. The engine never changes — only this table does.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RoundSlot:
    type: str
    # Requested question difficulty for content modules (easy/medium/hard), or None = "any
    # difficulty". Ranked/practice-mixed slots use None so they draw across all difficulties;
    # category sessions use an explicit weighted mix (see CATEGORY_SESSION).
    difficulty: str | None


@dataclass(frozen=True)
class ContestTemplate:
    id: str
    rounds: tuple[RoundSlot, ...]


def _t(type_: str) -> RoundSlot:
    return RoundSlot(type_, None)


# M2 legacy template, kept resolvable for windows created before M4.
M2_TRIVIA_7 = ContestTemplate("m2_trivia_7", tuple(_t("trivia") for _ in range(7)))

# M4 per-slot mixes (7 rounds each, interleaved so the round set feels varied). Each slot has a
# different composition; adding a module = referencing it here, the engine never changes. The ranked
# windows stay mixed-trivia (trivia + rapid_math + memory_flash) across all categories — players
# never pick a category here, which preserves fair comparability.
MORNING = ContestTemplate(
    "m4_morning",
    (
        _t("trivia"),
        _t("rapid_math"),
        _t("trivia"),
        _t("memory_flash"),
        _t("trivia"),
        _t("rapid_math"),
        _t("trivia"),
    ),  # trivia×4, rapid×2, memory×1 — knowledge-heavy morning
)
MIDDAY = ContestTemplate(
    "m4_midday",
    (
        _t("rapid_math"),
        _t("trivia"),
        _t("rapid_math"),
        _t("memory_flash"),
        _t("trivia"),
        _t("rapid_math"),
        _t("memory_flash"),
    ),  # rapid×3, trivia×2, memory×2 — speed-heavy midday
)
NIGHT = ContestTemplate(
    "m4_night",
    (
        _t("trivia"),
        _t("rapid_math"),
        _t("memory_flash"),
        _t("trivia"),
        _t("rapid_math"),
        _t("trivia"),
        _t("memory_flash"),
    ),  # trivia×3, rapid×2, memory×2 — mixed night
)

# Daily Royale (current ranked format): a flat 8-question trivia run — trivia-only, no mini-games,
# no difficulty ramp. The streak multiplier provides the emergent climax; the frontend frames the 8
# questions as Opening / Pressure / Crown Climb / Final Crown rounds (2 each) for feel only.
DAILY_ROYALE = ContestTemplate("dr_8_trivia", tuple(_t("trivia") for _ in range(8)))

# Legacy Daily Royale (the original 20-question run): retained ONLY so historical windows created
# before the 8-question switch still resolve their stored template_id. Never provisioned now.
DAILY_ROYALE_20 = ContestTemplate("dr_20_trivia", tuple(_t("trivia") for _ in range(20)))

# Quick Play: the post-Royale casual loop — the Daily Royale's 8-question trivia shape without the
# stakes. Mixed across ALL categories (never scoped), any difficulty. Served through the practice
# entry path (window-less, no coins, no rating), so it can never touch standings.
QUICK_PLAY = ContestTemplate("quick_8", tuple(_t("trivia") for _ in range(8)))

# Starter Check (Brain Boost onboarding): a brand-new player's first-ever run — the Brain Boost's
# 8-question trivia shape with a gentle difficulty ramp, drawn from a category-balanced
# calibration bank (services/practice.py::_calibration_bank) so the first Brain Profile read
# spans categories. No stakes; practice entry path.
STARTER_CHECK = ContestTemplate(
    "starter_8",
    (
        RoundSlot("trivia", "easy"),
        RoundSlot("trivia", "easy"),
        RoundSlot("trivia", "medium"),
        RoundSlot("trivia", "easy"),
        RoundSlot("trivia", "medium"),
        RoundSlot("trivia", "medium"),
        RoundSlot("trivia", "medium"),
        RoundSlot("trivia", "hard"),
    ),  # easy×3, medium×4, hard×1
)

# Practice Mode (M8): a short 5-round mix across the module types. No stakes, playable anytime;
# reuses the same engine/scoring as contests.
PRACTICE = ContestTemplate(
    "practice_5",
    (
        _t("trivia"),
        _t("rapid_math"),
        _t("memory_flash"),
        _t("trivia"),
        _t("rapid_math"),
    ),
)


# Category session (categories milestone): 10 trivia questions, ONE category (the bank is
# pre-filtered to it by the service), drawn with a sensible difficulty mix — weighted toward
# easy/medium with some hard, interleaved. No stakes; reuses the practice entry path.
def _trivia(difficulty: str) -> RoundSlot:
    return RoundSlot("trivia", difficulty)


CATEGORY_SESSION = ContestTemplate(
    "category_10",
    (
        _trivia("easy"),
        _trivia("medium"),
        _trivia("easy"),
        _trivia("medium"),
        _trivia("hard"),
        _trivia("easy"),
        _trivia("medium"),
        _trivia("easy"),
        _trivia("medium"),
        _trivia("hard"),
    ),  # easy×4, medium×4, hard×2
)

# Duel (best-of-7): 10 trivia rounds = 7 normal + 3 reserved sudden-death. Mixed categories like
# ranked (no category pick) for fair comparability. The duel only uses as many rounds as the match
# needs; unused sudden-death rounds are simply never played.
DUEL_BO7 = ContestTemplate("duel_bo7", tuple(_t("trivia") for _ in range(10)))

TEMPLATES: dict[str, ContestTemplate] = {
    t.id: t
    for t in (
        M2_TRIVIA_7,
        MORNING,
        MIDDAY,
        NIGHT,
        DAILY_ROYALE,
        DAILY_ROYALE_20,
        QUICK_PLAY,
        STARTER_CHECK,
        PRACTICE,
        CATEGORY_SESSION,
        DUEL_BO7,
    )
}

SLOT_TEMPLATES: dict[str, str] = {
    # Current ranked slot.
    "royale": DAILY_ROYALE.id,
    # Legacy slots: never provisioned now, kept so historical windows still resolve their template.
    "morning": MORNING.id,
    "midday": MIDDAY.id,
    "night": NIGHT.id,
}


def get_template(template_id: str) -> ContestTemplate:
    return TEMPLATES[template_id]
