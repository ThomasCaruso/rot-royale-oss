"""Estimate content ingest + playtest-verdict capture + export.

The content file is a JSON array of Fermi-estimation items keyed by a stable string `id`
("fer_0001"). Ingest is:
  - validating   — the WHOLE file is rejected on any item failure (per-item reasons reported,
                   non-zero CLI exit); nothing is written on rejection. Stricter than the trivia
                   bank ingest (which is per-row) because this is a curated set delivered whole.
  - upserting    — by `source_id`: new inserts, changed content refreshes in place, unchanged is a
                   no-op. Admin playtest fields are NEVER touched by ingest, so a re-ingest keeps a
                   rated verdict (files are the source of truth for CONTENT, not for verdicts).
  - non-leaking  — `_flags` is stored in the diagnostic `flags` column; it (and every playtest
                   field) never enters a client_spec, the resolve reveal, scoring, or the draw.

`playtest_verdict` is set only through the admin path (set_estimate_verdict), never from the file.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:  # annotations only — see the runtime imports inside each DB function
    from app.models import CognitionEstimateItem

# The five playtest verdicts. `repetitive` (the reasoning PATH has recurred) is deliberately
# distinct from `boring` (the question is individually dull) — both must be recordable.
ESTIMATE_VERDICTS: frozenset[str] = frozenset({"good", "boring", "unfair", "repetitive", "broken"})
_DIFFICULTIES: frozenset[str] = frozenset({"direct", "two_step", "counterintuitive"})

# Content fields written by ingest. Playtest fields (verdict/note/rated_at) and `active`/source_url
# etc. are intentionally NOT here, so ingest never overwrites admin or operational state.
_CONTENT_FIELDS = (
    "prompt",
    "answer",
    "unit",
    "difficulty",
    "acceptable_pct",
    "close_pct",
    "components",
    "reveal_explanation",
    "intuition_note",
    "category",
    "flags",
)


@dataclass
class EstimateIngestReport:
    added: int = 0
    updated: int = 0
    skipped: int = 0
    # Only ever non-zero under retire_missing=True (the deploy sync): rows the file no longer
    # carries were deactivated; rows it carries again were switched back on.
    retired: int = 0
    reactivated: int = 0
    rejected: list[tuple[int, str]] = field(default_factory=list)  # (item index, reason)


def read_estimate_items(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _is_number(v: Any) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool)


def _positive_finite_value(v: Any) -> float | None:
    """The value as a float when it is a positive finite number, else None.

    Returning the VALUE rather than a bool is what lets a caller compare two of these directly.
    A bool tells the reader the value is usable but tells a type checker nothing, so comparing two
    of them meant re-converting an `Any` that was only known-good via a separate flag.
    """
    if not _is_number(v):
        return None
    f = float(v)
    return f if math.isfinite(f) and f > 0 else None


def _positive_finite(v: Any) -> bool:
    return _positive_finite_value(v) is not None


def _item_errors(item: Any) -> list[str]:
    if not isinstance(item, dict):
        return ["item must be an object"]
    errors: list[str] = []

    iid = item.get("id")
    if not isinstance(iid, str) or not iid or len(iid) > 64:
        errors.append("id must be a non-empty string of at most 64 chars")
    for f in ("prompt", "reveal_explanation"):
        v = item.get(f)
        if not isinstance(v, str) or not v.strip():
            errors.append(f"{f} must be a non-empty string")
    if not _positive_finite(item.get("answer")):
        errors.append("answer must be a positive finite number")
    if item.get("difficulty") not in _DIFFICULTIES:
        errors.append(f"difficulty must be one of {sorted(_DIFFICULTIES)}")

    ap = _positive_finite_value(item.get("acceptable_pct"))
    cp = _positive_finite_value(item.get("close_pct"))
    if ap is None:
        errors.append("acceptable_pct must be a positive number")
    if cp is None:
        errors.append("close_pct must be a positive number")
    if ap is not None and cp is not None and not cp > ap:
        errors.append("close_pct must be greater than acceptable_pct")

    if not isinstance(item.get("components"), list):
        errors.append("components must be an array")

    flags = item.get("_flags")
    if flags is not None and not isinstance(flags, dict):
        errors.append("_flags must be an object")
    return errors


def validate_estimate_items(items: Any) -> list[tuple[int, str]]:
    """All (item_index, reason) problems; empty list = the whole file is valid. Index -1 flags a
    file-level problem (not a JSON array)."""
    if not isinstance(items, list):
        return [(-1, "file must be a JSON array")]
    errors: list[tuple[int, str]] = []
    seen: set[str] = set()
    for i, item in enumerate(items):
        for reason in _item_errors(item):
            errors.append((i, reason))
        iid = item.get("id") if isinstance(item, dict) else None
        if isinstance(iid, str) and iid:
            if iid in seen:
                errors.append((i, f"duplicate id {iid!r}"))
            seen.add(iid)
    return errors


def _content_values(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "prompt": item["prompt"],
        "answer": Decimal(str(item["answer"])),
        "unit": item.get("unit"),
        "difficulty": item["difficulty"],
        "acceptable_pct": Decimal(str(item["acceptable_pct"])),
        "close_pct": Decimal(str(item["close_pct"])),
        "components": item["components"],
        "reveal_explanation": item["reveal_explanation"],
        "intuition_note": item.get("intuition_note"),
        "category": item.get("category"),
        "flags": item.get("_flags"),
    }


def _canonical(value: Any) -> Any:
    """Normalize a JSON value so a DB round-trip compares equal to the file it came from.

    Postgres stores JSON numbers as `numeric`, so a component written `1.41e+18` reads back as
    `1410000000000000000` — numerically identical, textually different. Comparing the raw
    `json.dumps` therefore marked those rows changed on EVERY ingest: with the deploy now running
    ingest on every start (render.yaml), they would be rewritten forever and never converge. Every
    number is reduced to a normalized Decimal so representation can't matter. `bool` is checked
    first because it is an int subclass and must stay a JSON boolean.
    """
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, int | float):
        d = Decimal(str(value))
        return f"n:{d.normalize():E}" if d.is_finite() else f"n:{d}"
    if isinstance(value, dict):
        return {k: _canonical(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_canonical(v) for v in value]
    return str(value)


def _json_signature(value: Any) -> str:
    return json.dumps(_canonical(value), sort_keys=True, default=str)


def _differs(row: CognitionEstimateItem, values: dict[str, Any]) -> bool:
    for k in _CONTENT_FIELDS:
        cur = getattr(row, k)
        new = values[k]
        if k in ("components", "flags"):
            # JSONB round-trips change number representation and key order; compare by a canonical
            # signature so an unchanged re-ingest is a no-op.
            if _json_signature(cur) != _json_signature(new):
                return True
        elif k in ("answer", "acceptable_pct", "close_pct"):
            if (cur is None) != (new is None) or (cur is not None and Decimal(cur) != Decimal(new)):
                return True
        elif cur != new:
            return True
    return False


async def ingest_estimate_items(
    session: AsyncSession, items: Any, *, retire_missing: bool = False
) -> EstimateIngestReport:
    """All-or-nothing upsert by source_id. Any validation failure rejects the whole file and writes
    nothing. Playtest verdict/note/rated_at are never touched.

    `retire_missing` makes the file the **active set** (the deploy sync — see render.yaml): any
    ingest-tracked row the file no longer carries is DEACTIVATED, and a row the file carries again
    is REACTIVATED. Off by default, because `active` is otherwise operational state that ingest
    must not touch. Two properties make it safe to run on every deploy:
      - it is inside the all-or-nothing gate, so a malformed file retires NOTHING;
      - it is symmetric, so reverting the content file restores the previous active set rather
        than leaving prod permanently missing whatever a bad edit dropped.
    Rows with no `source_id` (created outside this pipeline) are never touched — the file makes no
    claim about them. Retiring keeps the row (never deletes), so an already-pinned window plan
    still resolves it.
    """
    # Imported HERE, not at module scope: importing app.models pulls in app.core.config,
    # which CONSTRUCTS Settings — and in production Settings refuses to exist until
    # ROT_CONTENT_DIR does. The content fetcher's job is to create that directory, so a
    # module-level import deadlocked the build. Validation must not require a booted app.
    from app.models import CognitionEstimateItem

    report = EstimateIngestReport()
    errors = validate_estimate_items(items)
    if errors:
        report.rejected = errors
        return report

    existing = {
        row.source_id: row
        for row in (
            await session.execute(
                select(CognitionEstimateItem).where(CognitionEstimateItem.source_id.is_not(None))
            )
        )
        .scalars()
        .all()
    }
    for item in items:
        values = _content_values(item)
        row = existing.get(item["id"])
        if row is None:
            session.add(CognitionEstimateItem(source_id=item["id"], active=True, **values))
            report.added += 1
            continue
        if _differs(row, values):
            for k, v in values.items():
                setattr(row, k, v)
            report.updated += 1
        else:
            report.skipped += 1
        if retire_missing and not row.active:
            row.active = True
            report.reactivated += 1

    if retire_missing:
        present = {item["id"] for item in items}
        for source_id, row in existing.items():
            if source_id not in present and row.active:
                row.active = False
                report.retired += 1

    await session.flush()
    return report


# ---------------------------------------------------------------- admin verdict capture


async def set_estimate_verdict(
    session: AsyncSession,
    source_id: str,
    verdict: str,
    note: str | None,
    *,
    now: datetime | None = None,
) -> CognitionEstimateItem | None:
    """Set (overwrite) an item's playtest verdict. Returns None if no item has that source_id."""
    # Imported HERE, not at module scope: importing app.models pulls in app.core.config,
    # which CONSTRUCTS Settings — and in production Settings refuses to exist until
    # ROT_CONTENT_DIR does. The fetcher's job is to create that directory, so a
    # module-level import deadlocked the build. Validation must not require a booted app.
    from app.models import CognitionEstimateItem

    row = (
        await session.execute(
            select(CognitionEstimateItem).where(CognitionEstimateItem.source_id == source_id)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.playtest_verdict = verdict
    row.playtest_note = note
    row.playtest_rated_at = now or datetime.now(UTC)
    await session.flush()
    return row


async def list_unrated_estimate_items(
    session: AsyncSession, limit: int
) -> list[CognitionEstimateItem]:
    """Ingested items still awaiting a verdict, oldest source_id first — the rating worklist."""
    # Imported HERE, not at module scope: importing app.models pulls in app.core.config,
    # which CONSTRUCTS Settings — and in production Settings refuses to exist until
    # ROT_CONTENT_DIR does. The fetcher's job is to create that directory, so a
    # module-level import deadlocked the build. Validation must not require a booted app.
    from app.models import CognitionEstimateItem

    return list(
        (
            await session.execute(
                select(CognitionEstimateItem)
                .where(
                    CognitionEstimateItem.source_id.is_not(None),
                    CognitionEstimateItem.playtest_verdict.is_(None),
                )
                .order_by(CognitionEstimateItem.source_id)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )


async def export_estimate_verdicts(session: AsyncSession) -> list[dict[str, Any]]:
    """Correlation input: every ingested item's id, prompt, answer, difficulty, flags, verdict and
    note — flags and verdict together, so the offline pass can correlate reasoning-path repeats
    with `repetitive`/`boring` calls."""
    # Imported HERE, not at module scope: importing app.models pulls in app.core.config, which
    # CONSTRUCTS Settings — and in production Settings refuses to exist until ROT_CONTENT_DIR does.
    # The fetcher's job is to create that directory, so a module-level import deadlocked the build.
    from app.models import CognitionEstimateItem

    rows = (
        (
            await session.execute(
                select(CognitionEstimateItem)
                .where(CognitionEstimateItem.source_id.is_not(None))
                .order_by(CognitionEstimateItem.source_id)
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": r.source_id,
            "prompt": r.prompt,
            "answer": float(r.answer),
            "difficulty": r.difficulty,
            "flags": r.flags,
            "playtest_verdict": r.playtest_verdict,
            "playtest_note": r.playtest_note,
        }
        for r in rows
    ]
