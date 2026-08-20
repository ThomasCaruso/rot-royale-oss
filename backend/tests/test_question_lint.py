"""Question-content linter tests (content-standard gate).

The linter is a PURE module (no DB), so these are plain synchronous tests that build
`LintQuestion` objects and assert on findings. Two integration-flavored tests read the real
committed banks in report mode (must never fail the process) and assert the serve-time shuffle in
`app/modules/trivia.py` is untouched.
"""

from __future__ import annotations

from typing import Any

from conftest import requires_production_content
from content.question_lint import (
    MODE_REPORT,
    MODE_STRICT,
    LintConfig,
    from_bank_row,
    lint_questions,
)

# Whole module depends on the PRODUCTION content corpus — see conftest for why.
pytestmark = requires_production_content


def _content_root():
    """The active content package — never the repo tree, which carries only the sample corpus."""
    from app.core.config import settings

    return settings.content_root


_CONTENT_BANK = _content_root() / "bank"


def _q(**over: Any) -> dict[str, Any]:
    """An excellent, standard-compliant bank row; override fields to make it fail a rule."""
    base = {
        "category": "Science & Nature",
        "question": "You seal baking soda and vinegar in a bottle. What is the biggest risk?",
        "options": [
            "The bottle can burst from gas pressure",
            "It quietly turns into table salt",
            "It slowly freezes into a solid",
            "Absolutely nothing happens",
        ],
        "correct_index": 0,
        "difficulty": "easy",
        "explanation": (
            "The reaction releases carbon dioxide gas; in a sealed bottle the pressure builds fast "
            "and can burst it, so never cap a gas-producing mix."
        ),
    }
    base.update(over)
    return base


def _lint_one(row: dict[str, Any], *, mode: str = MODE_STRICT, is_new_import: bool = True):
    return lint_questions(
        [from_bank_row(row, "t#0")],
        config=LintConfig(),
        mode=mode,
        is_new_import=is_new_import,
    )


def _rule_ids(result) -> set[str]:
    return {f.rule_id for f in result.findings}


# ── Structural rules ──────────────────────────────────────────────────────────────────────────
def test_missing_explanation_fails_strict():
    result = _lint_one(_q(explanation=""))
    assert "Q008" in _rule_ids(result)
    assert result.failed()


def test_explanation_under_40_chars_fails_strict():
    result = _lint_one(_q(explanation="Because gas."))  # < 40 chars
    assert "Q009" in _rule_ids(result)
    assert result.failed()


def test_exactly_four_options_required():
    result = _lint_one(_q(options=["a", "b", "c"]))
    assert "Q004" in _rule_ids(result)
    assert result.failed()


def test_duplicate_options_detected():
    result = _lint_one(_q(options=["Water", "Water", "Gold", "Air"]))
    assert "Q006" in _rule_ids(result)
    assert result.failed()


def test_invalid_correct_index_detected():
    result = _lint_one(_q(correct_index=9))
    assert "Q007" in _rule_ids(result)
    assert result.failed()


def test_noncanonical_category_and_bad_difficulty():
    result = _lint_one(_q(category="Trivia", difficulty="impossible"))
    ids = _rule_ids(result)
    assert "Q002" in ids and "Q003" in ids
    assert result.failed()


def test_all_of_the_above_option_flagged():
    result = _lint_one(_q(options=["Water", "Salt", "Gold", "All of the above"]))
    assert "Q025" in _rule_ids(result)


# ── Quality rules ─────────────────────────────────────────────────────────────────────────────
def test_restated_explanation_detected():
    # Explanation just echoes the correct option.
    row = _q(
        question="What gas do plants take in for photosynthesis?",
        options=["Carbon dioxide", "Oxygen", "Helium", "Nitrogen"],
        correct_index=0,
        explanation="Plants take in carbon dioxide.",
    )
    result = _lint_one(row)
    assert "Q020" in _rule_ids(result)


def test_correct_answer_length_tell_detected():
    row = _q(
        options=[
            "The bottle can violently burst from rapidly building internal gas pressure",
            "Salt",
            "Ice",
            "Nothing",
        ],
        correct_index=0,
    )
    result = _lint_one(row)
    assert "Q024" in _rule_ids(result)


def test_placeholder_content_detected():
    result = _lint_one(_q(question="test question placeholder", options=["a", "b", "c", "d"]))
    assert "Q026" in _rule_ids(result)


def test_stem_too_short_detected():
    result = _lint_one(_q(question="Why sky?"))
    assert "Q022" in _rule_ids(result)


