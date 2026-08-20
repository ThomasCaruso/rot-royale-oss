"""Fetch the private content package at an exact commit into ROT_CONTENT_DIR.

Run from `buildCommand`, NEVER from `preDeployCommand`: Render's pre-deploy runs on a separate
instance and its filesystem changes do not reach the deployed service, so a package fetched there
would validate and then vanish before the app started. Fetching during the build also puts the
content INSIDE the build artifact, which is what makes a Render rollback restore the content
revision that shipped with that deploy rather than re-fetching whatever CONTENT_COMMIT says today.

    GITHUB_CONTENT_TOKEN   fine-grained PAT, Contents: read-only, this repo only
    CONTENT_REPO           owner/repo
    CONTENT_COMMIT         full 40-character SHA — never a branch or tag
    ROT_CONTENT_DIR        where the package must end up

All four are read from the environment, never from argv: an argument is visible in `ps` and in
whatever the CI records as the command it ran, and one of these is a credential.

Why a full SHA and not `main`. A branch is a moving target, so two services building minutes apart
can package different content, and a rollback to a previous deploy could not say which content it
was rolling back to. Pinning the SHA makes a content release an explicit, immutable, revertible
decision — the same property application code already has.

Why the archive endpoint and not `git clone`. A clone would carry a .git directory into the
deployed artifact for no reason, and the obvious form of it —
`git clone https://TOKEN@github.com/...` — puts the credential in a URL, where it reaches process
listings, shell history and any log that echoes the command. Every request here carries the token
in an Authorization header instead, and this program prints exactly two lines.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
import tarfile
import tempfile
from collections.abc import Mapping
from pathlib import Path, PurePosixPath

import httpx

GITHUB_API = "https://api.github.com"
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_REPO_RE = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")
_REVISION_FILE = ".content-revision"
_TIMEOUT = httpx.Timeout(30.0, read=120.0)  # the archive is a few MB; the API calls are small


class ContentFetchError(Exception):
    """Retrieval failed. The caller exits non-zero, which fails the build — always the right
    outcome, because the alternative is booting against absent or wrong content."""


def _redact(text: str, token: str) -> str:
    """Remove the credential from anything about to be printed.

    Not decoration: httpx puts the request URL into its exception messages, and a future edit that
    accidentally builds an authenticated URL would otherwise leak it through a traceback rather
    than through code anyone reviewed. Redaction at the single output boundary survives that.
    """
    return text.replace(token, "***") if token else text


def _require(env: Mapping[str, str], key: str) -> str:
    value = (env.get(key) or "").strip()
    if not value:
        raise ContentFetchError(f"{key} is not set")
    return value


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "rot-royale-content-fetch",
    }


def _verify_commit(client: httpx.Client, repo: str, sha: str, token: str) -> None:
    """Confirm the exact commit exists in the repo before downloading anything.

    Separate from the download so the failure is legible: a 404 here means the SHA or the repo is
    wrong, a 401/403 means the token is. Both are build-stopping, but they are fixed differently,
    and a deploy that fails at 3am should say which.
    """
    r = client.get(f"{GITHUB_API}/repos/{repo}/commits/{sha}", headers=_headers(token))
    if r.status_code in (401, 403):
        raise ContentFetchError(
            f"GitHub rejected the token for {repo} (HTTP {r.status_code}). Check that the "
            f"fine-grained PAT grants Contents: read on this repository and has not expired."
        )
    if r.status_code == 404:
        raise ContentFetchError(
            f"commit {sha} not found in {repo} (HTTP 404) — wrong SHA, wrong repo, or the token "
            f"cannot see this repository"
        )
    if r.status_code != 200:
        raise ContentFetchError(f"GitHub returned HTTP {r.status_code} verifying commit {sha}")
    resolved = (r.json() or {}).get("sha")
    if resolved != sha:
        # The commits endpoint resolves refs, so a non-SHA input can succeed and return something
        # else. The SHA format check already blocks that, and this makes it impossible.
        raise ContentFetchError(f"requested {sha} but GitHub resolved it to {resolved}")


def _download_tarball(client: httpx.Client, repo: str, sha: str, token: str, dest: Path) -> None:
    url = f"{GITHUB_API}/repos/{repo}/tarball/{sha}"
    with client.stream("GET", url, headers=_headers(token), follow_redirects=True) as r:
        if r.status_code != 200:
            raise ContentFetchError(f"GitHub returned HTTP {r.status_code} downloading {sha}")
        with dest.open("wb") as fh:
            for chunk in r.iter_bytes():
                fh.write(chunk)
    if dest.stat().st_size == 0:
        raise ContentFetchError("downloaded archive is empty")


def _safe_relative_path(name: str, prefix: str) -> PurePosixPath:
    """The archive-relative path a member may be written to, or raise.

    An ALLOWLIST, and members are written by hand rather than through `tar.extract*`: the extractor
    never sees an attacker-controlled path at all, so traversal is not defended against, it is
    unreachable. A GitHub tarball from our own private repo is not a hostile input today, but this
    program's whole job is to take remote bytes and turn them into files the server will serve.
    """
    if "\\" in name or "\x00" in name:
        raise ContentFetchError(f"archive member has an illegal name: {name!r}")
    p = PurePosixPath(name)
    if p.is_absolute() or (len(name) > 1 and name[1] == ":"):
        raise ContentFetchError(f"archive member is an absolute path: {name!r}")
    if ".." in p.parts:
        raise ContentFetchError(f"archive member escapes the archive root: {name!r}")
    if not p.parts or p.parts[0] != prefix:
        raise ContentFetchError(f"archive member is outside the archive's root directory: {name!r}")
    return PurePosixPath(*p.parts[1:])


def _archive_prefix(tar: tarfile.TarFile) -> str:
    """GitHub wraps the tree in one `owner-repo-sha/` directory; every member must share it."""
    roots = {PurePosixPath(m.name).parts[0] for m in tar.getmembers() if m.name.strip("/")}
    if len(roots) != 1:
        raise ContentFetchError(f"archive does not have a single root directory: {sorted(roots)}")
    return roots.pop()


def _extract(archive: Path, staging: Path) -> None:
    with tarfile.open(archive, "r:*") as tar:
        prefix = _archive_prefix(tar)
        for member in tar.getmembers():
            if member.issym() or member.islnk():
                # Refused outright rather than resolved. A link is the one member type whose
                # meaning depends on where it is unpacked, and content is only ever plain files.
                raise ContentFetchError(
                    f"archive contains a link, which is not allowed: {member.name}"
                )
            if not (member.isfile() or member.isdir()):
                raise ContentFetchError(f"archive contains a special file: {member.name}")

            rel = _safe_relative_path(member.name, prefix)
            target = staging / rel
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            src = tar.extractfile(member)
            if src is None:
                raise ContentFetchError(f"archive member could not be read: {member.name}")
            with src, target.open("wb") as fh:
                shutil.copyfileobj(src, fh)
            # Mode is deliberately not carried over from the archive: content is data, and nothing
            # in a content package has any business being executable.


def _install(staging: Path, target: Path) -> None:
    """Swap the validated package into place, leaving the old one intact if anything fails.

    ROT_CONTENT_DIR is only ever assigned a directory that has already passed validation, so a
    half-extracted or invalid package can never become the served content — the failure mode is a
    failed build with the previous content still in place, which is the recoverable one.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    previous = target.with_name(target.name + ".previous")
    if previous.exists():
        shutil.rmtree(previous, ignore_errors=True)

    had_previous = target.exists()
    if had_previous:
        os.rename(target, previous)
    try:
        os.rename(staging, target)
    except OSError:
        if had_previous:
            os.rename(previous, target)  # put the working content back before failing
        raise
    if had_previous:
        shutil.rmtree(previous, ignore_errors=True)


