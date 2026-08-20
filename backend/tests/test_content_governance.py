"""Tests for content/governance.py — fingerprint stability, drift detection, and repo coverage.

After ``python -m app.jobs.run recover-content`` has been executed the recovered bank files live in
``content/bank/recovered_*.json``.  These tests verify:

  1. Every tracked bank file (including recovered ones) is valid ingest format with unique keys.
  2. The fingerprint function is stable and option-order-independent.
  3. After loading all tracked content into the test DB, drift_report reports no missing_from_repo
     (proving the tracked files fully cover the DB and the fingerprinting is self-consistent).
"""

from __future__ import annotations

import pytest
from conftest import requires_production_content
from content.governance import drift_report, fingerprint
from content.ingest import ingest_bank, read_bank_rows, validate_row
from content.loader import load_trivia
from sqlalchemy.ext.asyncio import AsyncSession

# Whole module depends on the PRODUCTION content corpus — see conftest for why.
pytestmark = requires_production_content


# Mirrors the path logic in app/jobs/run.py and content/governance.py.
def _content_root():
    """The active content package — never the repo tree, which carries only the sample corpus."""
    from app.core.config import settings

    return settings.content_root


CONTENT_DIR = _content_root()


# ---------------------------------------------------------------------------
# 1. Bank-file validity + uniqueness
# ---------------------------------------------------------------------------


def test_bank_files_ingest_valid_and_unique() -> None:
    """Every row in every content/bank/*.json passes validate_row and has a unique
    (question, category) key across all bank files."""
    bank_dir = CONTENT_DIR / "bank"
    if not bank_dir.exists():
        pytest.skip("content/bank/ does not exist yet")

    all_rows = read_bank_rows(bank_dir)
    if not all_rows:
        pytest.skip("content/bank/ is empty")

    seen: set[tuple[str, str]] = set()
    for i, row in enumerate(all_rows):
        reason = validate_row(row)
        assert reason is None, f"Row {i} is invalid: {reason}\n  row={row!r}"
        key = (row["question"], row["category"])
        assert key not in seen, f"Duplicate (question, category) at row {i}: {key!r}"
        seen.add(key)


# ---------------------------------------------------------------------------
# 2. Fingerprint correctness
# ---------------------------------------------------------------------------


def test_fingerprint_stable_and_order_independent() -> None:
    """Fingerprint is identical regardless of options list order, but changes when the
    correct answer text differs."""
    fp_asc = fingerprint("Sports", "Q?", ["a", "b", "c", "d"], "a")
    fp_desc = fingerprint("Sports", "Q?", ["d", "c", "b", "a"], "a")
    assert fp_asc == fp_desc, "fingerprint must be option-order-independent"

    fp_other = fingerprint("Sports", "Q?", ["a", "b", "c", "d"], "b")
    assert fp_asc != fp_other, "fingerprint must change when the correct answer differs"

    # Case-insensitive + whitespace collapse
    fp_lower = fingerprint("sports", "q?", [" A ", "B", "C", "D"], "a")
    assert fp_asc == fp_lower, "fingerprint must be case+whitespace-normalised"


# ---------------------------------------------------------------------------
# 3. Repo is the source of truth
# ---------------------------------------------------------------------------


async def test_repo_is_source_of_truth(db_session: AsyncSession) -> None:
    """After loading all tracked content into the test DB, no DB question is missing from the repo.

    This is the CI drift guard: if governance.py fingerprinting is self-consistent and every DB
    question is covered by a tracked bank file, missing_from_repo must be empty.

    NOTE: run ``python -m app.jobs.run recover-content`` first so the recovered bank files exist;
    otherwise only the original 79 tracked questions (trivia.json + sample_bank.json +
    money_business.json) would be in the test DB and the test would be vacuously trivial.
    """
    # Populate the test DB with every question tracked in the repo.
    await load_trivia(db_session)  # trivia.json (loader format, 40 legacy questions)

    bank_dir = CONTENT_DIR / "bank"
    if bank_dir.exists():
        bank_rows = read_bank_rows(bank_dir)  # all bank/*.json (including recovered_*.json)
        if bank_rows:
            await ingest_bank(db_session, bank_rows)

    sample_path = CONTENT_DIR / "sample_bank.json"
    if sample_path.exists():
        sample_rows = read_bank_rows(sample_path)
        if sample_rows:
            await ingest_bank(db_session, sample_rows)

    report = await drift_report(db_session, CONTENT_DIR)

    assert report["missing_from_repo"] == [], (
        f"{len(report['missing_from_repo'])} DB question(s) not covered by any tracked bank file.\n"
        "Run: python -m app.jobs.run recover-content\n"
        + "\n".join(
            f"  {q['id']} [{q['category']}] {q['prompt'][:80]!r}"
            for q in report["missing_from_repo"][:5]
        )
    )
