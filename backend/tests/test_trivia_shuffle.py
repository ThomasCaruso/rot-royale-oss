"""Server-side option shuffle for trivia (fairness fix: skewed banks showed "every answer is A").

`trivia_spec` shuffles each question's options server-side, keyed on (shuffle_seed, question id),
and remaps `correctIndex` into server_answer only. These tests pin the anti-cheat + reproducibility
contract and the regression: a bank where every correctIndex is 0 must NOT serve every correct
answer in position A.
"""

from __future__ import annotations

from typing import Any

from app.modules.base import GenerationContext
from app.modules.trivia import TriviaModule, trivia_spec
from app.services.campaign import _build_campaign_round_set
from content.campaign import manifest as cm
from content.campaign.keys import question_key


def _q(qid: str, options: list[str], correct: int, *, category: str = "Science & Nature") -> dict:
    return {
        "id": qid,
        "category": category,
        "icon": "🔬",
        "difficulty": "easy",
        "payload": {"prompt": f"prompt-{qid}?", "options": options, "correctIndex": correct},
    }


# --- trivia_spec unit contract --------------------------------------------------------------


def test_remapped_correct_option_text_matches_source():
    # (a) shuffled[new_correct] is the SAME option text as the source correct option — across every
    # source position and a spread of seeds, so the remap math is right regardless of permutation.
    options = ["alpha", "bravo", "charlie", "delta"]
    for correct in range(4):
        q = _q("q1", options, correct)
        for seed in range(50):
            client_spec, server_answer = trivia_spec(q, shuffle_seed=seed)
            new_correct = server_answer["correctIndex"]
            assert client_spec["options"][new_correct] == options[correct]


def test_shuffle_is_a_permutation_no_dupes_or_drops():
    # (d) the served options are exactly the source options, reordered — nothing added/lost/duped.
    options = ["alpha", "bravo", "charlie", "delta"]
    q = _q("q2", options, 0)
    for seed in range(50):
        served = trivia_spec(q, shuffle_seed=seed)[0]["options"]
        assert sorted(served) == sorted(options)
        assert len(set(served)) == len(options)


def test_shuffle_is_deterministic_in_seed_and_question():
    # (b) same (shuffle_seed, q) → byte-identical client_spec + server_answer, twice.
    q = _q("q3", ["a", "b", "c", "d"], 2)
    first = trivia_spec(q, shuffle_seed=12345)
    second = trivia_spec(q, shuffle_seed=12345)
    assert first == second


def test_different_seeds_generally_yield_different_orders():
    # (c) across many seeds the served order is not stuck on identity / one arrangement.
    q = _q("q4", ["a", "b", "c", "d"], 0)
    orders = {tuple(trivia_spec(q, shuffle_seed=s)[0]["options"]) for s in range(40)}
    assert len(orders) > 1  # not all seeds map to the same order
    # at least one seed produces a genuinely non-identity arrangement (the position moved)
    assert any(o != ("a", "b", "c", "d") for o in orders)


def test_different_questions_shuffle_independently_under_one_seed():
    # The salt includes the question id, so two questions under the SAME seed shuffle differently
    # (decorrelates positions across a level, which is the whole point of the fix).
    seed = 999
    orders = {
        tuple(trivia_spec(_q(f"qid-{i}", ["a", "b", "c", "d"], 0), shuffle_seed=seed)[0]["options"])
        for i in range(40)
    }
    assert len(orders) > 1


def test_answer_never_leaks_into_client_spec():
    q = _q("q5", ["a", "b", "c", "d"], 0)
    client_spec, _ = trivia_spec(q, shuffle_seed=7)
    assert "correctIndex" not in client_spec
    assert "question_id" not in client_spec


def test_module_generate_uses_ctx_seed_and_dedup_holds():
    # The shuffle salt is ctx.seed (NOT consumed from rng), so re-drawing the same q yields an
    # identical client_spec — preserving the engine's client_spec-hash dedup.
    from random import Random

    bank = [_q("only", ["a", "b", "c", "d"], 0)]
    module = TriviaModule()
    ctx = GenerationContext(bank=bank, seed=4242)
    spec_a, ans_a = module.generate(Random(1), None, ctx)
    # different rng, same q (single-item bank) → same client_spec
    spec_b, ans_b = module.generate(Random(2), None, ctx)
    assert spec_a == spec_b  # identical client_spec → engine dedup sees them as the same round
    assert ans_a == ans_b


# --- regression: the reported "every answer is A" bug ---------------------------------------


def _skewed_level_and_bank() -> tuple[cm.CampaignLevel, list[dict[str, Any]]]:
    """A synthetic 10-question Science level over a bank where EVERY question has correctIndex 0 —
    exactly the skew in the real science/pop banks that surfaced the bug."""
    category = "Science & Nature"
    bank: list[dict[str, Any]] = []
    for i in range(10):
        bank.append(
            {
                "id": f"sci-{i}",
                "category": category,
                "icon": "🔬",
                "difficulty": "easy",
                "payload": {
                    "prompt": f"Science question {i}?",
                    "options": [f"correct-{i}", f"w1-{i}", f"w2-{i}", f"w3-{i}"],
                    "correctIndex": 0,  # <-- the skew: always position A in source order
                },
            }
        )
    keys = tuple(question_key(category, q["payload"]["prompt"]) for q in bank)
    level = cm.CampaignLevel(
        world="Science",
        category=category,
        arc_name="Arc 1",
        level_number=1,
        title="Test",
        is_boss=False,
        difficulty_mix={"easy": 10},
        question_keys=keys,
    )
    return level, bank


def test_skewed_bank_does_not_serve_every_correct_in_position_a():
    level, bank = _skewed_level_and_bank()
    rounds = _build_campaign_round_set(level, bank, seed=20240610)

    served_indices = [r.server_answer["correctIndex"] for r in rounds]
    assert len(served_indices) == 10
    # The bug: all served correct indices were 0 (position A). The fix decorrelates them.
    assert len(set(served_indices)) > 1, "served correct positions are still all identical"
    assert not all(i == 0 for i in served_indices), "every correct answer is still position A"

    # No answer corruption: each round's served correct OPTION TEXT equals the source correct text.
    by_id = {q["id"]: q for q in bank}
    for r in rounds:
        src = by_id[r.server_answer["question_id"]]
        src_correct_text = src["payload"]["options"][src["payload"]["correctIndex"]]
        served_correct_text = r.client_spec["options"][r.server_answer["correctIndex"]]
        assert served_correct_text == src_correct_text
        # and the served options are a permutation of the source options
        assert sorted(r.client_spec["options"]) == sorted(src["payload"]["options"])


def test_campaign_round_set_is_reproducible_from_seed():
    level, bank = _skewed_level_and_bank()
    a = _build_campaign_round_set(level, bank, seed=555)
    b = _build_campaign_round_set(level, bank, seed=555)
    assert [r.client_spec for r in a] == [r.client_spec for r in b]
    assert [r.server_answer for r in a] == [r.server_answer for r in b]
    # A different seed generally produces a different arrangement.
    c = _build_campaign_round_set(level, bank, seed=556)
    assert [r.client_spec for r in a] != [r.client_spec for r in c]
