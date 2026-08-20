"""rapid_math + memory_flash round modules (PLAN.md §5)."""

from __future__ import annotations

from random import Random

from app.modules.base import GenerationContext
from app.modules.memory_flash import MemoryFlashModule
from app.modules.rapid_math import RapidMathModule

CTX = GenerationContext()  # generated modules ignore content


# ---------------- rapid_math ----------------
def _eval_prompt(prompt: str) -> int:
    """Evaluate the displayed expression with correct operator precedence (×/− are U+00D7/U+2212).

    The string contains only digits, spaces and + - * after translation, so eval is safe here and
    gives the reference value INCLUDING precedence (so a two-operator prompt is checked properly).
    """
    expr = prompt.removesuffix(" = ?").replace("×", "*").replace("−", "-")
    return int(eval(expr, {"__builtins__": {}}, {}))  # noqa: S307 - digits/+-* only


def test_rapid_math_options_consistent_and_no_leak():
    for seed in range(200):
        m = RapidMathModule()
        client_spec, server_answer = m.generate(Random(seed), 1, CTX)
        opts = client_spec["options"]
        assert len(opts) == 4 and len(set(opts)) == 4  # four DISTINCT options
        assert all(int(o) >= 0 for o in opts)  # no negative distractors
        idx = server_answer["correctIndex"]
        assert 0 <= idx < 4
        # the option at correctIndex equals the actual (precedence-correct) arithmetic result
        assert opts[idx] == str(server_answer["value"]) == str(_eval_prompt(client_spec["prompt"]))
        # client spec must not leak the answer index/value
        assert "correctIndex" not in client_spec
        assert "value" not in client_spec


def test_rapid_math_is_harder_but_bounded():
    """Wider than the old single-digit single-op generator, but tuned for ~8–10s mental math — not
    prodigy-level. Across many seeds we expect two-operator prompts and multi-digit operands to
    appear, while every answer stays within a sane ceiling."""
    prompts = [RapidMathModule().generate(Random(s), 1, CTX)[0]["prompt"] for s in range(300)]
    values = [_eval_prompt(p) for p in prompts]

    def operand_count(p: str) -> int:
        return sum(tok.isdigit() for tok in p.removesuffix(" = ?").split())

    # harder than before: some prompts chain two operators (three operands)...
    assert any(operand_count(p) == 3 for p in prompts), "no two-operator questions generated"
    # ...and some use multi-digit operands (the old generator capped operands ~12)
    assert any(any(tok.isdigit() and int(tok) >= 13 for tok in p.split()) for p in prompts), (
        "no multi-digit operands generated"
    )
    # not a gimme: a meaningful share clear a low bar
    assert sum(v >= 30 for v in values) > len(values) // 4
    # ...but bounded so it stays quick mental math, not a calculator problem
    assert max(values) <= 200, f"answer {max(values)} too large for quick mental math"
    assert min(values) >= 0


def test_rapid_math_is_deterministic():
    m = RapidMathModule()
    assert m.generate(Random(42), 1, CTX) == m.generate(Random(42), 1, CTX)


def test_rapid_math_scores_choice():
    m = RapidMathModule()
    _, server_answer = m.generate(Random(7), 1, CTX)
    correct = m.score(server_answer, {"choice": server_answer["correctIndex"], "elapsed_ms": 0})
    wrong = m.score(
        server_answer, {"choice": (server_answer["correctIndex"] + 1) % 4, "elapsed_ms": 0}
    )
    assert correct.correct is True and correct.valid is True and correct.time_frac == 1.0
    assert wrong.correct is False


# ---------------- memory_flash ----------------
def test_memory_flash_sequence_in_both_specs():
    m = MemoryFlashModule()
    client_spec, server_answer = m.generate(Random(3), 1, CTX)
    # the sequence is the stimulus, so it's legitimately in client_spec (player must watch it),
    # and also stored server-side for validating the tapped input.
    assert client_spec["sequence"] == server_answer["sequence"]
    assert len(server_answer["sequence"]) >= 3
    assert all(0 <= v < client_spec["tiles"] for v in server_answer["sequence"])


def test_memory_flash_correct_when_taps_match():
    m = MemoryFlashModule()
    _, server_answer = m.generate(Random(5), 1, CTX)
    seq = server_answer["sequence"]
    judged = m.score(
        server_answer,
        {"taps": list(seq), "tap_times": [100 * i for i in range(len(seq))], "elapsed_ms": 0},
    )
    assert judged.correct is True
    assert judged.valid is True
    assert judged.time_frac == 1.0


