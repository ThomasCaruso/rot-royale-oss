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

from content.campaign.keys import question_key
from content.categories import CANONICAL_CATEGORIES
from content.difficulties import QUESTION_DIFFICULTIES

# Retire-pass safety valve — see the note at the call site.
MAX_RETIRE_FRACTION = 0.20
# Small banks: always allow at least this many, or the fraction alone blocks ordinary edits.
MIN_RETIRE_ALLOWANCE = 25

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
    # Only ever non-zero under retire_missing=True.
    retired: int = 0
    restored: int = 0
    # Set when the retire pass was ABANDONED for taking out too much of the bank at once.
    retire_aborted: str | None = None
    # Questions the files dropped that could NOT be retired because a campaign level still serves
    # them. Reported so the removal is a decision, never a silent half-removal.
    retire_blocked: list[str] = field(default_factory=list)


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


async def ingest_bank(
    session: AsyncSession, rows: list[Any], *, retire_missing: bool = False
) -> IngestReport:
    """Validate + dedupe + upsert a reviewed trivia bank. Does not commit — the caller does.

    A NEW (question, category) is inserted; an EXISTING one is refreshed in place when its content
    differs (files are the source of truth) and left untouched when identical. A row already seen
    earlier in this same run is a no-op (in-file / cross-file duplicate).

    `retire_missing` makes the files the ACTIVE SET, so a question deleted from a bank actually
    leaves the game. Until this existed, removing a question from a file did nothing — the row
    stayed servable forever and the only way out was a hand-run script against production.

    RETIRING SETS status='draft'. It does NOT touch the vestigial `active` column, and deliberately:
    `status in (approved, live)` is the ONE serving gate (§5a), and a second gate is how a question
    ends up invisible for a reason nobody can find later. 'draft' already means exactly "written but
    not servable", which is what a retired question is.

    THREE THINGS MAKE THIS SAFE, and all three are load-bearing:
      1. It is refused unless the caller ingested the WHOLE bank (see `_ingest` in jobs/run.py). The
         path may be a single file, and retiring against one file would deactivate every other
         category — roughly 800 questions, i.e. the entire Daily Royale.
      2. It is refused if ANY row was rejected. A row that failed validation is indistinguishable
         from one that was deleted, and guessing wrong pulls good content out of the game.
      3. A question still referenced by a CAMPAIGN level is never retired. Campaign levels resolve
         their questions against the servable bank by key, and a missing one raises
         CategoryUnavailableError — the level stops being playable at all. Those are reported in
         `retire_blocked` instead, so the removal is a decision rather than a broken world.

    A restored question comes back as 'approved'. One that had been hand-promoted to 'live' and was
    then removed and re-added therefore needs re-promoting; that is recorded rather than guessed at.
    """
    # Imported HERE, not at module scope: importing app.models pulls in app.core.config,
    # which CONSTRUCTS Settings — and in production Settings refuses to exist until
    # ROT_CONTENT_DIR does. The content fetcher's job is to create that directory, so a
    # module-level import deadlocked the build. Validation must not require a booted app.
    from app.models import Question

    report = IngestReport()
    # Keys the FILES carry this run — the active set when retiring.
    present_keys: set[tuple[str, str]] = set()

    # Existing trivia questions keyed by (question text, category) so we can refresh in place.
    # `seen` grows with each row so a repeat within this run is caught without flushing per row.
    #
    # A row with no prompt is skipped rather than keyed by None: the key type says (str, str), and
    # `payload.get("prompt")` can return None. Such a row is unreachable by this upsert either way —
    # skipping means a re-ingest INSERTS a fresh row instead of matching the broken one, which is
    # the recoverable direction.
    existing_rows = (
        (await session.execute(select(Question).where(Question.module_type == "trivia")))
        .scalars()
        .all()
    )
    existing_by_key: dict[tuple[str, str], Question] = {
        (str(q.payload["prompt"]), q.category): q
        for q in existing_rows
        if q.payload.get("prompt") is not None
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
            # A question the files carry again is servable again. Restored as 'approved' — see the
            # docstring on why a previously-'live' row cannot be put back to 'live' here.
            if retire_missing and existing.status == "draft":
                existing.status = "approved"
                report.restored += 1
            present_keys.add(key)
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
        present_keys.add(key)

    if retire_missing and not report.rejected:
        # A PROPORTION CAP, because the failure this guards against is not a typo — it is the whole
        # bank arriving incomplete. The files come from a separate content repo fetched at build
        # time; if one fails to land, every question in it looks deleted and would be retired in
        # silence. Deleting questions is a normal edit and happens a few at a time; deactivating a
        # fifth of the corpus in one run is a symptom, not an intention, so it stops and says so.
        servable = [q for q in existing_by_key.values() if q.status != "draft"]
        doomed = [
            k for k, q in existing_by_key.items() if k not in present_keys and q.status != "draft"
        ]
        if servable and len(doomed) > max(
            MIN_RETIRE_ALLOWANCE, len(servable) * MAX_RETIRE_FRACTION
        ):
            report.retire_aborted = (
                f"would retire {len(doomed)} of {len(servable)} servable questions "
                f"(over {MAX_RETIRE_FRACTION:.0%}) — refusing, in case the bank arrived incomplete"
            )
            retire_missing = False

    if retire_missing and not report.rejected:
        # Campaign levels resolve their questions out of the SERVABLE bank by key. Retiring one they
        # reference does not degrade a level, it breaks it outright (CategoryUnavailableError), so
        # those are refused and reported rather than applied.
        campaign_keys = _campaign_question_keys()
        for key, q in existing_by_key.items():
            if key in present_keys or q.status == "draft":
                continue
            prompt, category = key
            if question_key(category, prompt) in campaign_keys:
                report.retire_blocked.append(f"{category}: {prompt[:60]}")
                continue
            q.status = "draft"
            report.retired += 1

    await session.flush()
    return report


def _campaign_question_keys() -> set[str]:
    """Every question_key any campaign level serves. Empty if the manifest is absent — a build
    without one simply has no campaign to protect."""
    try:
        from content.campaign.manifest import worlds
    except Exception:  # pragma: no cover - campaign manifest is optional at ingest time
        return set()
    try:
        return {k for w in worlds() for lvl in w.levels for k in lvl.question_keys}
    except Exception:  # pragma: no cover - a missing/unbuilt manifest must not block an ingest
        return set()
