"""Validation + ingest for the video round's content package.

The sibling of `change_manifest.py`, and deliberately the same shape: a manifest naming assets and
dimensions, plus a separate authored file holding the human copy. Change splits difficulty out for
that reason; video splits the QUESTIONS out for the same one — pixel dimensions come from probing
the files, the questions come from a person watching them, and merging the two sources at ingest
keeps one source of truth for each instead of two that can disagree.

    <content_root>/video/manifest.json    assets, dimensions, duration   (mechanical)
    <content_root>/video/questions.json   prompts, options, answers      (authored)

**The correct indexes never leave the server.** They are ingested into `cognition.video_item` and
resolved per answer; a client spec carries prompts and options only. The authored file puts every
correct answer at index 0 as a writing convenience, which is safe only because options are shuffled
from the instance seed before being served — see services/cognition.video_start.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from content import video_assets

MANIFEST_VERSION = 1

DIFFICULTIES: frozenset[str] = frozenset({"easy", "medium", "hard"})

# Every question is four options with exactly one right answer. Fixed rather than flexible: the
# answer UI is the trivia pill list, which is built for four.
OPTIONS_PER_QUESTION = 4
# Two questions about the first clip, then the change question about the second.
COMPREHENSION_QUESTIONS = 2

# Only ever .mp4. The same reason WebP is banned for the change images (change_assets.MEDIA_TYPES):
# ios/App pins IPHONEOS_DEPLOYMENT_TARGET 13.0, and a clip a device cannot decode is a blank frame
# — an unanswerable round with nothing in any log to notice.
VIDEO_SUFFIXES: frozenset[str] = frozenset({".mp4"})


@dataclass
class VideoIngestReport:
    added: int = 0
    updated: int = 0
    skipped: int = 0
    rejected: list[tuple[int, str]] = field(default_factory=list)
    # Only ever non-zero under retire_missing=True: clips the manifest no longer carries, and clips
    # it carries again after having been retired.
    retired: int = 0
    reactivated: int = 0


def read_manifest(path: str | Path) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
    return data


def read_questions(path: str | Path) -> dict[str, Any]:
    """The authored questions file, keyed by clip key. Underscore keys are notes, not content."""
    data: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
    items = data.get("items")
    return items if isinstance(items, dict) else {}


def _question_errors(q: Any, label: str) -> list[str]:
    errors: list[str] = []
    if not isinstance(q, dict):
        return [f"{label} must be an object"]
    prompt = q.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        errors.append(f"{label}.prompt must be a non-empty string")
    options = q.get("options")
    if not isinstance(options, list) or len(options) != OPTIONS_PER_QUESTION:
        errors.append(f"{label}.options must be exactly {OPTIONS_PER_QUESTION} entries")
    elif any(not isinstance(o, str) or not o.strip() for o in options):
        errors.append(f"{label}.options must all be non-empty strings")
    elif len(set(options)) != len(options):
        # Two identical options means two correct answers or a wasted slot; either way the
        # question is broken and no amount of shuffling fixes it.
        errors.append(f"{label}.options must be distinct")
    ci = q.get("correct_index")
    if not isinstance(ci, int) or isinstance(ci, bool) or not 0 <= ci < OPTIONS_PER_QUESTION:
        errors.append(f"{label}.correct_index must be an integer 0-{OPTIONS_PER_QUESTION - 1}")
    return errors


def _asset_errors(name: Any, label: str, content_root: Path | None) -> list[str]:
    if not isinstance(name, str) or not name:
        return [f"{label} must be a non-empty asset id"]
    if Path(name).suffix.lower() not in VIDEO_SUFFIXES:
        return [f"{label} must be .mp4 (a clip the device cannot decode is an unanswerable round)"]
    if not video_assets.is_valid_asset_id(name):
        return [f"{label} is not a valid asset id"]
    if content_root is not None and not (content_root / "video" / "assets" / name).is_file():
        return [f"{label} file is missing from the content package"]
    return []


def _item_errors(item: dict[str, Any], content_root: Path | None) -> list[str]:
    errors: list[str] = []
    key = item.get("key")
    if not isinstance(key, str) or not key.strip():
        errors.append("key must be a non-empty string")

    errors += _asset_errors(item.get("base_asset"), "base_asset", content_root)
    errors += _asset_errors(item.get("altered_asset"), "altered_asset", content_root)

    for f in ("width", "height", "duration_ms"):
        v = item.get(f)
        if not isinstance(v, int) or isinstance(v, bool) or v <= 0:
            errors.append(f"{f} must be a positive integer")

    difficulty = item.get("difficulty")
    if difficulty is not None and difficulty not in DIFFICULTIES:
        errors.append(f"difficulty must be one of {sorted(DIFFICULTIES)} or absent")

    questions = item.get("questions")
    if not isinstance(questions, list) or len(questions) != COMPREHENSION_QUESTIONS:
        errors.append(f"questions must be exactly {COMPREHENSION_QUESTIONS} entries")
    else:
        for i, q in enumerate(questions):
            errors += _question_errors(q, f"questions[{i}]")
    errors += _question_errors(item.get("change_question"), "change_question")
    return errors


def validate_manifest(
    manifest: dict[str, Any], content_root: Path | None = None
) -> list[tuple[int, str]]:
    """All (item_index, reason) problems; empty list = valid. Index -1 is manifest-level.

    Passing `content_root` additionally checks each referenced clip exists, which is what the
    ingest wants; omitting it validates shape only, which is what a schema test wants."""
    errors: list[tuple[int, str]] = []
    if manifest.get("version") != MANIFEST_VERSION:
        errors.append((-1, f"manifest version must be {MANIFEST_VERSION}"))
    items = manifest.get("items")
    if not isinstance(items, list):
        errors.append((-1, "items must be a list"))
        return errors
    seen: set[str] = set()
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append((i, "item must be an object"))
            continue
        for reason in _item_errors(item, content_root):
            errors.append((i, reason))
        key = item.get("key")
        if isinstance(key, str) and key:
            if key in seen:
                errors.append((i, f"duplicate key {key!r}"))
            seen.add(key)
    return errors


def merge_questions(manifest: dict[str, Any], questions: dict[str, Any]) -> int:
    """Fold the authored copy into the manifest items, by key. Returns how many were stamped.

    Mirrors how `ingest-change` stamps difficulty from its own authored file: the mechanical
    manifest never carries human copy, so a regenerated manifest cannot silently drop it.

    Difficulty rides along for exactly that reason. It is a HUMAN judgement about how hard the
    change is to spot — not something probed from the file — so keeping it in the manifest would
    lose it the next time the manifest is rebuilt from the assets, silently and with no error.
    """
    stamped = 0
    items = manifest.get("items")
    if not isinstance(items, list):
        return 0
    for item in items:
        if not isinstance(item, dict):
            continue
        authored = questions.get(item.get("key"))
        if not isinstance(authored, dict):
            continue
        if "questions" not in item and isinstance(authored.get("questions"), list):
            item["questions"] = authored["questions"]
            stamped += 1
        if "change_question" not in item and isinstance(authored.get("change_question"), dict):
            item["change_question"] = authored["change_question"]
        if "difficulty" not in item and isinstance(authored.get("difficulty"), str):
            item["difficulty"] = authored["difficulty"]
    return stamped


async def ingest_video_manifest(
    session: AsyncSession,
    manifest: dict[str, Any],
    content_root: Path | None = None,
    *,
    retire_missing: bool = False,
) -> VideoIngestReport:
    """Upsert by key: new keys insert, changed rows refresh in place, unchanged rows no-op.

    Manifest-level errors reject everything; per-item errors reject only those items, loudly, in
    the report — a malformed clip must never ingest half-formed and surface as a broken round.

    `retire_missing` makes the manifest the active set, exactly as it does for change items — same
    rule, same reason: this ingest rejects PER ITEM, so a rejected clip is indistinguishable from a
    deleted one and retiring is refused outright unless the manifest came through clean. Retiring
    deactivates rather than deletes, so a pinned round plan still resolves the clip it drew.
    """
    # Imported HERE for the same reason change_manifest does it: importing app.models constructs
    # Settings, which in production refuses to exist until ROT_CONTENT_DIR does — and the content
    # fetcher is what creates that directory. Validation must not require a booted app.
    from app.models import CognitionVideoItem

    report = VideoIngestReport()
    errors = validate_manifest(manifest, content_root)
    if [e for e in errors if e[0] == -1]:
        report.rejected = errors
        return report
    bad_indexes = {i for i, _ in errors}
    report.rejected = errors

    existing = {
        row.key: row for row in (await session.execute(select(CognitionVideoItem))).scalars().all()
    }
    for i, item in enumerate(manifest["items"]):
        if i in bad_indexes:
            continue
        values = {
            "base_asset": item["base_asset"],
            "altered_asset": item["altered_asset"],
            "width": item["width"],
            "height": item["height"],
            "duration_ms": item["duration_ms"],
            "questions": item["questions"],
            "change_question": item["change_question"],
            "difficulty": item.get("difficulty"),
        }
        row = existing.get(item["key"])
        if row is None:
            session.add(CognitionVideoItem(key=item["key"], **values))
            report.added += 1
            continue
        if any(getattr(row, k) != v for k, v in values.items()):
            for k, v in values.items():
                setattr(row, k, v)
            report.updated += 1
        else:
            report.skipped += 1
        if retire_missing and not row.active:
            row.active = True
            report.reactivated += 1

    if retire_missing and not report.rejected:
        present = {item["key"] for item in manifest["items"]}
        for key, row in existing.items():
            if key not in present and row.active:
                row.active = False
                report.retired += 1

    await session.flush()
    return report


__all__ = [
    "COMPREHENSION_QUESTIONS",
    "MANIFEST_VERSION",
    "OPTIONS_PER_QUESTION",
    "VideoIngestReport",
    "ingest_video_manifest",
    "merge_questions",
    "read_manifest",
    "read_questions",
    "validate_manifest",
]
