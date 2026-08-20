"""Retrieval of the private content package (Phase 2R).

This program turns remote bytes into the files the server will serve, and it holds a credential
while doing it. Both halves are tested here, against a MOCKED GitHub: the tests build their own tar
archives, so a hostile archive can actually be exercised rather than described. One real retrieval
against the private repo is a separate manual step — the point of these is that they run anywhere,
including in a public CI with no token.

The mock is at the TRANSPORT layer rather than around the module's own functions, so the assertions
about where the token appears are about real requests: real URL, real headers.
"""

from __future__ import annotations

import io
import json
import shutil
import tarfile
import time
from pathlib import Path

import httpx
import pytest
from app.core.config import SAMPLE_CONTENT_DIR
from scripts.fetch_private_content import ContentFetchError, fetch

SHA = "6077da0f8ea90e155c89a93859644aaf081c5cbe"
OTHER_SHA = "1111111111111111111111111111111111111111"
TOKEN = "github_pat_EXAMPLE_NOT_A_REAL_TOKEN_00000000"
REPO = "ThomasCaruso/rot-royale-content"
PREFIX = "ThomasCaruso-rot-royale-content-6077da0"


def _env(tmp_path: Path, **overrides) -> dict[str, str]:
    env = {
        "GITHUB_CONTENT_TOKEN": TOKEN,
        "CONTENT_REPO": REPO,
        "CONTENT_COMMIT": SHA,
        "ROT_CONTENT_DIR": str(tmp_path / "content"),
    }
    env.update({k: v for k, v in overrides.items() if v is not None})
    for k, v in overrides.items():
        if v is None:
            env.pop(k, None)
    return env


