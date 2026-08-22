"""Per-slot contest templates. Different slots → different mixed round compositions."""

from __future__ import annotations

import app.modules  # noqa: F401 - register modules so build_round_set can look them up
from app.modules.base import GenerationContext
from app.services.engine import build_round_set
from app.services.templates import DAILY_ROYALE, SLOT_TEMPLATES, get_template

# Legacy slots remain registered for historical-window template resolution; only `royale` is
# provisioned going forward.
LEGACY_SLOTS = {"morning", "midday", "night"}


def _trivia_bank(n: int) -> list[dict]:
    return [
        {
            "id": f"q{i}",
            "category": "Cat",
            "icon": "❓",
            "difficulty": 1,
            "payload": {"prompt": f"P{i}?", "options": ["a", "b", "c", "d"], "correctIndex": 0},
        }
        for i in range(n)
    ]


def test_every_slot_has_a_template():
    # Current ranked slot + legacy slots (kept resolvable for historical windows).
    assert set(SLOT_TEMPLATES) == {"royale"} | LEGACY_SLOTS
    for tid in SLOT_TEMPLATES.values():
        assert get_template(tid).rounds  # resolvable + non-empty


def test_royale_is_8_trivia():
    tmpl = get_template(SLOT_TEMPLATES["royale"])
    assert tmpl.id == DAILY_ROYALE.id
    assert len(tmpl.rounds) == 8
    assert all(s.type == "trivia" for s in tmpl.rounds)  # flat trivia-only Daily Royale


def test_legacy_slots_still_resolve_to_mixed_compositions():
    # Legacy morning/midday/night templates remain meaningful (mixed) for historical reconstruction.
    for slot in LEGACY_SLOTS:
        tid = SLOT_TEMPLATES[slot]
        types = {s.type for s in get_template(tid).rounds}
        assert len(types) >= 2, f"{tid} is not a mix"


def test_build_round_set_follows_royale_template_order():
    template = get_template(SLOT_TEMPLATES["royale"])
    rounds = build_round_set(123, template, GenerationContext(bank=_trivia_bank(20)))
    assert [r.module_type for r in rounds] == [s.type for s in template.rounds]
    assert len(rounds) == 8
    assert all(r.module_type == "trivia" for r in rounds)
