"""Independently check a tree that is about to be, or has just been, published.

`export_public.py` verifies the tree it BUILDS. This verifies a tree as it STANDS — which is what
someone cloning the public repository actually receives. The two can differ: a bad merge, a
hand-edit, a partially-applied sync, or a bug in the exporter's own copy step.

Deliberately separate from the exporter, and deliberately re-derives everything from
assets-manifest.json rather than sharing the exporter's in-memory state. A checker that imports the
thing it is checking agrees with it by construction.

    python scripts/verify_public_tree.py <tree>       # a working tree
    python scripts/verify_public_tree.py <repo> --git # every blob in the object database too

Exits non-zero on any finding.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = REPO / "assets-manifest.json"

PRIVATE_DISPOSITIONS = {"private", "public-replacement-required", "deleted"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico"}

SECRET_PATTERNS = {
    "private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY"),
    "aws key": re.compile(rb"AKIA[0-9A-Z]{16}"),
    "github token": re.compile(rb"gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,}"),
    "openai key": re.compile(rb"sk-[A-Za-z0-9]{32,}"),
    "local path": re.compile(rb"[A-Za-z]:[\\/]Users[\\/][A-Za-z0-9._-]+"),
}
SECRET_ALLOW = {
    ("private key", "backend/tests/test_push_android_fcm.py"),
    ("private key", "backend/app/core/config.py"),
}

# Paths that must never appear in a published tree, whatever the manifest says.
FORBIDDEN_PREFIXES = (
    "backend/content/bank/",
    "backend/content/generated/",
    "backend/content/estimate/fermi.json",
    "backend/content/campaign/levels.json",
    "backend/content/trivia.json",
    "frontend/public/assets/change/",
    "docs/PRODUCTION-CUTOVER.md",
    "oss/",
    "tools/",
    ".github/workflows/sync-public.yml",
)


def load_hashes() -> tuple[set[str], set[str]]:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    private = {a["sha256"] for a in data["assets"] if a["disposition"] in PRIVATE_DISPOSITIONS}
    keep = {a["sha256"] for a in data["assets"] if a["disposition"] in ("public", "public-brand")}
    # A blob that is both (icon.png is byte-identical to a deleted duplicate) is legitimate.
    return private - keep, keep


def check_tree(root: pathlib.Path, banned: set[str]) -> list[str]:
    problems: list[str] = []
    for p in root.rglob("*"):
        if not p.is_file() or ".git" in p.parts:
            continue
        rel = p.relative_to(root).as_posix()
        if rel.startswith(FORBIDDEN_PREFIXES):
            problems.append(f"FORBIDDEN PATH: {rel}")
        if p.suffix.lower() in IMAGE_SUFFIXES:
            if hashlib.sha256(p.read_bytes()).hexdigest()[:16] in banned:
                problems.append(f"PRIVATE ART: {rel}")
            continue
        if p.suffix.lower() in {".ttf", ".otf", ".woff2"}:
            continue
        try:
            data = p.read_bytes()
        except OSError:
            continue
        for name, rx in SECRET_PATTERNS.items():
            if rx.search(data) and (name, rel) not in SECRET_ALLOW:
                problems.append(f"SECRET [{name}]: {rel}")
    return problems


def check_history(repo: pathlib.Path, banned: set[str]) -> list[str]:
    """Every blob ever committed. Removing a file from HEAD does not remove it from a repository."""
    problems: list[str] = []
    listing = subprocess.run(
        ["git", "rev-list", "--objects", "--all"],
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    for line in listing.splitlines():
        parts = line.split(maxsplit=1)
        if len(parts) != 2:
            continue
        sha, name = parts
        if not name.lower().endswith(tuple(IMAGE_SUFFIXES)):
            continue
        blob = subprocess.run(
            ["git", "cat-file", "blob", sha], cwd=repo, capture_output=True, check=True
        ).stdout
        if hashlib.sha256(blob).hexdigest()[:16] in banned:
            problems.append(f"PRIVATE ART IN HISTORY: {name} ({sha[:10]})")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("tree", type=pathlib.Path)
    ap.add_argument(
        "--git", action="store_true", help="also scan every blob in the object database"
    )
    args = ap.parse_args()

    root = args.tree.resolve()
    banned, _ = load_hashes()

    problems = check_tree(root, banned)
    if args.git:
        problems += check_history(root, banned)

    if problems:
        print(f"PUBLIC TREE REJECTED — {len(problems)} problem(s):", file=sys.stderr)
        for x in problems[:30]:
            print(f"  {x}", file=sys.stderr)
        return 1

    scanned = sum(1 for p in root.rglob("*") if p.is_file() and ".git" not in p.parts)
    print(f"public tree OK — {scanned} files, no private art, no secrets, no forbidden paths")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