def _tar_from_dir(source: Path, prefix: str = PREFIX) -> bytes:
    """A GitHub-shaped tarball: everything under one `owner-repo-sha/` root."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(source, arcname=prefix, recursive=True)
    return buf.getvalue()


def _tar_from_members(members: list[tuple[tarfile.TarInfo, bytes | None]]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for info, payload in members:
            info.mtime = int(time.time())
            tar.addfile(info, io.BytesIO(payload) if payload is not None else None)
    return buf.getvalue()


def _valid_package_tar() -> bytes:
    """The committed sample corpus IS a valid package, so it stands in for the private one."""
    return _tar_from_dir(SAMPLE_CONTENT_DIR)


class Recorder:
    """Captures every request so the tests can assert on URLs and headers."""

    def __init__(
        self,
        tarball: bytes | None = None,
        commit_status: int = 200,
        tarball_status: int = 200,
        resolved_sha: str | None = None,
    ):
        self.requests: list[httpx.Request] = []
        self.tarball = tarball
        self.commit_status = commit_status
        self.tarball_status = tarball_status
        self.resolved_sha = resolved_sha

    def transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            path = request.url.path
            if "/commits/" in path:
                if self.commit_status != 200:
                    return httpx.Response(self.commit_status, json={"message": "nope"})
                sha = self.resolved_sha or path.rsplit("/", 1)[-1]
                return httpx.Response(200, json={"sha": sha})
            if "/tarball/" in path:
                if self.tarball_status != 200:
                    return httpx.Response(self.tarball_status, json={"message": "nope"})
                return httpx.Response(200, content=self.tarball or b"")
            return httpx.Response(404, json={"message": "unexpected"})

        return httpx.MockTransport(handler)


# ---------------- the happy path ----------------


def test_valid_token_and_exact_sha_produce_the_package(tmp_path: Path):
    rec = Recorder(_valid_package_tar())
    env = _env(tmp_path)
    assert fetch(env, transport=rec.transport()) == SHA

    root = Path(env["ROT_CONTENT_DIR"])
    assert (root / "bank").is_dir()
    assert (root / "campaign" / "levels.json").is_file()
    assert (root / "change" / "assets").is_dir()
    # The package is installed at the ROOT of ROT_CONTENT_DIR — the archive's own
    # `owner-repo-sha/` wrapper must be stripped, or every content path gains a segment and
    # nothing resolves.
    assert not list(root.glob("*-rot-royale-content-*"))


def test_revision_file_records_the_requested_sha(tmp_path: Path):
    rec = Recorder(_valid_package_tar())
    env = _env(tmp_path)
    fetch(env, transport=rec.transport())
    revision = (Path(env["ROT_CONTENT_DIR"]) / ".content-revision").read_text(encoding="utf-8")
    assert revision.strip() == SHA


def test_the_package_is_validated_before_it_is_installed(tmp_path: Path):
    """The retrieved tree must satisfy the same rules the served package does."""
    from content.package import validate

    rec = Recorder(_valid_package_tar())
    env = _env(tmp_path)
    fetch(env, transport=rec.transport())
    assert validate(env["ROT_CONTENT_DIR"]) == []


# ---------------- credential handling ----------------


def test_the_token_travels_in_a_header_and_never_in_a_url(tmp_path: Path):
    rec = Recorder(_valid_package_tar())
    fetch(_env(tmp_path), transport=rec.transport())

    assert rec.requests, "no requests were made"
    for r in rec.requests:
        assert r.headers.get("Authorization") == f"Bearer {TOKEN}"
        assert TOKEN not in str(r.url)
        assert TOKEN not in r.url.query.decode()
        assert "@" not in r.url.netloc.decode()  # never https://token@github.com/...


def test_failure_output_carries_no_credential(tmp_path: Path, capsys, monkeypatch):
    """A traceback or an httpx error can quote a URL; the output boundary redacts regardless."""
    from scripts import fetch_private_content as mod

    monkeypatch.setenv("GITHUB_CONTENT_TOKEN", TOKEN)
    monkeypatch.setenv("CONTENT_REPO", REPO)
    monkeypatch.setenv("CONTENT_COMMIT", SHA)
    monkeypatch.setenv("ROT_CONTENT_DIR", str(tmp_path / "content"))

    def boom(*a, **k):
        raise RuntimeError(f"connection to https://{TOKEN}@api.github.com failed")

    monkeypatch.setattr(mod, "_verify_commit", boom)
    assert mod.main() == 1
    out = capsys.readouterr()
    assert TOKEN not in out.out and TOKEN not in out.err
    assert "***" in out.err


def test_success_output_is_only_the_two_expected_lines(tmp_path: Path, capsys, monkeypatch):
    from scripts import fetch_private_content as mod

    rec = Recorder(_valid_package_tar())
    monkeypatch.setenv("GITHUB_CONTENT_TOKEN", TOKEN)
    monkeypatch.setenv("CONTENT_REPO", REPO)
    monkeypatch.setenv("CONTENT_COMMIT", SHA)
    monkeypatch.setenv("ROT_CONTENT_DIR", str(tmp_path / "content"))
    real_client = httpx.Client  # captured BEFORE patching, or the factory calls itself

    def client_factory(**kw):
        kw["transport"] = rec.transport()  # main() passes transport=None; override, don't duplicate
        return real_client(**kw)

    monkeypatch.setattr(mod.httpx, "Client", client_factory)

    assert mod.main() == 0
    out = capsys.readouterr()
    assert out.out.splitlines() == [f"content revision {SHA}", "validation passed"]
    assert TOKEN not in out.out


# ---------------- input contract ----------------


@pytest.mark.parametrize(
    "missing", ["GITHUB_CONTENT_TOKEN", "CONTENT_REPO", "CONTENT_COMMIT", "ROT_CONTENT_DIR"]
)
def test_every_required_variable_is_required(tmp_path: Path, missing):
    rec = Recorder(_valid_package_tar())
    with pytest.raises(ContentFetchError, match=missing):
        fetch(_env(tmp_path, **{missing: None}), transport=rec.transport())


@pytest.mark.parametrize(
    "bad_ref",
    [
        "main",
        "v1.0.0",
        "HEAD",
        "6077da0",  # abbreviated
        SHA.upper(),  # GitHub SHAs are lowercase hex
        SHA + "0",
        SHA[:-1],
        "../../etc/passwd",
        "6077da0f8ea90e155c89a93859644aaf081c5cbz",  # not hex
    ],
)
def test_anything_that_is_not_a_full_sha_is_refused(tmp_path: Path, bad_ref):
    """A branch would let two services in one deploy package different content, and would make a
    rollback unable to name the content it was rolling back to."""
    rec = Recorder(_valid_package_tar())
    with pytest.raises(ContentFetchError, match="40-character"):
        fetch(_env(tmp_path, CONTENT_COMMIT=bad_ref), transport=rec.transport())
    assert not rec.requests, "a malformed ref must be rejected before any network call"


@pytest.mark.parametrize("bad_repo", ["notaslug", "a/b/c", "owner/repo;rm -rf /", "../../x/y", ""])
def test_repo_must_be_a_plain_owner_slash_repo(tmp_path: Path, bad_repo):
    rec = Recorder(_valid_package_tar())
    with pytest.raises(ContentFetchError):
        fetch(_env(tmp_path, CONTENT_REPO=bad_repo), transport=rec.transport())


# ---------------- remote failures ----------------


@pytest.mark.parametrize("status", [401, 403])
def test_invalid_token_is_a_hard_failure(tmp_path: Path, status):
    rec = Recorder(_valid_package_tar(), commit_status=status)
    with pytest.raises(ContentFetchError, match="token"):
        fetch(_env(tmp_path), transport=rec.transport())
    assert not Path(_env(tmp_path)["ROT_CONTENT_DIR"]).exists()


def test_unknown_sha_is_a_hard_failure(tmp_path: Path):
    rec = Recorder(_valid_package_tar(), commit_status=404)
    with pytest.raises(ContentFetchError, match="not found"):
        fetch(_env(tmp_path, CONTENT_COMMIT=OTHER_SHA), transport=rec.transport())


def test_a_sha_that_resolves_to_something_else_is_refused(tmp_path: Path):
    rec = Recorder(_valid_package_tar(), resolved_sha=OTHER_SHA)
    with pytest.raises(ContentFetchError, match="resolved it to"):
        fetch(_env(tmp_path), transport=rec.transport())


def test_a_failed_download_is_a_hard_failure(tmp_path: Path):
    rec = Recorder(_valid_package_tar(), tarball_status=500)
    with pytest.raises(ContentFetchError, match="HTTP 500"):
        fetch(_env(tmp_path), transport=rec.transport())


def test_an_empty_archive_is_a_hard_failure(tmp_path: Path):
    rec = Recorder(b"")
    with pytest.raises(ContentFetchError):
        fetch(_env(tmp_path), transport=rec.transport())


# ---------------- hostile archives ----------------


def _info(name: str, *, typ=tarfile.REGTYPE, link: str = "", size: int = 0) -> tarfile.TarInfo:
    i = tarfile.TarInfo(name)
    i.type = typ
    i.linkname = link
    i.size = size
    return i


def test_a_symlink_member_is_refused(tmp_path: Path):
    tar = _tar_from_members(
        [
            (_info(f"{PREFIX}/", typ=tarfile.DIRTYPE), None),
            (_info(f"{PREFIX}/escape", typ=tarfile.SYMTYPE, link="/etc/passwd"), None),
        ]
    )
    rec = Recorder(tar)
    with pytest.raises(ContentFetchError, match="link"):
        fetch(_env(tmp_path), transport=rec.transport())


def test_a_hardlink_member_is_refused(tmp_path: Path):
    tar = _tar_from_members(
        [
            (_info(f"{PREFIX}/", typ=tarfile.DIRTYPE), None),
            (_info(f"{PREFIX}/a.json", size=2), b"{}"),
            (_info(f"{PREFIX}/b.json", typ=tarfile.LNKTYPE, link=f"{PREFIX}/a.json"), None),
        ]
    )
    rec = Recorder(tar)
    with pytest.raises(ContentFetchError, match="link"):
        fetch(_env(tmp_path), transport=rec.transport())


@pytest.mark.parametrize(
    "name",
    [
        f"{PREFIX}/../../../../etc/passwd",
        f"{PREFIX}/../outside.json",
        "/etc/passwd",
        "../escape.json",
        f"{PREFIX}/sub/../../escape.json",
    ],
)
def test_a_traversing_member_is_refused(tmp_path: Path, name):
    tar = _tar_from_members(
        [
            (_info(f"{PREFIX}/", typ=tarfile.DIRTYPE), None),
            (_info(name, size=2), b"{}"),
        ]
    )
    rec = Recorder(tar)
    with pytest.raises(ContentFetchError):
        fetch(_env(tmp_path), transport=rec.transport())
    assert not (tmp_path / "outside.json").exists()
    assert not (tmp_path / "escape.json").exists()


def test_a_special_file_member_is_refused(tmp_path: Path):
    tar = _tar_from_members(
        [
            (_info(f"{PREFIX}/", typ=tarfile.DIRTYPE), None),
            (_info(f"{PREFIX}/dev", typ=tarfile.FIFOTYPE), None),
        ]
    )
    rec = Recorder(tar)
    with pytest.raises(ContentFetchError, match="special file"):
        fetch(_env(tmp_path), transport=rec.transport())


def test_an_archive_with_several_roots_is_refused(tmp_path: Path):
    tar = _tar_from_members(
        [
            (_info(f"{PREFIX}/a.json", size=2), b"{}"),
            (_info("somewhere-else/b.json", size=2), b"{}"),
        ]
    )
    rec = Recorder(tar)
    with pytest.raises(ContentFetchError, match="single root"):
        fetch(_env(tmp_path), transport=rec.transport())


# ---------------- installation ----------------


def test_an_invalid_package_never_becomes_the_content_dir(tmp_path: Path):
    """The exact accident this prevents: a retrieval that 'succeeds' and leaves the server pointed
    at an incomplete corpus."""
    incomplete = tmp_path / "incomplete"
    shutil.copytree(SAMPLE_CONTENT_DIR, incomplete)
    (incomplete / "campaign" / "levels.json").unlink()

    rec = Recorder(_tar_from_dir(incomplete))
    env = _env(tmp_path)
    with pytest.raises(ContentFetchError, match="not usable"):
        fetch(env, transport=rec.transport())
    assert not Path(env["ROT_CONTENT_DIR"]).exists()


def test_a_partial_extraction_never_becomes_the_content_dir(tmp_path: Path):
    """A truncated archive fails mid-extract; nothing may be left behind at the target."""
    good = _valid_package_tar()
    rec = Recorder(good[: len(good) // 2])
    env = _env(tmp_path)
    # A truncated gzip stream surfaces as EOFError from tarfile rather than as our own error —
    # caught by main()'s catch-all, which is why that catch-all exists. What matters is not which
    # exception it is, but that nothing was left at the target.
    with pytest.raises((ContentFetchError, tarfile.TarError, EOFError, OSError)):
        fetch(env, transport=rec.transport())
    assert not Path(env["ROT_CONTENT_DIR"]).exists()


def test_a_stale_content_dir_is_replaced(tmp_path: Path):
    target = tmp_path / "content"
    target.mkdir()
    (target / "STALE.txt").write_text("previous deploy", encoding="utf-8")
    (target / ".content-revision").write_text(OTHER_SHA + "\n", encoding="utf-8")

    rec = Recorder(_valid_package_tar())
    fetch(_env(tmp_path), transport=rec.transport())

    assert not (target / "STALE.txt").exists(), "the old package was merged into, not replaced"
    assert (target / ".content-revision").read_text(encoding="utf-8").strip() == SHA
    assert (target / "bank").is_dir()


def test_a_failed_fetch_leaves_existing_content_in_place(tmp_path: Path):
    """A build that cannot retrieve new content must not destroy the content already there —
    otherwise one bad CONTENT_COMMIT takes the service down instead of failing the deploy."""
    target = tmp_path / "content"
    shutil.copytree(SAMPLE_CONTENT_DIR, target)
    before = sorted(p.name for p in target.iterdir())

    rec = Recorder(_valid_package_tar(), commit_status=404)
    with pytest.raises(ContentFetchError):
        fetch(_env(tmp_path), transport=rec.transport())

    assert sorted(p.name for p in target.iterdir()) == before
    assert (target / "campaign" / "levels.json").is_file()


def test_no_leftover_staging_directory(tmp_path: Path):
    rec = Recorder(_valid_package_tar())
    env = _env(tmp_path)
    fetch(env, transport=rec.transport())
    parent = Path(env["ROT_CONTENT_DIR"]).parent
    assert not [p for p in parent.iterdir() if p.name.endswith(".previous")]


def test_the_installed_package_matches_the_archive_byte_for_byte(tmp_path: Path):
    """Retrieval must not transform content. Anything that rewrites a byte here would break the
    campaign manifest's SHA equivalence with production."""
    import hashlib

    rec = Recorder(_valid_package_tar())
    env = _env(tmp_path)
    fetch(env, transport=rec.transport())
    root = Path(env["ROT_CONTENT_DIR"])

    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()  # noqa: E731
    compared = 0
    for src in SAMPLE_CONTENT_DIR.rglob("*"):
        if not src.is_file():
            continue
        got = root / src.relative_to(SAMPLE_CONTENT_DIR)
        assert got.is_file(), got
        assert sha(got) == sha(src), got
        compared += 1
    assert compared > 0

    # ...and nothing extra beyond the one file retrieval itself adds.
    installed = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}
    expected = {
        p.relative_to(SAMPLE_CONTENT_DIR).as_posix()
        for p in SAMPLE_CONTENT_DIR.rglob("*")
        if p.is_file()
    } | {".content-revision"}
    assert installed == expected


