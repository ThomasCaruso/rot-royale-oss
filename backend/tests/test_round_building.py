"""Category-scoped + difficulty-aware round building (categories milestone).

A category session is 10 trivia questions drawn with a sensible difficulty mix (easy/medium-heavy,
some hard). The ranked windows stay MIXED across categories — category scoping is achieved by
pre-filtering the bank, so the engine itself never learns about categories.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

import app.modules  # noqa: F401  - register modules so build_round_set can look them up
from app.modules.base import GenerationContext
from app.services.engine import build_round_set
from app.services.templates import (
    CATEGORY_SESSION,
    MORNING,
    get_template,  # noqa: F401  (ensures module import side effects)
)


def _q(prompt: str, category: str, difficulty: str) -> dict[str, Any]:
    return {
        "id": prompt,  # any stable unique id
        "category": category,
        "icon": "🔬",
        "difficulty": difficulty,
        "explanation": "because",
        "payload": {"prompt": prompt, "options": ["a", "b", "c", "d"], "correctIndex": 0},
    }


def _rich_science_bank() -> list[dict[str, Any]]:
    bank: list[dict[str, Any]] = []
    for d in ("easy", "medium", "hard"):
        for n in range(4):  # >= 2 of each difficulty so the mix is satisfiable without fallback
            bank.append(_q(f"sci-{d}-{n}", "Science", d))
    return bank


def test_category_session_is_ten_questions():
    ctx = GenerationContext(bank=_rich_science_bank())
    rounds = build_round_set(123, CATEGORY_SESSION, ctx)
    assert len(rounds) == 10
    assert all(r.module_type == "trivia" for r in rounds)


def test_category_session_difficulty_mix_matches_template_and_is_not_flat():
    ctx = GenerationContext(bank=_rich_science_bank())
    rounds = build_round_set(7, CATEGORY_SESSION, ctx)
    served = Counter(r.server_answer["difficulty"] for r in rounds)
    template_mix = Counter(slot.difficulty for slot in CATEGORY_SESSION.rounds)
    assert served == template_mix  # served difficulties follow the template's mix
    assert len(served) == 3 and served["hard"] >= 1  # not all-flat: spans easy/medium/hard


def test_template_mix_is_weighted_easy_medium_with_some_hard():
    mix = Counter(slot.difficulty for slot in CATEGORY_SESSION.rounds)
    assert sum(mix.values()) == 10
    assert mix["hard"] >= 1  # some hard...
    assert mix["easy"] + mix["medium"] > mix["hard"]  # ...but weighted toward easy/medium


def test_thin_category_falls_back_when_a_difficulty_is_missing():
    # A category with ONLY easy questions still yields a full 10-question session (graceful),
    # never an error — the placeholder bank will hit this constantly.
    thin = [_q(f"e-{n}", "Science", "easy") for n in range(6)]
    ctx = GenerationContext(bank=thin)
    rounds = build_round_set(1, CATEGORY_SESSION, ctx)
    assert len(rounds) == 10
    assert {r.server_answer["difficulty"] for r in rounds} == {"easy"}  # fell back to what exists


def test_category_scoped_bank_locks_to_one_category_but_ranked_stays_mixed():
    two_cat = [_q(f"sci-{n}", "Science", "easy") for n in range(6)] + [
        _q(f"his-{n}", "History", "easy") for n in range(6)
    ]
    # Category-scoped: pre-filter the bank → every trivia round is that one category.
    scoped = build_round_set(
        3,
        CATEGORY_SESSION,
        GenerationContext(bank=[q for q in two_cat if q["category"] == "Science"]),
    )
    assert {r.client_spec["category"] for r in scoped} == {"Science"}

    # Ranked: full bank, no category scoping → trivia is drawn across categories. Asserted as the
    # union over fixed seeds (deterministic) so it isn't flaky on a single seed.
    seen: set[str] = set()
    for seed in range(10):
        for r in build_round_set(seed, MORNING, GenerationContext(bank=two_cat)):
            if r.module_type == "trivia":
                seen.add(r.client_spec["category"])
    assert seen == {"Science", "History"}  # ranked windows are not locked to one category