# ── Duplicate rules (batch) ───────────────────────────────────────────────────────────────────
def test_exact_duplicate_stems_detected():
    rows = [from_bank_row(_q(question="Who painted the Mona Lisa?"), f"d#{i}") for i in range(2)]
    result = lint_questions(rows, mode=MODE_STRICT, is_new_import=True)
    assert "Q027" in _rule_ids(result)
    assert result.error_count >= 2  # both copies flagged


def test_near_duplicate_stems_detected():
    rows = [
        from_bank_row(_q(question="What is the capital of Australia?"), "n#0"),
        from_bank_row(_q(question="What is the capital of Austria?"), "n#1"),
    ]
    result = lint_questions(rows, mode=MODE_REPORT, is_new_import=False)
    assert "Q028" in _rule_ids(result)


def test_source_position_imbalance_flagged_in_batch():
    # 20 rows all correct at index 0 → 100% position A, far over the 40% threshold.
    rows = [
        from_bank_row(_q(question=f"Unique science question number {i}?"), f"p#{i}")
        for i in range(20)
    ]
    result = lint_questions(rows, mode=MODE_REPORT, is_new_import=False)
    assert "Q029" in _rule_ids(result)


# ── Flagship (practical) rules ────────────────────────────────────────────────────────────────
def _mb_row(**over: Any) -> dict[str, Any]:
    base = _q(
        category="Money & Business",
        question="You owe $1,000 at 24% APR and pay only the minimum. What quietly happens?",
        options=[
            "Interest compounds and the balance barely shrinks",
            "Your credit score instantly hits zero",
            "The bank forgives the balance",
            "You stop owing income tax",
        ],
        correct_index=0,
        difficulty="medium",
        explanation=(
            "Minimum payments mostly cover interest, so the balance stays high while new interest "
            "stacks on old. Rule: always pay more than the minimum."
        ),
    )
    base.update(over)
    return base


def test_money_business_strict_requires_practical_metadata():
    # No subtopic / cognitive_type / practical_value → three flagship errors.
    result = _lint_one(_mb_row(), is_new_import=True)
    ids = _rule_ids(result)
    assert {"Q040", "Q041", "Q042"} <= ids
    assert result.failed()


def test_money_business_with_full_metadata_passes_strict():
    row = _mb_row(subtopic="consumer_finance", cognitive_type="scenario", practical_value="high")
    result = _lint_one(row, is_new_import=True)
    assert not result.failed()


def test_street_smarts_strict_rejects_low_practical_value():
    row = _mb_row(
        category="Street Smarts",
        question="A caller claims to be your bank's fraud team and asks for your code. Best move?",
        options=[
            "Hang up and call the number on your card",
            "Give the code since they know your name",
            "Read them the code slowly to be safe",
            "Ask them to call back tomorrow",
        ],
        correct_index=0,
        subtopic="scams",
        cognitive_type="judgment",
        practical_value="low",  # must be rejected
    )
    result = _lint_one(row, is_new_import=True)
    assert "Q043" in _rule_ids(result)
    assert result.failed()


def test_flagship_rules_do_not_apply_to_existing_bank_report_mode():
    # Same metadata-less flagship row, but linted as the EXISTING bank (not a new import) in report
    # mode → no flagship errors and the process never fails.
    result = _lint_one(_mb_row(), mode=MODE_REPORT, is_new_import=False)
    ids = _rule_ids(result)
    assert not ({"Q040", "Q041", "Q042", "Q043"} & ids)
    assert not result.failed()


# ── Mode behavior ─────────────────────────────────────────────────────────────────────────────
def test_report_mode_never_fails_even_with_errors():
    result = _lint_one(_q(explanation=""), mode=MODE_REPORT, is_new_import=False)
    assert result.error_count > 0
    assert not result.failed()  # report mode collects but never fails


def test_strict_mode_fails_on_errors():
    result = _lint_one(_q(explanation=""), mode=MODE_STRICT, is_new_import=True)
    assert result.error_count > 0
    assert result.failed()


def test_excellent_question_passes_clean():
    row = _q(subtopic="chemistry", cognitive_type="scenario", practical_value="medium")
    result = _lint_one(row, is_new_import=True)
    assert not result.failed(), [f.rule_id for f in result.findings if f.severity == "error"]


# ── Q012: ingest-format key (correct_index vs correctIndex) ───────────────────────────────────
def _index_key_row(index_keys: dict[str, int]) -> dict[str, Any]:
    """A clean Science row, but with the caller's exact correct-index key(s) — no `correct_index`
    unless the caller asks for it. Lets a test set correctIndex-only / both / conflict precisely."""
    row = _q()
    row.pop("correct_index", None)
    row.update(index_keys)
    return row


def _q012(result) -> list:
    return [f for f in result.findings if f.rule_id == "Q012"]


