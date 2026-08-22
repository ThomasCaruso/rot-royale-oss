"""Documentation published to the open-source repository is an ALLOWLIST, and must stay one.

It used to be a blocklist. That blocklist named exactly one file — the production cutover runbook —
and shipped the other 45 documents in `docs/`: 27 agent-directed implementation plans, several
internal growth and analytics notes, and a set of generated corpus reports that between them quoted
134 verbatim production questions into a public repository.

That is the blocklist failure mode, and it is not fixable by adding entries. A blocklist protects
what someone thought of on the day they wrote it, and every document added afterwards is published
by default. Deny-by-default inverts which way the mistake points: a new internal note stays private
until someone deliberately publishes it.

The second half covers the sanitized verification manifest, which exists for the same reason:
publishing the full asset manifest handed out a directory map of proprietary work to satisfy a
verification need that opaque digests satisfy just as well.

These are static assertions over the two scripts, so a regression fails in review rather than in a
public repository — the one place the failure cannot be undone.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tomllib
from pathlib import Path
from types import ModuleType

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "scripts"


def _load(name: str) -> ModuleType:
    """Import a repo-root script by path.

    Two details are load-bearing. `scripts/` goes on sys.path because export_public imports
    export_classification as a sibling, and the module is registered in sys.modules BEFORE it is
    executed because @dataclass resolves postponed annotations through sys.modules[cls.__module__]
    — without it, a dataclass in a module loaded this way raises AttributeError on definition.
    """
    if str(SCRIPTS) not in sys.path:
        sys.path.insert(0, str(SCRIPTS))
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    assert spec and spec.loader, f"cannot load {name}"
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def exporter() -> ModuleType:
    return _load("export_public")


@pytest.fixture(scope="module")
def verifier() -> ModuleType:
    return _load("verify_public_tree")


def test_the_allowlist_is_not_empty_and_every_entry_exists(exporter: ModuleType) -> None:
    """An allowlist naming a file that does not exist is a typo waiting to publish nothing."""
    assert exporter.DOCS_ALLOW, "no documentation is published at all — that is probably a mistake"
    for rel in exporter.DOCS_ALLOW:
        assert (REPO / rel).is_file(), f"{rel} is allowlisted for publication but does not exist"


@pytest.mark.parametrize(
    "path",
    [
        "docs/PRODUCTION-CUTOVER.md",  # names production service ids
        "docs/growth.md",
        "docs/analytics-funnel.md",
        "docs/content-strategy-audit.md",
        "docs/content/question-bank-analysis.json",  # quoted 134 production questions
        "docs/content/question-bank-lint-report.md",
        "docs/superpowers/plans/2026-07-04-growth-over-time.md",
        "docs/plans/notifications-system-design.md",
        "docs/runbooks/daily-royale-deploy.md",
        "docs/a-document-nobody-has-written-yet.md",  # the case a blocklist always misses
    ],
)
def test_internal_documents_are_withheld(exporter: ModuleType, path: str) -> None:
    assert exporter.is_withheld_doc(path)


def test_allowlisted_documents_are_published(exporter: ModuleType) -> None:
    for rel in exporter.DOCS_ALLOW:
        assert not exporter.is_withheld_doc(rel)


def test_the_rule_applies_only_to_docs(exporter: ModuleType) -> None:
    """It must not start eating source files that merely live in a similarly named directory."""
    for path in ("backend/app/main.py", "README.md", "frontend/src/game/README.md"):
        assert not exporter.is_withheld_doc(path)


def test_the_exporter_and_the_verifier_agree(exporter: ModuleType, verifier: ModuleType) -> None:
    """The two lists are stated separately on purpose; they must still describe the same intent.

    The verifier re-derives its own rule rather than importing the exporter's, so that it can catch
    an exporter that allowlisted something it should not have — that independence is what caught a
    fully neutered guard in mutation testing. What independence must NOT do is drift: an exporter
    that publishes a document the verifier rejects breaks the sync, and the failure would read as a
    verification bug rather than as the disagreement it is.
    """
    assert set(exporter.DOCS_ALLOW) == set(verifier.PUBLISHED_DOCS)


@pytest.mark.parametrize("path", ["CLAUDE.md", "PLAN.md", ".claude/", "render.staging.yaml"])
def test_agent_facing_documents_are_excluded_by_both(
    exporter: ModuleType, verifier: ModuleType, path: str
) -> None:
    """The repo's own operating instructions and private infrastructure are process, not product.

    `docs/architecture.md` is the public documentation written to replace them, and the public
    README points at it — so a reader is never sent to a file this repository does not contain.
    """
    assert path in exporter.EXCLUDE
    assert path in verifier.FORBIDDEN_PREFIXES


# --- The sanitized verification manifest -------------------------------------------------------
#
# assets-manifest.json is a directory map of proprietary work: every private asset's path, byte
# size, provenance and licence. It was being published in full, for one reason — the public copy of
# verify_public_tree.py read it. That is a real need (a third party should be able to check the
# tree they cloned) served by the wrong artifact: the only question a verifier asks is "does any
# file here hash to something withheld?", which needs opaque digests and nothing else.


def test_the_full_asset_manifest_is_never_published(exporter: ModuleType) -> None:
    assert "assets-manifest.json" in exporter.EXCLUDE


def test_the_sanitized_manifest_carries_digests_and_nothing_else(exporter: ModuleType) -> None:
    """No paths, no filenames, no dispositions, no sizes — the things that make it an inventory."""
    private_sha = {
        "frontend/public/assets/themes/starter/crown.png": "aaaaaaaaaaaaaaaa",
        "frontend/public/assets/secret-boss-art.png": "bbbbbbbbbbbbbbbb",
    }
    out = exporter.public_verification_manifest(private_sha, set())

    assert out["withheld_sha256"] == ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]
    assert out["withheld_count"] == 2

    blob = json.dumps(out)
    for path in private_sha:
        assert path not in blob
        assert path.rsplit("/", 1)[-1] not in blob
    assert "disposition" not in blob and "bytes" not in blob


def test_a_blob_that_is_both_withheld_and_kept_is_resolved_before_publication(
    exporter: ModuleType,
) -> None:
    """An icon byte-identical to a deleted duplicate is legitimately present.

    The subtraction happens here rather than being left for the reader, so the published list is
    directly usable as a ban list and a third party cannot resolve it differently than we do.
    """
    shared = "cccccccccccccccc"
    out = exporter.public_verification_manifest(
        {"frontend/deleted-copy.png": shared, "frontend/private.png": "dddddddddddddddd"},
        {shared},
    )
    assert out["withheld_sha256"] == ["dddddddddddddddd"]


def test_both_scripts_agree_on_the_sanitized_manifest_name(
    exporter: ModuleType, verifier: ModuleType
) -> None:
    """A mismatch here means the verifier silently finds no manifest and refuses every tree."""
    assert exporter.PUBLIC_MANIFEST_NAME == verifier.PUBLIC_MANIFEST_NAME


def test_both_scripts_truncate_digests_identically(
    exporter: ModuleType, verifier: ModuleType
) -> None:
    """The manifest stores truncated digests; comparing a full-length one matches nothing at all."""
    assert exporter.DIGEST_PREFIX_LEN == verifier.DIGEST_PREFIX_LEN
    full = REPO / "assets-manifest.json"
    if not full.is_file():
        pytest.skip("the full manifest is private; nothing to cross-check in a public clone")
    manifest = json.loads(full.read_text(encoding="utf-8"))
    widths = {len(a["sha256"]) for a in manifest["assets"]}
    assert widths == {exporter.DIGEST_PREFIX_LEN}, (
        f"assets-manifest.json stores {widths} char digests but the scripts truncate to "
        f"{exporter.DIGEST_PREFIX_LEN} — every comparison would silently miss"
    )


def test_the_scripts_are_linted_by_the_same_rules_as_the_backend() -> None:
    """The repo-root ruff.toml must not drift into a second house style.

    scripts/ sits outside backend/, so ruff resolves configuration by walking up from each file and
    finds the root ruff.toml. Without that file it falls back to ruff's DEFAULTS — 88 columns and a
    narrower rule set — which is how the leak-prevention scripts ended up both unlinted in CI and
    disagreeing with the local tool. Mirroring is the point; a divergence here silently reopens that
    gap for whichever rule stopped matching.
    """
    root_cfg = REPO / "ruff.toml"
    backend_cfg = REPO / "backend" / "pyproject.toml"
    if not (root_cfg.is_file() and backend_cfg.is_file()):
        pytest.skip("one of the two ruff configurations is absent")

    root = tomllib.loads(root_cfg.read_text(encoding="utf-8"))
    backend = tomllib.loads(backend_cfg.read_text(encoding="utf-8"))["tool"]["ruff"]

    assert root["line-length"] == backend["line-length"]
    assert root["target-version"] == backend["target-version"]
    assert root["lint"]["select"] == backend["lint"]["select"]
    assert root["lint"]["ignore"] == backend["lint"]["ignore"]
