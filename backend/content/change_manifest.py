"""Change-detection asset-manifest ingest — the contract image pairs arrive under.

Manifest shape (JSON, see change/manifest.example.json for a stub):

    {
      "version": 2,
      "items": [
        {
          "key": "kitchen_01",                      # stable slug; upsert identity
          "base_asset": "kitchen_01_base.png",      # a file in <content_root>/change/assets/
          "altered_asset": "kitchen_01_altered.png",
          "width": 1024, "height": 768,             # source pixel dims (client layout only)
          "bbox": {"x": 0.40, "y": 0.30, "w": 0.10, "h": 0.10},  # NORMALIZED 0-1 coords
          "difficulty": "medium"                    # optional: easy | medium | hard
        }
      ]
    }

Bounding boxes are normalized to the image (0–1 per axis) so tap validation is resolution- and
screen-independent. Malformed items are rejected LOUDLY (reported per item, non-zero exit from the
CLI), never silently dropped — same contract as the trivia bank ingest.

v2 replaced the v1 `base_url`/`altered_url` web paths with `base_asset`/`altered_asset` ASSET IDS
resolved under `<content_root>/change/assets/` (content/change_assets.py). v1 pointed into
`frontend/public/`, which left production imagery in the application repo while every other piece
of gameplay content moved behind ROT_CONTENT_DIR; a public release that replaced that artwork would
have broken Change mode in production while the backend content package was entirely correct.

Unlike v1, the referenced FILES are now checked at ingest: an item naming an asset that is not in
the package is rejected, so a manifest and an incomplete asset copy fail the deploy loudly instead
of shipping a round with a blank frame — which is unfindable, and scores as a guaranteed miss.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from content import change_assets

MANIFEST_VERSION = 2

# Authored difficulty tiers. Optional per item (NULL = unbanded, treated as medium): they drive
# the Royale's easy-opener/hard-finish draw and Rot Rating's `notice` banding.
DIFFICULTIES: frozenset[str] = frozenset({"easy", "medium", "hard"})


@dataclass
class ChangeIngestReport:
    added: int = 0
    updated: int = 0
    skipped: int = 0
    rejected: list[tuple[int, str]] = field(default_factory=list)


def read_manifest(path: str | Path) -> dict[str, Any]:
    # json.loads returns Any; the annotation records that a manifest is expected to be an
    # object. The SHAPE is not assumed here — validate_manifest checks it, and reports a
    # non-object as a manifest-level error rather than crashing on attribute access.
    data: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
    return data


def _item_errors(item: dict[str, Any], content_root: Path | None) -> list[str]:
    errors: list[str] = []
    key = item.get("key")
    if not isinstance(key, str) or not key or len(key) > 64:
        errors.append("key must be a non-empty string of at most 64 chars")
    for asset_field in ("base_asset", "altered_asset"):
        asset = item.get(asset_field)
        if not isinstance(asset, str) or not asset:
            errors.append(f"{asset_field} must be a non-empty string")
        elif not change_assets.is_valid_asset_id(asset):
            errors.append(
                f"{asset_field} {asset!r} is not a valid asset id — one path segment, "
                f"no traversal, extension one of {sorted(change_assets.MEDIA_TYPES)}"
            )
        elif content_root is not None and change_assets.resolve(content_root, asset) is None:
            errors.append(f"{asset_field} {asset!r} is not present in the content package")
    for dim in ("width", "height"):
        v = item.get(dim)
        if not isinstance(v, int) or isinstance(v, bool) or v <= 0:
            errors.append(f"{dim} must be a positive integer")
    difficulty = item.get("difficulty")
    if difficulty is not None and difficulty not in DIFFICULTIES:
        errors.append(f"difficulty must be one of {sorted(DIFFICULTIES)} (or omitted)")

    bbox = item.get("bbox")
    if not isinstance(bbox, dict):
        errors.append("bbox must be an object {x, y, w, h}")
        return errors
    vals: dict[str, float] = {}
    for k in ("x", "y", "w", "h"):
        v = bbox.get(k)
        if not isinstance(v, int | float) or isinstance(v, bool):
            errors.append(f"bbox.{k} must be a number")
        else:
            vals[k] = float(v)
    if len(vals) == 4:
        if not (0.0 <= vals["x"] and 0.0 <= vals["y"]):
            errors.append("bbox origin must be within the image (normalized 0-1)")
        if vals["w"] <= 0.0 or vals["h"] <= 0.0:
            errors.append("bbox w/h must be positive")
        if vals["x"] + vals["w"] > 1.0 or vals["y"] + vals["h"] > 1.0:
            errors.append("bbox must fit inside the image (x+w and y+h at most 1)")
    return errors


def validate_manifest(
    manifest: dict[str, Any], content_root: Path | None = None
) -> list[tuple[int, str]]:
    """All (item_index, reason) problems in a manifest; empty list = valid.

    Index -1 flags manifest-level problems (version, shape). Passing `content_root` additionally
    checks that every referenced asset FILE exists in that package; omitting it validates shape
    only, which is what a pure schema test wants."""
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


async def ingest_change_manifest(
    session: AsyncSession, manifest: dict[str, Any], content_root: Path | None = None
) -> ChangeIngestReport:
    """Upsert manifest items by key: new keys insert, changed rows refresh in place, unchanged
    rows are a no-op. Files are the source of truth, mirroring the trivia bank ingest. Manifest-
    level errors reject everything; per-item errors reject just those items (loudly, in the
    report)."""
    # Imported HERE, not at module scope: importing app.models pulls in app.core.config,
    # which CONSTRUCTS Settings — and in production Settings refuses to exist until
    # ROT_CONTENT_DIR does. The content fetcher's job is to create that directory, so a
    # module-level import deadlocked the build. Validation must not require a booted app.
    from app.models import CognitionChangeItem

    report = ChangeIngestReport()
    errors = validate_manifest(manifest, content_root)
    manifest_level = [e for e in errors if e[0] == -1]
    if manifest_level:
        report.rejected = errors
        return report
    bad_indexes = {i for i, _ in errors}
    report.rejected = errors

    existing = {
        row.key: row for row in (await session.execute(select(CognitionChangeItem))).scalars().all()
    }
    for i, item in enumerate(manifest["items"]):
        if i in bad_indexes:
            continue
        bbox = item["bbox"]
        values = {
            "base_asset": item["base_asset"],
            "altered_asset": item["altered_asset"],
            "width": item["width"],
            "height": item["height"],
            "bbox_x": Decimal(str(bbox["x"])),
            "bbox_y": Decimal(str(bbox["y"])),
            "bbox_w": Decimal(str(bbox["w"])),
            "bbox_h": Decimal(str(bbox["h"])),
            "difficulty": item.get("difficulty"),
        }
        row = existing.get(item["key"])
        if row is None:
            session.add(CognitionChangeItem(key=item["key"], **values))
            report.added += 1
            continue
        changed = any(getattr(row, k) != v for k, v in values.items())
        if changed:
            for k, v in values.items():
                setattr(row, k, v)
            report.updated += 1
        else:
            report.skipped += 1
    await session.flush()
    return report
