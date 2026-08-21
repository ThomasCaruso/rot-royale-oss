"""Build the public repository's tree from this one.

The public repo is a DERIVED ARTIFACT, never edited by hand. This script is the only thing that
produces it, so it is the only thing that can leak — which is why it verifies its own output by
CONTENT rather than trusting that it removed the right paths.

    private repo @ <commit>
        remove every private path
        substitute dimension-accurate placeholders
        map oss/README.public.md -> README.md
        VERIFY: no private-art blob, no secret, no local path
    -> a tree ready to commit to the public repo

Two rules keep this honest:

**Fail closed.** Any verification failure aborts and writes nothing. A partial export that "mostly"
removed the art is worse than no export, because it looks like it worked.

**Derive, never hardcode.** The private-path list comes from assets-manifest.json, so adding an
asset to the manifest is all it takes for the next export to handle it. A hardcoded list goes stale
silently, and the first time you notice is when the art is already public.

Usage:
    python scripts/export_public.py <output-dir> [--commit HEAD]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = REPO / "assets-manifest.json"

# Dispositions whose files must NOT reach the public tree.
PRIVATE_DISPOSITIONS = {"private", "public-replacement-required", "deleted"}

# Paths that are private but are not tracked in the manifest, because they no longer exist at HEAD
# or were never assets. Kept explicit and commented — an unexplained entry here is a future mystery.
EXTRA_PRIVATE_PREFIXES = (
    # Production change-detection imagery. Removed from HEAD in Phase 2Q; the manifest's bounding
    # boxes turn these into answer keys.
    "frontend/public/assets/change/",
    # A committed Capacitor build artifact carrying hashed copies of the lobby art.
    "frontend/ios/App/App/public/assets/",
)

# Files that exist only to be renamed on the way out.
RENAMES = {"oss/README.public.md": "README.md"}

# Private-repo-only paths: working notes and process docs that would confuse a contributor.
EXCLUDE = (
    "oss/",
    "docs/PRODUCTION-CUTOVER.md",  # an internal runbook with service ids in it
    # Developer tooling that has NOT had its own provenance and security review. It generates the
    # change-detection manifests, so it is genuine tooling worth keeping — but tooling can carry
    # model prompts, API assumptions and proprietary process, and publishing it is a separate
    # decision from publishing the application. It reached the tracked tree via a `git add -A`
    # during a merge; the export is what caught it.
    "tools/",
)

SECRET_PATTERNS = {
    "private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY"),
    "aws key": re.compile(rb"AKIA[0-9A-Z]{16}"),
    "github token": re.compile(rb"gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,}"),
    "openai key": re.compile(rb"sk-[A-Za-z0-9]{32,}"),
    "slack token": re.compile(rb"xox[baprs]-[A-Za-z0-9-]{20,}"),
    "local path": re.compile(rb"[A-Za-z]:[\\/]Users[\\/][A-Za-z0-9._-]+"),
}
# Known-benign matches, each justified. Anything not listed here fails the export.
SECRET_ALLOW = {
    # Documented throwaway RS256 key, paired with a fake service-account address.
    ("private key", "backend/tests/test_push_android_fcm.py"),
    # Docstrings describing the PEM format an operator must paste into an env var.
    ("private key", "backend/app/core/config.py"),
}

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico"}


def sh(*args: str, cwd: pathlib.Path | None = None) -> str:
    return subprocess.run(args, cwd=cwd or REPO, capture_output=True, text=True, check=True).stdout


def load_manifest() -> tuple[set[str], dict[str, str], set[str]]:
    """(private paths, path -> sha256 prefix for private blobs, sha of blobs that may stay)."""
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    private, private_sha, keep_sha = set(), {}, set()
    for a in data["assets"]:
        p = a["path"].replace("\\", "/")
        if a["disposition"] in PRIVATE_DISPOSITIONS:
            private.add(p)
            private_sha[p] = a["sha256"]
        else:
            keep_sha.add(a["sha256"])
    return private, private_sha, keep_sha


def is_private(path: str, private: set[str]) -> bool:
    return path in private or path.startswith(EXTRA_PRIVATE_PREFIXES)


def make_placeholder(src: pathlib.Path, dest: pathlib.Path, rel: str) -> None:
    """A stand-in at the ORIGINAL dimensions.

    `frontend/src` imports are resolved statically by Vite, so a missing file is a build failure
    rather than a blank image — a contributor could not run the project at all. Dimensions must
    match because several components measure the image instead of assuming a size.
    """
    from PIL import Image, ImageDraw

    with Image.open(src) as im:
        w, h = im.size
        alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info

    seed = int(hashlib.sha256(rel.encode()).hexdigest()[:8], 16)
    base = (88 + seed % 40, 74 + (seed >> 8) % 34, 132 + (seed >> 16) % 46)
    mode = "RGBA" if alpha else "RGB"
    img = Image.new(mode, (w, h), base + ((70,) if alpha else ()))
    d = ImageDraw.Draw(img)
    line = tuple(min(255, c + 55) for c in base) + ((150,) if alpha else ())
    d.line([(0, 0), (w, h)], fill=line, width=max(1, min(w, h) // 64))
    d.line([(w, 0), (0, h)], fill=line, width=max(1, min(w, h) // 64))
    inset = max(1, min(w, h) // 20)
    d.rectangle(
        [inset, inset, w - inset - 1, h - inset - 1], outline=line, width=max(1, min(w, h) // 80)
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix.lower() in (".jpg", ".jpeg"):
        img.convert("RGB").save(dest, "JPEG", quality=70)
    else:
        img.save(dest, "PNG", optimize=True)


def verify(
    out: pathlib.Path,
    private_sha: dict[str, str],
    keep_sha: set[str],
    rename_expect: dict[str, bytes] | None = None,
) -> list[str]:
    """Every reason this tree must not be published. Empty list = safe."""
    problems: list[str] = []

    # 1. No private-art bytes, matched by CONTENT. A path check would miss a copy under a new name,
    #    which is exactly how the art got into a committed iOS build artifact in the first place.
    banned = set(private_sha.values()) - keep_sha
    for p in out.rglob("*"):
        if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES:
            if hashlib.sha256(p.read_bytes()).hexdigest()[:16] in banned:
                problems.append(f"PRIVATE ART: {p.relative_to(out)}")

    # 2. No secrets, and no local filesystem paths (which leak a username and break for everyone).
    for p in out.rglob("*"):
        if not p.is_file() or p.suffix.lower() in IMAGE_SUFFIXES | {".ttf", ".otf", ".woff2"}:
            continue
        rel = p.relative_to(out).as_posix()
        try:
            data = p.read_bytes()
        except OSError:
            continue
        for name, rx in SECRET_PATTERNS.items():
            if rx.search(data) and (name, rel) not in SECRET_ALLOW:
                problems.append(f"SECRET [{name}]: {rel}")

    # 3. Nothing under an excluded prefix survived. Exclusions remove internal documents — a
    #    runbook naming production service ids has no business in a public repository.
    for p in out.rglob("*"):
        if p.is_file() and p.relative_to(out).as_posix().startswith(EXCLUDE):
            problems.append(f"EXCLUDED PATH PRESENT: {p.relative_to(out)}")

    # 4. The private content package must never be exported.
    for marker in ("backend/content/bank", "backend/content/estimate/fermi.json"):
        if (out / marker).exists():
            problems.append(f"PRODUCTION CONTENT: {marker}")

    # 5. Each renamed file holds the content it was renamed FROM. This is the check that catches a
    #    no-op rename leaving the private README in place.
    for dest, expected in (rename_expect or {}).items():
        target = out / dest
        if not target.is_file():
            problems.append(f"RENAME TARGET MISSING: {dest}")
        elif target.read_bytes() != expected:
            problems.append(f"RENAME DID NOT APPLY: {dest} holds unexpected content")

    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("output", type=pathlib.Path)
    ap.add_argument("--commit", default="HEAD")
    args = ap.parse_args()

    commit = sh("git", "rev-parse", args.commit).strip()
    private, private_sha, keep_sha = load_manifest()

    with tempfile.TemporaryDirectory(prefix="rot-export-") as tmp:
        staging = pathlib.Path(tmp) / "tree"
        staging.mkdir()
        # Export from the COMMIT, not the working tree: an export must describe a revision, not
        # whatever happens to be lying around uncommitted.
        archive = pathlib.Path(tmp) / "src.tar"
        archive.write_bytes(
            subprocess.run(
                ["git", "archive", commit], cwd=REPO, capture_output=True, check=True
            ).stdout
        )
        shutil.unpack_archive(archive, staging, format="tar")

        # Remember the intended content of each renamed file. Checking only that the destination
        # EXISTS is not enough: the private README.md already sits at that path, so a rename that
        # silently no-ops leaves the wrong file there and passes an existence check.
        rename_expect = {
            dest: (staging / src).read_bytes()
            for src, dest in RENAMES.items()
            if (staging / src).is_file()
        }

        # Renames run BEFORE exclusions. oss/ is excluded wholesale, so deleting first would
        # take the public README with it and silently ship the private one in its place — which
        # is exactly what happened the first time this ran.
        for src_rel, dest_rel in RENAMES.items():
            src = staging / src_rel
            if src.is_file():
                dest = staging / dest_rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), str(dest))

        removed = placeholders = 0
        for p in sorted(staging.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(staging).as_posix()
            if rel.startswith(EXCLUDE):
                p.unlink()
                continue
            if is_private(rel, private):
                if p.suffix.lower() in IMAGE_SUFFIXES:
                    make_placeholder(p, p, rel)
                    placeholders += 1
                else:
                    p.unlink()
                removed += 1

        for d in sorted((x for x in staging.rglob("*") if x.is_dir()), key=lambda x: -len(x.parts)):
            try:
                d.rmdir()
            except OSError:
                pass

        problems = verify(staging, private_sha, keep_sha, rename_expect)
        if problems:
            print(f"EXPORT REFUSED — {len(problems)} problem(s):", file=sys.stderr)
            for x in problems[:20]:
                print(f"  {x}", file=sys.stderr)
            return 1

        # Record WHICH private commit produced this tree. The sync commit message quotes it, and
        # deriving it here removes the chance of quoting the wrong one — the first sync named the
        # public repo's own HEAD, because that is what `git rev-parse` returns when you happen to
        # run it in the wrong directory.
        rev = staging / ".source-revision"
        rev.write_text(commit + "\n", encoding="utf-8", newline="\n")

        out = args.output.resolve()
        if out.exists():
            shutil.rmtree(out)
        shutil.copytree(staging, out)

    files = sum(1 for p in out.rglob("*") if p.is_file())
    print(f"exported {commit[:12]} -> {out}")
    print(f"  files: {files}   private paths handled: {removed}   placeholders: {placeholders}")
    print("  verification: PASSED (no private art, no secrets, no production content)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