def test_memory_flash_wrong_when_taps_differ():
    m = MemoryFlashModule()
    _, server_answer = m.generate(Random(5), 1, CTX)
    seq = server_answer["sequence"]
    bad = list(seq)
    bad[-1] = (bad[-1] + 1) % 6
    judged = m.score(server_answer, {"taps": bad, "tap_times": [], "elapsed_ms": 3500})
    assert judged.correct is False


def test_memory_flash_is_deterministic():
    m = MemoryFlashModule()
    assert m.generate(Random(9), 1, CTX) == m.generate(Random(9), 1, CTX)


# plausibility: reject only the clearly-impossible (bias to false-negatives, §7 anti-cheat)
def _seq():
    return MemoryFlashModule().generate(Random(5), 1, CTX)[1]["sequence"]


def test_memory_legit_taps_are_valid():
    m = MemoryFlashModule()
    sa = {"sequence": _seq()}
    j = m.score(
        sa, {"taps": list(sa["sequence"]), "tap_times": [80, 360, 700, 1050], "elapsed_ms": 1100}
    )
    assert j.valid is True and j.correct is True


def test_memory_all_zero_tap_times_is_invalid():
    # the spoof: "perfect" taps submitted instantly (elapsed 0, all timestamps 0)
    m = MemoryFlashModule()
    sa = {"sequence": _seq()}
    j = m.score(sa, {"taps": list(sa["sequence"]), "tap_times": [0, 0, 0, 0], "elapsed_ms": 0})
    assert j.valid is False


def test_memory_nonmonotonic_tap_times_is_invalid():
    m = MemoryFlashModule()
    sa = {"sequence": _seq()}
    j = m.score(
        sa, {"taps": list(sa["sequence"]), "tap_times": [80, 700, 360, 1050], "elapsed_ms": 1100}
    )
    assert j.valid is False


def test_memory_out_of_range_tap_time_is_invalid():
    m = MemoryFlashModule()
    sa = {"sequence": _seq()}
    j = m.score(
        sa, {"taps": list(sa["sequence"]), "tap_times": [80, 360, 700, 999999], "elapsed_ms": 1100}
    )
    assert j.valid is False


def test_memory_tap_count_mismatch_is_invalid():
    m = MemoryFlashModule()
    sa = {"sequence": _seq()}
    j = m.score(sa, {"taps": list(sa["sequence"]), "tap_times": [80, 360], "elapsed_ms": 1100})
    assert j.valid is False


# ---------------- M-1 regression: crafted submit input must never raise (500) ----------------
def test_score_never_raises_on_crafted_input():
    """M-1: `submission` is opaque client JSON, so score() must not 500 on hostile values.

    `elapsed_ms: 1e999` parses (valid JSON) to float inf; `int(inf)` raises OverflowError, which the
    modules' original `except (TypeError, ValueError)` did NOT catch. memory_flash also compared
    `taps`/`tap_times` assuming lists of ints. All reachable from /answer and /submit. Each of these
    once produced an unhandled 500 with a rolled-back transaction; now they must degrade to a
    zero-value reading (time_frac in [0,1], not correct)."""
    from app.modules.trivia import TriviaModule

    tr = TriviaModule()
    ta = {"correctIndex": 0}
    for bad in [
        {"elapsed_ms": 1e999, "choice": 0},  # -> OverflowError before the fix
        {"elapsed_ms": float("inf"), "choice": 0},
        {"elapsed_ms": "not-a-number", "choice": 0},
        {"elapsed_ms": None},
        {"elapsed_ms": [1, 2], "choice": 0},
        {},
    ]:
        j = tr.score(ta, bad)
        assert 0.0 <= j.time_frac <= 1.0

    mf = MemoryFlashModule()
    sa = {"sequence": [0, 1, 2, 3]}
    for bad in [
        {"taps": 5},  # -> TypeError: 'int' object is not iterable, before the fix
        {"taps": "0123"},
        {"taps": [1], "tap_times": ["a"]},  # -> TypeError on comparison
        {"taps": [True, False], "tap_times": [0, 1]},
        {"taps": [0, 1, 2, 3], "tap_times": [0, 50, 100, 151], "elapsed_ms": 1e999},
    ]:
        mf.score(sa, bad)  # must not raise

    # Honest inputs still score correctly (the guards didn't break the happy path).
    assert tr.score(ta, {"choice": 0, "elapsed_ms": 0}).correct is True
    assert tr.score(ta, {"choice": 0, "elapsed_ms": 0}).time_frac == 1.0
    good = mf.score(
        sa, {"taps": [0, 1, 2, 3], "tap_times": [200, 600, 1000, 1500], "elapsed_ms": 1500}
    )
    assert good.correct is True and good.valid is True