def test_strict_import_with_correct_index_passes_q012():
    result = _lint_one(_index_key_row({"correct_index": 0}), is_new_import=True)
    assert _q012(result) == []
    assert not result.failed()


def test_strict_import_with_correct_index_camel_only_fails_q012():
    result = _lint_one(_index_key_row({"correctIndex": 0}), is_new_import=True)
    findings = _q012(result)
    assert len(findings) == 1 and findings[0].severity == "error"
    assert result.failed()  # this is the exact slip that ingest rejected 180/180


def test_strict_import_with_both_matching_does_not_error():
    result = _lint_one(_index_key_row({"correct_index": 0, "correctIndex": 0}), is_new_import=True)
    findings = _q012(result)
    assert len(findings) == 1 and findings[0].severity == "warning"  # redundant, not fatal
    assert not result.failed()


def test_strict_import_with_both_conflicting_errors():
    result = _lint_one(_index_key_row({"correct_index": 0, "correctIndex": 1}), is_new_import=True)
    findings = _q012(result)
    assert len(findings) == 1 and findings[0].severity == "error"
    assert result.failed()


def test_q012_does_not_affect_db_or_report_mode():
    # A DB payload carries the INTERNAL `correctIndex` key — it must NEVER trip Q012, since DB rows
    # have no raw-import-key info and report mode is non-blocking.
    from content.question_lint import from_db_payload

    db_q = from_db_payload(
        "db#0",
        "Science & Nature",
        "easy",
        "The reaction releases CO2 gas, so a sealed jar can burst. Never cap a gas-making mix.",
        {
            "prompt": "You seal a fizzing reaction in a jar. What is the real risk?",
            "options": ["The jar can burst", "It turns to salt", "It freezes", "Nothing at all"],
            "correctIndex": 0,
        },
    )
    # Even in strict + new-import (the harshest path), a DB-shaped row yields no Q012.
    strict = lint_questions([db_q], mode=MODE_STRICT, is_new_import=True)
    assert _q012(strict) == []
    # And a camelCase import row in REPORT mode surfaces nothing blocking.
    report = lint_questions(
        [from_bank_row(_index_key_row({"correctIndex": 0}), "r#0")],
        mode=MODE_REPORT,
        is_new_import=False,
    )
    assert _q012(report) == []  # report/existing-bank path is never checked for Q012
    assert not report.failed()


def test_flagship_batch_still_passes_strict_after_q012():
    """The already-fixed flagship batch (uses correct_index) must stay clean under strict lint."""
    import json

    batch = _CONTENT_BANK.parent / "generated" / "2026-07-rot-royale-flagship-batch-001.json"
    rows = [
        from_bank_row(row, f"batch#{i}")
        for i, row in enumerate(json.loads(batch.read_text(encoding="utf-8")))
    ]
    result = lint_questions(rows, mode=MODE_STRICT, is_new_import=True)
    assert _q012(result) == []
    assert not result.failed(), [f.rule_id for f in result.findings if f.severity == "error"]


# ── Existing bank + governance integration ────────────────────────────────────────────────────
def test_existing_source_banks_run_in_report_mode_without_blocking():
    """The committed banks predate the standard; report mode must surface issues but never fail."""
    rows: list = []
    for path in sorted(_CONTENT_BANK.glob("*.json")):
        import json

        for i, row in enumerate(json.loads(path.read_text(encoding="utf-8"))):
            rows.append(from_bank_row(row, f"{path.name}#{i}"))
    assert rows, "expected committed bank files to load"
    result = lint_questions(rows, mode=MODE_REPORT, is_new_import=False)
    # Report mode is non-blocking regardless of how many issues the legacy bank has.
    assert not result.failed()
    # TODO(content-pipeline): once a generated-question import pipeline exists, run STRICT lint on
    # the NEW import files in CI. Do NOT make the existing bank strict until it is cleaned up.


def test_trivia_shuffle_behavior_is_untouched():
    """Guard: the linter work must not change the serve-time option shuffle / anti-cheat split."""
    from app.modules.trivia import trivia_spec

    q = {
        "id": "abc-123",
        "category": "Science & Nature",
        "icon": "🔬",
        "payload": {
            "prompt": "What is H2O?",
            "options": ["Water", "Salt", "Gold", "Air"],
            "correctIndex": 0,
        },
    }
    spec_a, answer_a = trivia_spec(q, shuffle_seed=42)
    spec_b, answer_b = trivia_spec(q, shuffle_seed=42)
    # Deterministic per (seed, id).
    assert spec_a == spec_b and answer_a == answer_b
    # Anti-cheat: client_spec never carries the answer, and the remap is correct.
    assert "correctIndex" not in spec_a
    assert spec_a["options"][answer_a["correctIndex"]] == "Water"
