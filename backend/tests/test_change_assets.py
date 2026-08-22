"""Serving change-detection imagery out of the content package (Phase 2Q).

The images are the one piece of gameplay content that is FILES. Moving them behind ROT_CONTENT_DIR
with everything else means a request-supplied string now reaches the filesystem, so the tests here
are in two halves: the round still gets its pictures, and nothing else can be read.

`content/change_assets.resolve` is the single chokepoint, and it is an ALLOWLIST — a name has to
look like an asset id, carry a supported extension and land directly in the assets directory. The
traversal cases below are therefore regression tests for a property that holds by construction,
which is the point: they fail loudly if anyone relaxes the shape check into a blocklist.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from app.core.config import SAMPLE_CONTENT_DIR, Settings
from content import change_assets
from httpx import AsyncClient

pytestmark = pytest.mark.anyio

SAMPLE_ASSET = "sample_01_before.png"


@pytest.fixture(autouse=True)
def _serve_the_sample_package(monkeypatch):
    """Pin the served root to the sample package regardless of the ambient ROT_CONTENT_DIR.

    These tests exercise the MECHANISM — resolution, containment, media types, 404s — against
    filenames that are public by construction. Run with a private content root exported they would
    otherwise ask a public test file to know private asset names, which is the thing the whole
    boundary exists to prevent. Production imagery is verified separately, against the package.
    """
    from app.core.config import settings

    monkeypatch.setattr(settings, "content_dir", str(SAMPLE_CONTENT_DIR))


# ---------------- resolution (pure) ----------------


def test_sample_assets_live_under_assets_dir():
    d = change_assets.assets_dir(SAMPLE_CONTENT_DIR)
    assert d.is_dir(), d
    names = sorted(p.name for p in d.glob("*"))
    assert names == [
        "sample_01_after.png",
        "sample_01_before.png",
        "sample_02_after.png",
        "sample_02_before.png",
    ], names


def test_a_real_asset_resolves_to_the_file_in_the_package():
    p = change_assets.resolve(SAMPLE_CONTENT_DIR, SAMPLE_ASSET)
    assert p is not None
    assert p == change_assets.assets_dir(SAMPLE_CONTENT_DIR).resolve() / SAMPLE_ASSET
    assert p.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"  # a real PNG, not a stub


@pytest.mark.parametrize(
    "hostile",
    [
        "../../../../etc/passwd",
        "../manifest.json",  # a sibling INSIDE the package is still out of bounds
        "..%2fmanifest.json",
        "%2e%2e%2fmanifest.json",
        "....//manifest.json",
        "/etc/passwd",
        "C:/Windows/win.ini",
        "..\\..\\manifest.json",
        "sub/dir/x.png",
        "..",
        ".",
        "",
        ".env",
        "\x00.png",
        "sample_01_before.png\x00.txt",
    ],
)
def test_hostile_names_never_resolve(hostile):
    assert change_assets.resolve(SAMPLE_CONTENT_DIR, hostile) is None


@pytest.mark.parametrize("name", ["manifest.json", "notes.txt", "x.svg", "x.webp", "x.gif"])
def test_unsupported_extensions_never_resolve(name):
    """The type allowlist is content policy, not just safety: WebP is excluded because iOS 13's
    WKWebView cannot render it (docs/architecture.md §13), and a frame that fails to load in a
    change round is an unfindable change, not a visible error."""
    assert change_assets.resolve(SAMPLE_CONTENT_DIR, name) is None


def test_unknown_asset_does_not_resolve():
    assert change_assets.resolve(SAMPLE_CONTENT_DIR, "no_such_image.png") is None


def test_resolution_follows_the_configured_root(tmp_path: Path):
    """The endpoint reads settings.content_root, so pointing it elsewhere serves from elsewhere —
    this is what makes the sample and production packages the same code path."""
    assets = tmp_path / "change" / "assets"
    assets.mkdir(parents=True)
    (assets / "only_here.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 16)
    assert change_assets.resolve(tmp_path, "only_here.png") is not None
    assert change_assets.resolve(SAMPLE_CONTENT_DIR, "only_here.png") is None
    assert change_assets.resolve(tmp_path, SAMPLE_ASSET) is None


def test_the_configured_root_is_where_the_endpoint_reads_from(monkeypatch):
    """Settings.content_root is the seam; a production deploy points it at the private package.

    The env var is cleared explicitly: `_env_file=None` suppresses .env but not os.environ, so with
    a private root exported this would assert against the developer's shell instead of the default.
    """
    monkeypatch.delenv("ROT_CONTENT_DIR", raising=False)
    monkeypatch.delenv("CONTENT_DIR", raising=False)
    cfg = Settings(_env_file=None, app_env="local")
    assert change_assets.assets_dir(cfg.content_root) == SAMPLE_CONTENT_DIR / "change" / "assets"


# ---------------- serving (HTTP) ----------------


async def test_asset_is_served_with_real_image_bytes(client: AsyncClient):
    r = await client.get(f"/content/change/{SAMPLE_ASSET}")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert (
        len(r.content)
        == (change_assets.assets_dir(SAMPLE_CONTENT_DIR) / SAMPLE_ASSET).stat().st_size
    )
    assert "max-age" in r.headers.get("cache-control", "")


async def test_asset_needs_no_auth(client: AsyncClient):
    """`<img src>` sends no Authorization header, so requiring one would break every client. This
    is the same exposure the files had as public static assets — the win is that they no longer
    need to exist in public SOURCE."""
    r = await client.get(f"/content/change/{SAMPLE_ASSET}")
    assert r.status_code == 200


@pytest.mark.parametrize(
    "path",
    [
        "/content/change/../../../../etc/passwd",
        "/content/change/..%2f..%2fmanifest.json",
        "/content/change/%2e%2e%2fmanifest.json",
        "/content/change/manifest.json",
        "/content/change/no_such_image.png",
        "/content/change/x.webp",
        "/content/change/",
        "/content/change",
    ],
)
async def test_hostile_or_missing_requests_are_a_flat_404(client: AsyncClient, path):
    """One response for malformed, traversing, unsupported and absent, so the endpoint cannot be
    used to probe what the private package contains."""
    r = await client.get(path)
    assert r.status_code == 404, f"{path} -> {r.status_code}"


async def test_no_directory_listing(client: AsyncClient):
    for path in ("/content/change/", "/content/change", "/content/"):
        r = await client.get(path)
        assert r.status_code == 404
        assert SAMPLE_ASSET not in r.text


async def test_traversal_cannot_read_a_file_that_definitely_exists(client: AsyncClient):
    """manifest.json sits one directory above the assets dir and is known to exist, so a pass here
    would be a real read of private content rather than a lucky miss."""
    assert (SAMPLE_CONTENT_DIR / "change" / "manifest.json").is_file()
    for attempt in ("../manifest.json", "..%2fmanifest.json", "%2e%2e/manifest.json"):
        r = await client.get(f"/content/change/{attempt}")
        assert r.status_code == 404
        assert "items" not in r.text
