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

import export_classification

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

# Documentation is ALLOWLISTED, not blocklisted. Everything under docs/ is dropped unless it is
# named here.
#
# The blocklist that preceded this named exactly one file — the cutover runbook — and published the
# other 45, including 27 agent-directed implementation plans and a set of generated corpus reports
# that between them quoted 134 verbatim production questions. That is the blocklist failure mode:
# it protects what you thought of, and every doc added afterwards ships by default.
#
# Deny-by-default inverts the default. A new internal document is private until someone deliberately
# publishes it, which is the direction the mistake should point.
DOCS_ALLOW = ("docs/architecture.md",)

# Private-repo-only paths: working notes and process docs that would confuse a contributor.
EXCLUDE = (
    "oss/",
    # Agent-facing working documents. CLAUDE.md and PLAN.md are the repo's internal operating
    # instructions and milestone spec — process, not product. docs/architecture.md is the public
    # documentation written to replace them, and README.public.md points at it instead.
    "CLAUDE.md",
    "PLAN.md",
    # A working session log for the login/front-door redesign: measurements, rejected approaches and
    # the reasoning behind numbers now in the code. Same class as docs/ — written for the next
    # session, not for a contributor, and it quotes the private reference comp.
    "HANDOFF-login-screen.md",
    ".claude/",
    # Developer tooling that has NOT had its own provenance and security review. It generates the
    # change-detection manifests, so it is genuine tooling worth keeping — but tooling can carry
    # model prompts, API assumptions and proprietary process, and publishing it is a separate
    # decision from publishing the application. It reached the tracked tree via a `git add -A`
    # during a merge; the export is what caught it.
    "tools/",
    # The login-ornament tracer. Build-time tooling, and it hardcodes the source artwork's
    # filenames — the provenance that assets-manifest.json below is withheld to protect. Its
    # OUTPUT (frontend/src/ui/royal/ornamentPaths.ts) stays public; a reader could not run this
    # without the private renders in any case.
    "frontend/scripts/trace_login_ornaments.py",
    # The store-listing copy guard. It READS docs/store-listing.md, which is withheld with the rest
    # of docs/ — so publishing the test would ship a suite that fails on a file the public tree does
    # not contain, and would name a withheld path in public code. Same shape as the tracer above:
    # the withheld thing is the INPUT, and the file that reads it has to travel with it.
    "frontend/src/i18n/storeListing.copy.test.ts",
    # The full asset manifest is a directory map of proprietary work — every private asset's path,
    # size, provenance and licence. The public tree gets PUBLIC_MANIFEST_NAME instead, which carries
    # the withheld digests and nothing else, so third-party verification survives without publishing
    # an inventory of the artwork.
    "assets-manifest.json",
    # The staging blueprint describes internal deployment topology — resource names, database
    # names and the credential group wiring — for an environment that existed only to rehearse
    # the content split, and that has since been torn down. It carries no secrets (both sensitive
    # keys are `sync: false`), but it is infrastructure configuration for a private environment
    # and a public contributor can do nothing with it. render.yaml IS exported: that one is the
    # real deploy contract and is worth reading.
    "render.staging.yaml",
    # The sync workflow itself is private infrastructure. The public repo cannot sync itself, the
    # workflow references a secret that does not exist there, and GitHub refuses to let a PAT
    # create or update a workflow file without the workflow scope — so exporting it also broke the
    # push. ci.yml IS exported: it is the CI a contributor should see and run.
    ".github/workflows/sync-public.yml",
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

# assets-manifest.json stores truncated digests; every comparison must truncate the same way.
DIGEST_PREFIX_LEN = 16


# The public tree carries a SANITIZED verification manifest instead of assets-manifest.json.
#
# The full manifest is a directory map of proprietary work: every private asset's path, byte size,
# provenance and licence. A contributor needs none of that to check an exported tree — the only
# question they can usefully ask is "does any file here hash to something that was withheld?", and
# that needs an opaque set of hashes and nothing else.
#
# What is published is `private - keep`, already resolved: a blob that is both withheld and
# legitimately present (an icon byte-identical to a deleted duplicate) is excluded here rather
# than left for the reader to reconcile. No paths, no filenames, no dispositions, no sizes.
PUBLIC_MANIFEST_NAME = "public-verification-manifest.json"


def public_verification_manifest(
    private_sha: dict[str, str], keep_sha: set[str]
) -> dict[str, object]:
    """The hashes-only manifest published in place of assets-manifest.json."""
    banned = sorted(set(private_sha.values()) - keep_sha)
    return {
        "$comment": (
            "Truncated SHA-256 digests of image blobs that are withheld from this repository. "
            "Used by scripts/verify_public_tree.py to prove no withheld artwork is present. "
            "Digests only, by design: the full asset manifest maps proprietary paths and stays "
            "private."
        ),
        "version": 1,
        "digest": "sha256",
        "truncated_to": DIGEST_PREFIX_LEN,
        "withheld_count": len(banned),
        "withheld_sha256": banned,
    }


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


def treatment(rel: str, private: set[str]) -> str:
    """What this export WILL do with a path — computed, not looked up in the registry.

    This is the exporter's own answer, derived from the same three mechanisms that do the actual
    work: the rename map, the exclusion/doc rules, and the asset manifest. `audit()` then compares
    it against what export-classification.toml declared. Deriving it here rather than reading the
    registry is the entire value of the check: two independent answers that must agree, instead of
    one answer read back to itself.
    """
    if rel in RENAMES:
        # Published under a different name — still published.
        return "public"
    if rel.startswith(EXCLUDE) or is_withheld_doc(rel):
        return "withheld"
    if is_private(rel, private):
        return "placeholder" if pathlib.Path(rel).suffix.lower() in IMAGE_SUFFIXES else "withheld"
    return "public"


def is_withheld_doc(path: str) -> bool:
    """True for anything under docs/ that is not on the allowlist."""
    return path.startswith("docs/") and path not in DOCS_ALLOW


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
        [inset, inset, w - inset - 1, h - inset - 1],
        outline=line,
        width=max(1, min(w, h) // 80),
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
            if hashlib.sha256(p.read_bytes()).hexdigest()[:DIGEST_PREFIX_LEN] in banned:
                problems.append(f"PRIVATE ART: {p.relative_to(out)}")

    # 2. No secrets, and no local filesystem paths (which leak a username and break for everyone).
    for p in out.rglob("*"):
        if not p.is_file() or p.suffix.lower() in IMAGE_SUFFIXES | {
            ".ttf",
            ".otf",
            ".woff2",
        }:
            continue
        rel = p.relative_to(out).as_posix()
        try:
            data = p.read_bytes()
        except OSError:
            continue
        for name, rx in SECRET_PATTERNS.items():
            if rx.search(data) and (name, rel) not in SECRET_ALLOW:
                problems.append(f"SECRET [{name}]: {rel}")

    # 3. Nothing under an excluded prefix survived, and no un-allowlisted doc did either. Exclusions
    #    remove internal documents — a runbook naming production service ids, an agent-directed
    #    implementation plan, or a generated report quoting the production question corpus.
    for p in out.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(out).as_posix()
        if rel.startswith(EXCLUDE):
            problems.append(f"EXCLUDED PATH PRESENT: {rel}")
        elif is_withheld_doc(rel):
            problems.append(f"UNPUBLISHED DOC PRESENT: {rel}")

    # 3b. The sanitized manifest replaced the real one, and replaced it with something USEFUL.
    #     An export that dropped assets-manifest.json and wrote nothing in its place would leave a
    #     public verifier with an empty ban list — passing every tree, including a leaking one.
    #     Emptiness is the failure mode worth naming, because it looks exactly like success.
    #
    #     The expected set is recomputed HERE, from the manifest data, rather than by calling
    #     public_verification_manifest(). Asking the generator what it should have generated is not
    #     a check: mutation testing truncated that function to five digests and this passed, because
    #     the file agreed with the mutated generator that produced it.
    expected_banned = sorted(set(private_sha.values()) - keep_sha)
    pub = out / PUBLIC_MANIFEST_NAME
    if not pub.is_file():
        problems.append(f"SANITIZED MANIFEST MISSING: {PUBLIC_MANIFEST_NAME}")
    else:
        got = json.loads(pub.read_text(encoding="utf-8"))
        banned_listed = got.get("withheld_sha256")
        if banned_listed != expected_banned:
            problems.append(
                f"SANITIZED MANIFEST DOES NOT MATCH THE ASSET MANIFEST: "
                f"{PUBLIC_MANIFEST_NAME} lists {len(banned_listed or [])} digests, "
                f"expected {len(expected_banned)}"
            )
        elif not banned_listed:
            problems.append(f"SANITIZED MANIFEST IS EMPTY: {PUBLIC_MANIFEST_NAME}")
        if got.get("withheld_count") != len(banned_listed or []):
            problems.append(f"SANITIZED MANIFEST COUNT DISAGREES WITH ITS OWN LIST: {pub.name}")
        # It must carry digests and NOTHING that could reconstruct a path.
        leaked = [
            k
            for k in got
            if k
            not in {
                "$comment",
                "version",
                "digest",
                "truncated_to",
                "withheld_count",
                "withheld_sha256",
            }
        ]
        if leaked:
            problems.append(f"SANITIZED MANIFEST CARRIES EXTRA FIELDS: {', '.join(sorted(leaked))}")

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

    # Classification gate. Runs FIRST and writes nothing: an unclassified path means nobody decided
    # whether this file may be published, and the answer to that is never "publish and find out".
    #
    # The paths come from the COMMIT being exported, not from the working tree, so the gate judges
    # the same revision the export is built from.
    listed = sh("git", "ls-tree", "-r", "--name-only", commit).splitlines()
    tracked = [p for p in listed if p]
    computed = {rel: treatment(rel, private) for rel in tracked}
    unclassified, mismatched = export_classification.audit(computed)

    if unclassified or mismatched:
        print(
            "EXPORT REFUSED — the classification registry does not cover this tree:",
            file=sys.stderr,
        )
        for rel in unclassified[:20]:
            print(f"  UNCLASSIFIED: {rel}", file=sys.stderr)
        if len(unclassified) > 20:
            print(f"  ... and {len(unclassified) - 20} more", file=sys.stderr)
        for rel, declared, got in mismatched[:20]:
            print(f"  MISMATCH: {rel} — declared {declared}, export would {got}", file=sys.stderr)
        print(
            "\nAdd a rule to export-classification.toml for each path above. A file with no "
            "rule is not published: decide deliberately, in review, rather than by omission.",
            file=sys.stderr,
        )
        return 1

    # The inventory closes the gap subtree rules cannot: `backend/` is public, so a new file inside
    # it inherits that without anyone deciding. Drift here means a path appeared, vanished, or
    # changed classification since the record was last written — each of which is a decision
    # somebody should make on purpose.
    drift = export_classification.inventory_drift(computed)
    if drift:
        print("EXPORT REFUSED — the classification inventory is out of date:", file=sys.stderr)
        for line in drift[:20]:
            print(f"  {line}", file=sys.stderr)
        if len(drift) > 20:
            print(f"  ... and {len(drift) - 20} more", file=sys.stderr)
        print(
            "\nReview each line, then run:\n"
            "    python scripts/export_classification.py --write-inventory\n"
            "A new file recorded as `public` is a publication decision — make it deliberately.",
            file=sys.stderr,
        )
        return 1

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
            if rel.startswith(EXCLUDE) or is_withheld_doc(rel):
                p.unlink()
                continue
            if is_private(rel, private):
                if p.suffix.lower() in IMAGE_SUFFIXES:
                    make_placeholder(p, p, rel)
                    placeholders += 1
                else:
                    p.unlink()
                removed += 1

        # Written AFTER the exclusion pass removed assets-manifest.json, and derived from the
        # manifest on every run rather than committed — a generated artifact cannot go stale
        # against its source the way a checked-in copy silently would.
        (staging / PUBLIC_MANIFEST_NAME).write_text(
            json.dumps(public_verification_manifest(private_sha, keep_sha), indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )

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
