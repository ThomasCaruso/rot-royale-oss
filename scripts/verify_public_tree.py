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

# assets-manifest.json stores truncated digests; every comparison must truncate the same way.
DIGEST_PREFIX_LEN = 16

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
    "oss/",
    "tools/",
    # Agent-facing working documents, not product documentation.
    "CLAUDE.md",
    "PLAN.md",
    ".claude/",
    # Internal deployment topology for a torn-down private environment.
    "render.staging.yaml",
    ".github/workflows/sync-public.yml",
)

# docs/ is deny-by-default here too. Stated independently of the exporter's DOCS_ALLOW rather than
# imported from it: a checker that shares the exporter's list agrees with the exporter by
# construction, and would not catch the exporter allowlisting something it should not have.
PUBLISHED_DOCS = ("docs/architecture.md",)

# Written by the exporter in place of assets-manifest.json — digests only, no paths.
PUBLIC_MANIFEST_NAME = "public-verification-manifest.json"


def load_hashes(tree: pathlib.Path) -> tuple[set[str], str]:
    """The digests that must not appear in `tree`, and where that list came from.

    Two sources, and the order matters. The AUTHORITATIVE one is the full asset manifest, which
    exists only in the private repository — and that is what the sync workflow uses, because it runs
    this script from the private checkout against the public clone. Deriving the ban list from
    outside the tree being checked is the whole point: a manifest read from inside that tree could
    be emptied by the same bad export that put the artwork there, and would then approve it.

    The SANITIZED manifest is the fallback, for someone who cloned the public repository and has no
    access to the real one. It carries digests and nothing else, so it cannot map the private
    artwork, and it is a derived artifact rewritten on every export so it cannot drift.
    """
    if MANIFEST.is_file():
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        private = {a["sha256"] for a in data["assets"] if a["disposition"] in PRIVATE_DISPOSITIONS}
        keep = {
            a["sha256"] for a in data["assets"] if a["disposition"] in ("public", "public-brand")
        }
        # A blob that is both (icon.png is byte-identical to a deleted duplicate) is legitimate.
        return private - keep, "assets-manifest.json (authoritative)"

    pub = tree / PUBLIC_MANIFEST_NAME
    if not pub.is_file():
        raise SystemExit(
            f"no manifest to verify against: neither {MANIFEST} nor {pub} exists. Refusing to "
            f"report a tree as clean when nothing was actually checked."
        )
    banned = set(json.loads(pub.read_text(encoding="utf-8")).get("withheld_sha256") or [])
    if not banned:
        # An empty ban list passes every tree, including a leaking one. That is indistinguishable
        # from success in the output, so it has to be an error here.
        raise SystemExit(f"{pub} lists no withheld digests — it cannot verify anything.")
    return banned, f"{PUBLIC_MANIFEST_NAME} (sanitized)"


def check_tree(root: pathlib.Path, banned: set[str]) -> list[str]:
    problems: list[str] = []
    for p in root.rglob("*"):
        if not p.is_file() or ".git" in p.parts:
            continue
        rel = p.relative_to(root).as_posix()
        if rel.startswith(FORBIDDEN_PREFIXES):
            problems.append(f"FORBIDDEN PATH: {rel}")
        if rel.startswith("docs/") and rel not in PUBLISHED_DOCS:
            problems.append(f"UNPUBLISHED DOC: {rel}")
        if p.suffix.lower() in IMAGE_SUFFIXES:
            if hashlib.sha256(p.read_bytes()).hexdigest()[:DIGEST_PREFIX_LEN] in banned:
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
        if hashlib.sha256(blob).hexdigest()[:DIGEST_PREFIX_LEN] in banned:
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
    banned, source = load_hashes(root)

    problems = check_tree(root, banned)
    if args.git:
        problems += check_history(root, banned)

    if problems:
        print(f"PUBLIC TREE REJECTED — {len(problems)} problem(s):", file=sys.stderr)
        for x in problems[:30]:
            print(f"  {x}", file=sys.stderr)
        return 1

    scanned = sum(1 for p in root.rglob("*") if p.is_file() and ".git" not in p.parts)
    print(
        f"public tree OK — {scanned} files, no private art, no secrets, no forbidden paths\n"
        f"  checked {len(banned)} withheld digests from {source}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
