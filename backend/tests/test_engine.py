"""Seeded round-set generation (docs/architecture.md)."""

from __future__ import annotations

import app.modules  # noqa: F401 - register trivia
from app.modules.base import GenerationContext
from app.services.engine import build_round_set
from app.services.templates import ContestTemplate, RoundSlot

TEMPLATE = ContestTemplate("t7", tuple(RoundSlot("trivia", 1) for _ in range(7)))


def _bank(n: int) -> list[dict]:
    return [
        {
            "id": f"q{i}",
            "category": "Cat",
            "icon": "❓",
            "difficulty": 1,
            "payload": {"prompt": f"P{i}?", "options": ["a", "b", "c", "d"], "correctIndex": i % 4},
        }
        for i in range(n)
    ]


def test_build_is_deterministic_from_seed():
    a = build_round_set(123, TEMPLATE, GenerationContext(bank=_bank(20)))
    b = build_round_set(123, TEMPLATE, GenerationContext(bank=_bank(20)))
    assert [r.client_spec for r in a] == [r.client_spec for r in b]
    assert [r.server_answer for r in a] == [r.server_answer for r in b]


def test_different_seeds_produce_different_sets():
    a = build_round_set(1, TEMPLATE, GenerationContext(bank=_bank(20)))
    b = build_round_set(2, TEMPLATE, GenerationContext(bank=_bank(20)))
    ids_a = [r.server_answer["question_id"] for r in a]
    ids_b = [r.server_answer["question_id"] for r in b]
    assert ids_a != ids_b


def test_client_spec_never_leaks_answer():
    rounds = build_round_set(7, TEMPLATE, GenerationContext(bank=_bank(20)))
    for r in rounds:
        assert "correctIndex" not in r.client_spec
        assert "question_id" not in r.client_spec
        assert "prompt" in r.client_spec and "options" in r.client_spec


def test_dedupes_within_a_contest():
    rounds = build_round_set(5, TEMPLATE, GenerationContext(bank=_bank(7)))
    ids = [r.server_answer["question_id"] for r in rounds]
    assert len(set(ids)) == 7  # all distinct when the bank exactly fits
