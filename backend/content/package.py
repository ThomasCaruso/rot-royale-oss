"""Is a directory a USABLE content package?

One definition, so the answer cannot drift between the thing that fetches a package and the thing
that serves it. `scripts/fetch_private_content.py` runs this against a freshly downloaded package
before that package is allowed to become ROT_CONTENT_DIR; the same function answers the same
question for the committed sample corpus.

The checks reuse the real ingest/build validators rather than reimplementing them, because a
package that satisfies a private copy of the rules and fails the real ones is exactly the failure
this is supposed to prevent. Every problem is collected and returned — a caller reporting one error
at a time turns a broken package into several deploys.

Deliberately NOT checked here: how much content a package holds. The sample corpus is small by
design and the production one is not, so a size floor would either reject the samples or be too
loose to catch anything. Completeness is a property of the CONTENT (the campaign build already
fails if a bank cannot fill its worlds), not of the packaging.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

REQUIRED_FILES = (
    "campaign/config.json",
    "campaign/levels.json",
    "change/manifest.json",
    "estimate/fermi.json",
    "trivia.json",
)
REQUIRED_DIRS = ("bank", "change/assets")


def _check_bank(root: Path, problems: list[str]) -> None:
    from content.ingest import read_bank_rows

    try:
        rows = read_bank_rows(root / "bank")
    except Exception as exc:
        problems.append(f"bank/: unreadable ({exc})")
        return
    if not rows:
        problems.append("bank/: no question rows")


def _check_campaign(root: Path, problems: list[str]) -> None:
    from content.campaign import spec as spec_mod
    from content.campaign.build_manifest import ManifestError, build

    try:
        spec = spec_mod.load(root)
    except Exception as exc:
        problems.append(f"campaign/config.json: {exc}")
        return
    # The committed manifest must equal a fresh build from THIS package's own spec and banks. This
    # is the strongest single check available: it proves the levels file was built from the banks
    # sitting next to it, so a stale manifest, an edited bank, or a manifest swapped in from another
    # package all fail here rather than at play time as a level that cannot resolve its questions.
    try:
        fresh = build(spec=spec, content_root=root)
    except (ManifestError, Exception) as exc:
        problems.append(f"campaign: manifest does not build from this package ({exc})")
        return
    try:
        committed = json.loads(spec_mod.levels_path(root).read_text(encoding="utf-8"))
    except Exception as exc:
        problems.append(f"campaign/levels.json: unreadable ({exc})")
        return
    if committed != fresh:
        problems.append(
            "campaign/levels.json: does not match a fresh build from this package's banks "
            "(stale manifest, or banks edited without rebuilding)"
        )


def _check_change(root: Path, problems: list[str]) -> None:
    from content.change_manifest import read_manifest, validate_manifest

    path = root / "change" / "manifest.json"
    try:
        manifest = read_manifest(path)
    except Exception as exc:
        problems.append(f"change/manifest.json: unreadable ({exc})")
        return
    # Passing the root makes this check the ASSET FILES too, not just the schema — a manifest whose
    # imagery did not travel with it is the specific way this package can be silently incomplete.
    for index, reason in validate_manifest(manifest, root):
        where = "manifest" if index == -1 else f"item {index}"
        problems.append(f"change/manifest.json {where}: {reason}")


def _check_estimate(root: Path, problems: list[str]) -> None:
    from content.estimate_ingest import read_estimate_items, validate_estimate_items

    path = root / "estimate" / "fermi.json"
    try:
        items = read_estimate_items(path)
    except Exception as exc:
        problems.append(f"estimate/fermi.json: unreadable ({exc})")
        return
    for index, reason in validate_estimate_items(items):
        where = "file" if index == -1 else f"item {index}"
        problems.append(f"estimate/fermi.json {where}: {reason}")


def _check_trivia(root: Path, problems: list[str]) -> None:
    try:
        rows: Any = json.loads((root / "trivia.json").read_text(encoding="utf-8"))
    except Exception as exc:
        problems.append(f"trivia.json: unreadable ({exc})")
        return
    if not isinstance(rows, list) or not rows:
        problems.append("trivia.json: must be a non-empty array")
        return
    for i, r in enumerate(rows):
        if not isinstance(r, dict) or not isinstance(r.get("options"), list):
            problems.append(f"trivia.json row {i}: malformed")
            break
        if not isinstance(r.get("correctIndex"), int) or not (
            0 <= r["correctIndex"] < len(r["options"])
        ):
            problems.append(f"trivia.json row {i}: correctIndex out of range")
            break


def validate(content_root: str | Path) -> list[str]:
    """Every problem with the package at `content_root`; an empty list means it is usable."""
    root = Path(content_root)
    problems: list[str] = []

    if not root.is_dir():
        return [f"{root}: not a directory"]
    for rel in REQUIRED_DIRS:
        if not (root / rel).is_dir():
            problems.append(f"{rel}/: missing")
    for rel in REQUIRED_FILES:
        if not (root / rel).is_file():
            problems.append(f"{rel}: missing")
    if problems:
        # Structure first: with a file missing, every downstream check reports the same absence in
        # its own words, and the real problem gets lost in the noise.
        return problems

    _check_bank(root, problems)
    _check_campaign(root, problems)
    _check_change(root, problems)
    _check_estimate(root, problems)
    _check_trivia(root, problems)
    return problems