def fetch(
    env: Mapping[str, str] | None = None, *, transport: httpx.BaseTransport | None = None
) -> str:
    """Retrieve, verify, validate and install the package. Returns the installed revision."""
    env = os.environ if env is None else env
    token = _require(env, "GITHUB_CONTENT_TOKEN")
    repo = _require(env, "CONTENT_REPO")
    sha = _require(env, "CONTENT_COMMIT")
    target = Path(_require(env, "ROT_CONTENT_DIR"))

    if not _REPO_RE.match(repo):
        raise ContentFetchError(f"CONTENT_REPO must be owner/repo, got {repo!r}")
    if not _SHA_RE.match(sha):
        raise ContentFetchError(
            f"CONTENT_COMMIT must be a full 40-character commit SHA, got {sha!r}. A branch or tag "
            f"is not acceptable: it would let two services in one deploy package different content."
        )

    from content.package import validate as validate_package

    # Stage BESIDE the target, never in the system temp directory. The install is an os.rename, and
    # rename cannot cross filesystems: on Render /tmp is a different mount from the project
    # directory, so staging there failed with "Invalid cross-device link" after a successful
    # download, extract and validate. Locally the two are the same disk, which is why this only ever
    # appeared on a real deploy.
    #
    # Copying across devices instead would have been the wrong fix: rename is what makes the swap
    # ATOMIC, so ROT_CONTENT_DIR is never a half-written package. Keeping the staging directory on
    # the target's own filesystem preserves that.
    target.parent.mkdir(parents=True, exist_ok=True)

    with httpx.Client(transport=transport, timeout=_TIMEOUT) as client:
        _verify_commit(client, repo, sha, token)
        with tempfile.TemporaryDirectory(
            prefix=f".{target.name}-incoming-", dir=target.parent
        ) as tmp:
            tmpdir = Path(tmp)
            archive = tmpdir / "content.tar.gz"
            _download_tarball(client, repo, sha, token, archive)

            staging = tmpdir / "package"
            staging.mkdir()
            _extract(archive, staging)

            problems = validate_package(staging)
            if problems:
                raise ContentFetchError(
                    "the downloaded package is not usable:\n  "
                    + "\n  ".join(problems[:10])
                    + (f"\n  ...and {len(problems) - 10} more" if len(problems) > 10 else "")
                )

            (staging / _REVISION_FILE).write_text(sha + "\n", encoding="utf-8")
            _install(staging, target)
    return sha


def main() -> int:
    token = os.environ.get("GITHUB_CONTENT_TOKEN", "")
    try:
        revision = fetch()
    except ContentFetchError as exc:
        print(f"content fetch FAILED: {_redact(str(exc), token)}", file=sys.stderr)
        return 1
    except Exception as exc:  # network, tar, filesystem — all fail the build, none may leak
        print(
            f"content fetch FAILED: {type(exc).__name__}: {_redact(str(exc), token)}",
            file=sys.stderr,
        )
        return 1
    print(f"content revision {revision}")
    print("validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
