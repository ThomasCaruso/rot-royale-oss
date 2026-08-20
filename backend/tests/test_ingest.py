"""Bank ingestion (categories milestone): `ingest_bank` validates, dedupes, review-gates content.

Files are human-reviewed before ingestion, so valid rows land as status='approved'. Malformed rows
are REJECTED LOUDLY (reported with a reason), never silently dropped. Re-running is idempotent.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from content.ingest import ingest_bank, read_bank_rows
from content.loader import fetch_bank
from sqlalchemy.ext.asyncio import AsyncSession


def _row(**over: Any) -> dict[str, Any]:
    base = {
        "category": "Science & Nature",
        "question": "What is H2O?",
        "options": ["Water", "Salt", "Gold", "Air"],
        "correct_index": 0,
        "difficulty": "easy",
        "explanation": "H2O is the chemical formula for water.",
        "confidence": "high",
    }
    base.update(over)
    return base


async def test_ingest_adds_valid_rows_as_approved_and_servable(db_session: AsyncSession):
    rows = [_row(question="Q1"), _row(question="Q2", difficulty="hard")]
    report = await ingest_bank(db_session, rows)
    assert report.added == 2
    assert report.skipped == 0
    assert report.rejected == []
    # ingested as approved → immediately servable; confidence is NOT stored anywhere
    served = await fetch_bank(db_session, "trivia", category="Science & Nature")
    prompts = {r["payload"]["prompt"] for r in served}
    assert {"Q1", "Q2"} <= prompts
    assert all("confidence" not in r and "confidence" not in r["payload"] for r in served)


async def test_ingest_is_idempotent_on_rerun(db_session: AsyncSession):
    rows = [_row(question="Dup")]
    first = await ingest_bank(db_session, rows)
    second = await ingest_bank(db_session, rows)  # same file again
    assert first.added == 1
    assert second.added == 0 and second.skipped == 1  # dedupe on (question, category)


async def test_ingest_upserts_changed_content_and_noops_when_unchanged(db_session: AsyncSession):
    # A later re-ingest of the SAME (question, category) with edited options/explanation refreshes
    # the stored row in place — files are the source of truth, so the deploy stays in sync.
    await ingest_bank(db_session, [_row(question="Q", options=["Water", "Salt", "Gold", "Air"])])
    edited = _row(question="Q", options=["H2O", "NaCl", "Au", "O2"], explanation="Water is H2O.")
    first = await ingest_bank(db_session, [edited])
    assert first.added == 0 and first.updated == 1 and first.skipped == 0
    served = await fetch_bank(db_session, "trivia", category="Science & Nature")
    q = next(r for r in served if r["payload"]["prompt"] == "Q")
    assert q["payload"]["options"] == ["H2O", "NaCl", "Au", "O2"]
    # Re-ingesting the identical edited row again writes nothing.
    second = await ingest_bank(db_session, [edited])
    assert second.updated == 0 and second.skipped == 1


async def test_ingest_dedupes_within_the_same_file(db_session: AsyncSession):
    rows = [_row(question="Same"), _row(question="Same")]  # two identical rows in one file
    report = await ingest_bank(db_session, rows)
    assert report.added == 1
    assert report.skipped == 1  # the in-file duplicate is caught, not double-inserted


async def test_same_question_text_different_category_is_not_a_duplicate(db_session: AsyncSession):
    rows = [
        _row(question="Shared", category="Science & Nature"),
        _row(question="Shared", category="History"),
    ]
    report = await ingest_bank(db_session, rows)
    assert report.added == 2  # dedupe key is (question, category), not question alone


async def test_ingest_rejects_malformed_rows_loudly_with_reasons(db_session: AsyncSession):
    rows = [
        _row(question="ok"),  # 0: valid
        _row(question="three-opts", options=["a", "b", "c"]),  # 1: not 4 options
        _row(question="oob-index", correct_index=5),  # 2: correct_index out of range
        _row(question="bad-diff", difficulty="trivial"),  # 3: invalid difficulty
        _row(question="no-expl", explanation="  "),  # 4: empty explanation
        _row(question=""),  # 5: empty question
        _row(question="empty-opt", options=["a", "", "c", "d"]),  # 6: blank option
    ]
    report = await ingest_bank(db_session, rows)
    assert report.added == 1  # only the valid row landed
    rejected_idx = {i for i, _ in report.rejected}
    assert rejected_idx == {1, 2, 3, 4, 5, 6}  # every malformed row reported, none silently dropped
    reasons = dict(report.rejected)
    assert "option" in reasons[1].lower()
    assert "correct_index" in reasons[2].lower()
    assert "difficulty" in reasons[3].lower()
    assert "explanation" in reasons[4].lower()
    assert "question" in reasons[5].lower()
    # and nothing malformed slipped into the served bank
    served = await fetch_bank(db_session, "trivia", category="Science & Nature")
    assert {r["payload"]["prompt"] for r in served} == {"ok"}


def test_read_bank_rows_from_a_single_file(tmp_path: Path):
    f = tmp_path / "one.json"
    f.write_text(json.dumps([_row(question="A"), _row(question="B")]), encoding="utf-8")
    rows = read_bank_rows(f)
    assert [r["question"] for r in rows] == ["A", "B"]


def test_read_bank_rows_concatenates_all_json_files_in_a_directory(tmp_path: Path):
    # The deploy ingests a whole directory in one call so cross-file dedup still applies. Files are
    # read in sorted name order for determinism.
    (tmp_path / "b_second.json").write_text(json.dumps([_row(question="B")]), encoding="utf-8")
    (tmp_path / "a_first.json").write_text(json.dumps([_row(question="A")]), encoding="utf-8")
    (tmp_path / "notes.txt").write_text("ignored", encoding="utf-8")  # non-json ignored
    rows = read_bank_rows(tmp_path)
    assert [r["question"] for r in rows] == ["A", "B"]  # sorted file order


async def test_ingesting_a_directory_dedupes_across_files(db_session: AsyncSession, tmp_path: Path):
    (tmp_path / "f1.json").write_text(
        json.dumps([_row(question="Shared"), _row(question="Only1")]), encoding="utf-8"
    )
    (tmp_path / "f2.json").write_text(
        json.dumps([_row(question="Shared"), _row(question="Only2")]), encoding="utf-8"
    )
    report = await ingest_bank(db_session, read_bank_rows(tmp_path))
    assert report.added == 3  # Shared, Only1, Only2
    assert report.skipped == 1  # the cross-file duplicate of Shared


async def test_ingest_reports_all_three_counts_together(db_session: AsyncSession):
    await ingest_bank(db_session, [_row(question="Existing")])  # pre-seed a duplicate
    report = await ingest_bank(
        db_session,
        [
            _row(question="New"),  # added
            _row(question="Existing"),  # skipped (dup)
            _row(question="Bad", correct_index=9),  # rejected
        ],
    )
    assert report.added == 1
    assert report.skipped == 1
    assert len(report.rejected) == 1