def test_json_survives_the_round_trip(tmp_path: Path):
    rec = Recorder(_valid_package_tar())
    env = _env(tmp_path)
    fetch(env, transport=rec.transport())
    root = Path(env["ROT_CONTENT_DIR"])
    for rel in ("campaign/config.json", "campaign/levels.json", "change/manifest.json"):
        assert json.loads((root / rel).read_text(encoding="utf-8"))


# ---------------- the build-time / runtime boundary ----------------


def test_validating_a_package_needs_no_application_runtime():
    """Content validation must not import app.core.config, because importing it CONSTRUCTS
    Settings — and in production Settings refuses to construct until ROT_CONTENT_DIR exists.

    The fetcher's entire job is to create that directory, so any validator that boots the
    application deadlocks the build. This is not hypothetical: it failed the first real staging
    deploy, with `ROT_CONTENT_DIR does not exist or is not a directory while APP_ENV='production'`
    raised from inside the content fetch. It passed every local run because those had no
    APP_ENV=production set.

    Run in a subprocess: this process has long since imported app.core.config through some other
    test, so asking about sys.modules in-process would always pass and prove nothing.
    """
    import subprocess
    import sys

    probe = (
        "import sys; import content.package; import content.ingest; "
        "import content.estimate_ingest; import content.change_manifest; "
        "print('app.core.config' in sys.modules)"
    )
    out = subprocess.run(
        [sys.executable, "-c", probe],
        capture_output=True,
        text=True,
        cwd=Path(__file__).resolve().parents[1],
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "False", (
        "a content validator imports app.core.config at module scope, which constructs Settings "
        "and deadlocks the production content fetch"
    )


def test_the_fetcher_runs_under_production_env_with_no_content_dir(tmp_path: Path, monkeypatch):
    """End to end, under the condition that actually broke: production mode, target absent."""
    monkeypatch.setenv("APP_ENV", "production")
    rec = Recorder(_valid_package_tar())
    env = _env(tmp_path)
    env["APP_ENV"] = "production"
    target = Path(env["ROT_CONTENT_DIR"])
    assert not target.exists()
    assert fetch(env, transport=rec.transport()) == SHA
    assert (target / ".content-revision").read_text(encoding="utf-8").strip() == SHA


def test_staging_happens_on_the_targets_own_filesystem(tmp_path: Path, monkeypatch):
    """The install is an os.rename, and rename cannot cross filesystems.

    Staging in the system temp directory worked everywhere locally and failed on the first real
    deploy with `Invalid cross-device link`, because Render's /tmp is a different mount from the
    project directory — after a successful download, extract and validate. Copying instead would
    be the wrong fix: rename is what makes the swap atomic, so ROT_CONTENT_DIR is never a
    half-written package.

    Asserted by capturing where the staging directory is actually created.
    """
    from scripts import fetch_private_content as mod

    seen: list[Path] = []
    real = mod.tempfile.TemporaryDirectory

    class Spy:
        def __init__(self, *a, **kw):
            seen.append(Path(kw.get("dir")) if kw.get("dir") else None)
            self._d = real(*a, **kw)

        def __enter__(self):
            return self._d.__enter__()

        def __exit__(self, *a):
            return self._d.__exit__(*a)

    monkeypatch.setattr(mod.tempfile, "TemporaryDirectory", Spy)
    rec = Recorder(_valid_package_tar())
    env = _env(tmp_path)
    fetch(env, transport=rec.transport())

    assert seen, "no temporary directory was created"
    target = Path(env["ROT_CONTENT_DIR"])
    assert seen[0] == target.parent, (
        f"staged in {seen[0]}, which may be a different filesystem from {target.parent}"
    )
