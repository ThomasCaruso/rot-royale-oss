"""Prove the staged public tree contains everything the export produced.

Every other check in this pipeline is NEGATIVE — it looks for things that must not be there:
private artwork, secrets, internal documents, unclassified paths. All of them pass happily on a
tree that is missing half the repository, because absence is not what they are looking for.

That gap was not theoretical. `.gitignore` contains `frontend/ios/`. Those 24 files are
force-tracked in the private repository, so the ignore rule has no effect there; the exporter
therefore emitted them and the classification registry declared them public. But the sync applied
the export into the public checkout and ran `git add -A`, which honours `.gitignore` — so they
never staged, and the public repository has been missing the entire iOS project since the first
sync. Export produced 1046 files; the repository tracked 1022. Nothing failed. Nothing warned.

The invariant this restores, stated positively:

    The published tree is EXACTLY the exported tree.

Not "contains no secrets". Not "mostly matches". Exactly — same paths, same bytes. The public
repository is a derived artifact, so the exporter is the only thing entitled to decide its contents,
and no ignore rule, staging default or copy behaviour may quietly overrule it.

**Independence.** The expected set is read from the exporter's OUTPUT DIRECTORY on disk, and the
actual set is read from git's INDEX. Neither comes from the code that did the staging, so this
cannot agree with a bug in that code by construction. Content is compared through `git hash-object`
against the index's own blob ids, so a file staged with the wrong bytes fails just as a missing one
does.

    python scripts/verify_export_complete.py <export-dir> <public-repo>

Exits non-zero on any difference.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = REPO / "assets-manifest.json"

PLACEHOLDER_DISPOSITIONS = {"private", "public-replacement-required"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico"}


def _git(repo: pathlib.Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True, check=True
    ).stdout


def exported_files(export_dir: pathlib.Path) -> dict[str, pathlib.Path]:
    """Every file the exporter wrote, keyed by repo-relative posix path."""
    out: dict[str, pathlib.Path] = {}
    for p in export_dir.rglob("*"):
        if p.is_file() and ".git" not in p.relative_to(export_dir).parts:
            out[p.relative_to(export_dir).as_posix()] = p
    return out


def staged_blobs(repo: pathlib.Path) -> dict[str, str]:
    """Every path in git's INDEX, mapped to the blob id git recorded for it.

    Read from the index rather than from the working tree: the working tree is what was copied in,
    and the question is precisely whether staging captured it. `ls-files --cached` answers what will
    actually be committed.
    """
    out: dict[str, str] = {}
    for line in _git(repo, "ls-files", "--stage", "-z").split("\0"):
        if not line.strip():
            continue
        meta, _, path = line.partition("\t")
        parts = meta.split()
        if len(parts) >= 2 and path:
            out[path] = parts[1]
    return out


def placeholder_paths() -> list[str]:
    """Image paths the manifest says are withheld — every one must exist as a stand-in.

    Derived from assets-manifest.json, NOT from the export. If the exporter silently stopped
    generating placeholders, an export-vs-index comparison alone would still pass: both sides would
    agree the file is absent. This is the one check that knows a file is supposed to exist at all.
    """
    if not MANIFEST.is_file():
        return []
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return sorted(
        a["path"].replace("\\", "/")
        for a in data["assets"]
        if a["disposition"] in PLACEHOLDER_DISPOSITIONS
        and pathlib.Path(a["path"]).suffix.lower() in IMAGE_SUFFIXES
    )


def compare(
    export_dir: pathlib.Path,
    repo: pathlib.Path,
    placeholders: list[str] | None = None,
) -> list[str]:
    """Every reason the staged tree is not the exported tree. Empty list = complete.

    `placeholders` is injected rather than read from the manifest inside here, so the expectation
    is visible at the call site and a test can supply its own. It still DEFAULTS to the manifest —
    the production path must not depend on a caller remembering to pass it.
    """
    problems: list[str] = []
    placeholders = placeholder_paths() if placeholders is None else placeholders

    exported = exported_files(export_dir)
    staged = staged_blobs(repo)
    if not exported:
        return [
            f"NOTHING EXPORTED: {export_dir} contains no files — refusing to call that complete"
        ]
    if not staged:
        return ["NOTHING STAGED: git index is empty"]

    missing = sorted(set(exported) - set(staged))
    extra = sorted(set(staged) - set(exported))
    for rel in missing:
        problems.append(f"MISSING FROM THE PUBLISHED TREE: {rel}")
    for rel in extra:
        problems.append(f"STAGED BUT NOT EXPORTED: {rel}")

    # Content, via git's own hashing so the comparison is exactly what will be committed.
    for rel in sorted(set(exported) & set(staged)):
        blob = _git(repo, "hash-object", str(exported[rel])).strip()
        if blob != staged[rel]:
            problems.append(f"CONTENT DIFFERS: {rel} (staged {staged[rel][:9]}, export {blob[:9]})")

    # Placeholders, derived independently from the manifest.
    absent = [rel for rel in placeholders if rel not in staged]
    for rel in absent:
        problems.append(f"PLACEHOLDER MISSING: {rel}")

    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("export_dir", type=pathlib.Path)
    ap.add_argument("repo", type=pathlib.Path)
    args = ap.parse_args()

    problems = compare(args.export_dir.resolve(), args.repo.resolve())
    if problems:
        print(f"PUBLICATION INCOMPLETE — {len(problems)} problem(s):", file=sys.stderr)
        for p in problems[:40]:
            print(f"  {p}", file=sys.stderr)
        if len(problems) > 40:
            print(f"  ... and {len(problems) - 40} more", file=sys.stderr)
        print(
            "\nThe published tree must be EXACTLY the exported tree. A path that vanished between "
            "the two was almost certainly dropped by an ignore rule during staging.",
            file=sys.stderr,
        )
        return 1

    exported = exported_files(args.export_dir.resolve())
    print(
        f"publication complete — {len(exported)} exported files all staged, "
        f"content-identical, {len(placeholder_paths())} placeholders present"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
