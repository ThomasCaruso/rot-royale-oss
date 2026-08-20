"""Content governance: fingerprint questions so the repo bank files can be checked against (and
recovered from) the DB. The repo is the source of truth; silent DB-only drift must be detectable.

Fingerprinting is option-order-independent (options are sorted before hashing) so questions remain
stable across the serve-time shuffle (PR #6) that remaps correctIndex in server_answer but leaves
payload["correctIndex"] untouched.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from app.models.question import Question
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# The content/ directory — same directory this module lives in.
CONTENT_DIR = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# Normalisation + fingerprint
# ---------------------------------------------------------------------------


def _norm(s: str) -> str:
    """Lowercase, strip, collapse internal whitespace to single spaces."""
    return re.sub(r"\s+", " ", s.strip().lower())


def fingerprint(
    category: str,
    prompt: str,
    options: list[str],
    correct_text: str,
) -> str:
    """Return a SHA-1 hex fingerprint for a trivia question.

    Options are sorted before hashing so the fingerprint is order-independent —
    robust to serve-time shuffling of the options array.
    """
    payload = (
        _norm(category)
        + "|"
        + _norm(prompt)
        + "|"
        + "|".join(sorted(_norm(o) for o in options))
        + "|"
        + _norm(correct_text)
    )
    return hashlib.sha1(payload.encode()).hexdigest()


def _fp_from_ingest_row(row: dict) -> str:
    """Fingerprint from an ingest-format row (question / options / correct_index)."""
    options: list[str] = row["options"]
    correct_text = options[row["correct_index"]]
    return fingerprint(row["category"], row["question"], options, correct_text)


def _fp_from_loader_row(row: dict) -> str:
    """Fingerprint from a trivia.json loader-format row (prompt / options / correctIndex)."""
    options: list[str] = row["options"]
    correct_text = options[row["correctIndex"]]
    return fingerprint(row["category"], row["prompt"], options, correct_text)


# ---------------------------------------------------------------------------
# Tracked-fingerprint index (repo → DB direction)
# ---------------------------------------------------------------------------


def tracked_fingerprints(content_dir: Path) -> dict[str, str]:
    """Return {fingerprint: source_filename} for every question tracked in the repo bank files.

    Reads:
      - content_dir/trivia.json       (loader format)
      - content_dir/sample_bank.json  (ingest format)
      - content_dir/bank/*.json       (ingest format; includes recovered_*.json once generated)

    If a file does not exist it is silently skipped.  When a fingerprint appears in more than one
    file the last one wins (duplicates should not exist after recovery).
    """
    fps: dict[str, str] = {}

    # Legacy loader-format seed (no explanation; these ARE tracked via trivia.json).
    trivia_path = content_dir / "trivia.json"
    if trivia_path.exists():
        for row in json.loads(trivia_path.read_text(encoding="utf-8")):
            fps[_fp_from_loader_row(row)] = trivia_path.name

    # Development sample (ingest format).
    sample_path = content_dir / "sample_bank.json"
    if sample_path.exists():
        for row in json.loads(sample_path.read_text(encoding="utf-8")):
            fps[_fp_from_ingest_row(row)] = sample_path.name

    # All reviewed + recovered bank files (ingest format).
    bank_dir = content_dir / "bank"
    if bank_dir.exists():
        for bank_file in sorted(bank_dir.glob("*.json")):
            for row in json.loads(bank_file.read_text(encoding="utf-8")):
                fps[_fp_from_ingest_row(row)] = bank_file.name

    return fps


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


async def db_questions(session: AsyncSession) -> list[Question]:
    """Return all trivia questions ordered by id."""
    result = await session.execute(
        select(Question).where(Question.module_type == "trivia").order_by(Question.id)
    )
    return list(result.scalars().all())


def db_fingerprint(q: Question) -> str:
    """Fingerprint from a Question ORM row (uses payload.prompt/options/correctIndex)."""
    payload = q.payload
    options: list[str] = payload["options"]
    correct_text = options[payload["correctIndex"]]
    return fingerprint(q.category, payload["prompt"], options, correct_text)


# ---------------------------------------------------------------------------
# Drift report
# ---------------------------------------------------------------------------


async def drift_report(session: AsyncSession, content_dir: Path) -> dict:
    """Compare DB questions to tracked repo files.

    Returns::

        {
            "db_total": int,
            "tracked_total": int,
            "missing_from_repo": [{"id", "category", "prompt"}, ...],   # DB not in repo
            "missing_from_db":   [fingerprint_str, ...],                 # repo not in DB
        }

    ``missing_from_repo`` being non-empty means the DB has drifted ahead of the repo — run
    ``recover-content`` to generate the missing bank files.
    """
    tracked = tracked_fingerprints(content_dir)
    questions = await db_questions(session)

    db_fps: set[str] = set()
    missing_from_repo: list[dict] = []
    for q in questions:
        fp = db_fingerprint(q)
        db_fps.add(fp)
        if fp not in tracked:
            missing_from_repo.append(
                {
                    "id": str(q.id),
                    "category": q.category,
                    "prompt": q.payload.get("prompt", ""),
                }
            )

    missing_from_db = [fp for fp in tracked if fp not in db_fps]

    return {
        "db_total": len(questions),
        "tracked_total": len(tracked),
        "missing_from_repo": missing_from_repo,
        "missing_from_db": missing_from_db,
    }


# ---------------------------------------------------------------------------
# Recovery
# ---------------------------------------------------------------------------


def _category_slug(category: str) -> str:
    """Turn a canonical category name into a filename-safe slug.

    Example: "Science & Nature" → "science_nature"
             "Pop Culture & Entertainment" → "pop_culture_entertainment"
    """
    slug = re.sub(r"[^a-z0-9]+", "_", category.lower())
    slug = re.sub(r"_+", "_", slug)
    return slug.strip("_")


async def recover_db_only(session: AsyncSession, content_dir: Path) -> dict:
    """Write DB-only questions (that have explanations) into ``bank/recovered_<slug>.json``.

    Questions already covered by a tracked repo file are skipped.  Questions with a NULL/empty
    explanation are skipped too (these are the legacy loader-seed rows that predate the explanation
    requirement and are already tracked via trivia.json).

    Recovered rows are written in ingest format so ``python -m app.jobs.run ingest content/bank``
    dedupes them cleanly and adds 0 on re-run.

    Returns::

        {
            "recovered": int,               # rows written across all files
            "skipped_no_explanation": int,  # DB-only rows dropped for lack of explanation
            "files": [str, ...],            # absolute paths of files written
        }
    """
    tracked = tracked_fingerprints(content_dir)
    questions = await db_questions(session)

    by_category: dict[str, list[dict]] = {}
    skipped_no_explanation = 0

    for q in questions:
        fp = db_fingerprint(q)
        if fp in tracked:
            continue
        # Not tracked — check explanation before recovering.
        if not (q.explanation and q.explanation.strip()):
            skipped_no_explanation += 1
            continue
        payload = q.payload
        row = {
            "category": q.category,
            "question": payload["prompt"],
            "options": payload["options"],
            "correct_index": payload["correctIndex"],
            "difficulty": q.difficulty,
            "explanation": q.explanation,
            "confidence": "recovered",
            "source": "recovered_from_db",
        }
        by_category.setdefault(q.category, []).append(row)

    bank_dir = content_dir / "bank"
    bank_dir.mkdir(parents=True, exist_ok=True)

    files_written: list[str] = []
    recovered_total = 0

    for category in sorted(by_category):
        rows_sorted = sorted(by_category[category], key=lambda r: r["question"])
        slug = _category_slug(category)
        out_path = bank_dir / f"recovered_{slug}.json"
        out_path.write_text(
            json.dumps(rows_sorted, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        files_written.append(str(out_path))
        recovered_total += len(rows_sorted)

    return {
        "recovered": recovered_total,
        "skipped_no_explanation": skipped_no_explanation,
        "files": files_written,
    }
