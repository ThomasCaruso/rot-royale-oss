"""Bank ingestion (categories milestone): load a reviewed JSON question bank into the questions DB.

Input is a JSON array of rows in exactly this shape:
    {"category": str, "question": str, "options": [4 strings], "correct_index": 0..3,
     "difficulty": "easy"|"medium"|"hard", "explanation": str, "confidence": str}

Files are human-reviewed BEFORE ingestion, so valid rows land as status='approved'. The `confidence`
field is a review aid only — it is read by reviewers, never stored. Ingestion is:
  - validating  — malformed rows are REJECTED with a reason (reported, never silently dropped),
  - upserting   — dedupe on (question, category); a NEW question is inserted, an EXISTING one whose
                  content changed (options / correct index / explanation / difficulty / icon) is
                  REFRESHED in place (files are the source of truth), and an unchanged one is a
                  no-op. So the deploy's re-ingest keeps the DB in sync with edited banks. A stem
                  edit changes the key, so it inserts a new row — that case still needs a category
                  re-seed (delete + ingest), not a plain re-ingest.
  - idempotent  — re-running with no file changes writes nothing (all rows unchanged),
  - reported    — returns counts of added / updated / skipped (unchanged or in-file dup) / rejected.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from content.categories import CANONICAL_CATEGORIES
from content.difficulties import QUESTION_DIFFICULTIES

# Per-category display icon (the ingest format carries no icon). Keyed by the canonical set (lower).
_ICON_BY_CATEGORY = {
    "science & nature": "🔬",
    "history": "🏛️",
    "geography": "🌍",
    "arts & literature": "🎨",
    "sports": "⚽",
    "pop culture & entertainment": "🎬",
    "money & business": "💰",
    "street smarts": "🧠",
}
_DEFAULT_ICON = "❓"


@dataclass
class IngestReport:
    added: int = 0
    updated: int = 0  # existing question refreshed in place because its content changed
    skipped: int = 0  # no-op: already present + unchanged, or repeated within this run
    rejected: list[tuple[int, str]] = field(default_factory=list)  # (row index, reason)


def _icon_for(category: str) -> str:
    return _ICON_BY_CATEGORY.get(category.strip().lower(), _DEFAULT_ICON)


def read_bank_rows(path: str | Path) -> list[Any]:
    """Load rows from a bank file, OR from every *.json in a directory (sorted, concatenated).

    The directory form lets a deploy ingest a whole `content/bank/` folder in ONE ingest_bank call,
    so cross-file dedup still applies. Each JSON file must contain an array of question objects.
    """
    p = Path(path)
    files = sorted(p.glob("*.json")) if p.is_dir() else [p]
    rows: list[Any] = []
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            raise ValueError(f"{f} must contain a JSON array of question objects")
        rows.extend(data)
    return rows


def validate_row(row: Any) -> str | None:
    """Return a human-readable reason the row is malformed, or None if it is valid."""
    if not isinstance(row, dict):
        return "row is not an object"
    question = row.get("question")
    if not isinstance(question, str) or not question.strip():
        return "question must be a non-empty string"
    category = row.get("category")
    if not isinstance(category, str) or not category.strip():
        return "category must be a non-empty string"
    if category not in CANONICAL_CATEGORIES:
        return f"category {category!r} is not one of the canonical {CANONICAL_CATEGORIES}"
    options = row.get("options")
    if not isinstance(options, list) or len(options) != 4:
        return "options must be a list of exactly 4 entries"
    if not all(isinstance(o, str) and o.strip() for o in options):
        return "every option must be a non-empty string"
    correct_index = row.get("correct_index")
    if (
        not isinstance(correct_index, int)
        or isinstance(correct_index, bool)
        or not 0 <= correct_index <= 3
    ):
        return "correct_index must be an integer 0..3"
    if row.get("difficulty") not in QUESTION_DIFFICULTIES:
        return f"difficulty must be one of {QUESTION_DIFFICULTIES}"
    explanation = row.get("explanation")
    if not isinstance(explanation, str) or not explanation.strip():
        return "explanation must be a non-empty string"
    return None


async def ingest_bank(session: AsyncSession, rows: list[Any]) -> IngestReport:
    """Validate + dedupe + upsert a reviewed trivia bank. Does not commit — the caller does.

    A NEW (question, category) is inserted; an EXISTING one is refreshed in place when its content
    differs (files are the source of truth) and left untouched when identical. A row already seen
    earlier in this same run is a no-op (in-file / cross-file duplicate)."""
    # Imported HERE, not at module scope: importing app.models pulls in app.core.config,
    # which CONSTRUCTS Settings — and in production Settings refuses to exist until
    # ROT_CONTENT_DIR does. The content fetcher's job is to create that directory, so a
    # module-level import deadlocked the build. Validation must not require a booted app.
    from app.models import Question

    report = IngestReport()

    # Existing trivia questions keyed by (question text, category) so we can refresh in place.
    # `seen` grows with each row so a repeat within this run is caught without flushing per row.
    existing_by_key: dict[tuple[str, str], Question] = {
        (q.payload.get("prompt"), q.category): q
        for q in (await session.execute(select(Question).where(Question.module_type == "trivia")))
        .scalars()
        .all()
    }
    seen: set[tuple[str, str]] = set()

    for i, row in enumerate(rows):
        reason = validate_row(row)
        if reason is not None:
            report.rejected.append((i, reason))
            continue
        key = (row["question"], row["category"])
        if key in seen:
            report.skipped += 1  # duplicate within this run
            continue
        seen.add(key)

        payload = {
            "prompt": row["question"],
            "options": row["options"],
            "correctIndex": row["correct_index"],
        }
        icon = _icon_for(row["category"])
        existing = existing_by_key.get(key)
        if existing is not None:
            # Refresh mutable content if it changed. `status` is deliberately preserved so a row
            # promoted to 'live' is never demoted back to 'approved' by a re-ingest.
            if (
                existing.payload == payload
                and existing.explanation == row["explanation"]
                and existing.difficulty == row["difficulty"]
                and existing.icon == icon
            ):
                report.skipped += 1
            else:
                existing.payload = payload
                existing.explanation = row["explanation"]
                existing.difficulty = row["difficulty"]
                existing.icon = icon
                report.updated += 1
            continue

        session.add(
            Question(
                module_type="trivia",
                category=row["category"],
                icon=icon,
                difficulty=row["difficulty"],
                status="approved",  # files are pre-reviewed before ingestion
                explanation=row["explanation"],
                active=True,
                payload=payload,
            )
        )
        report.added += 1

    await session.flush()
    return report
