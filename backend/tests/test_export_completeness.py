"""The published tree must be EXACTLY the exported tree.

Every other gate in the publication pipeline is NEGATIVE — it hunts for private artwork, secrets,
internal documents, unclassified paths. Every one of them passes on a tree that is missing half the
repository, because absence is not what they look for.

That is not hypothetical. `.gitignore` carries `frontend/ios/`. Those 24 files are force-tracked
upstream, so the rule does nothing there; the exporter emitted them and the registry declared them
public. But the sync ran `git add -A` in the public checkout, which honours `.gitignore`, so they
never staged. Two publications went out with the entire iOS project missing — 1046 files exported,
1022 committed — and not one check failed.

The fix is general rather than a carve-out for that directory: the public repository is a derived
artifact, so staging uses `--force` and no ignore rule gets a vote. This file pins the gate that
proves it worked.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "scripts"


def _load(name: str) -> ModuleType:
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
def gate() -> ModuleType:
    return _load("verify_export_complete")


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


@pytest.fixture
def staged(tmp_path: Path):
    """An export directory and a git repo with that export staged — the state the gate judges."""

    def build(files: dict[str, str], *, gitignore: str = "", stage_force: bool = True):
        export = tmp_path / "export"
        repo = tmp_path / "repo"
        for d in (export, repo):
            d.mkdir(exist_ok=True)
        _git(repo, "init", "-q")
        _git(repo, "config", "user.email", "t@e")
        _git(repo, "config", "user.name", "t")

        for rel, body in files.items():
            for base in (export, repo):
                p = base / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(body, encoding="utf-8")
        if gitignore:
            # Present in BOTH, exactly as the real sync copies .gitignore into the public tree.
            for base in (export, repo):
                (base / ".gitignore").write_text(gitignore, encoding="utf-8")
            files = {**files, ".gitignore": gitignore}

        _git(repo, "add", "--all", "--force") if stage_force else _git(repo, "add", "-A")
        return export, repo

    return build


def test_a_complete_tree_passes(gate: ModuleType, staged) -> None:
    export, repo = staged({"a.txt": "one", "sub/b.txt": "two"})
    assert gate.compare(export, repo, placeholders=[]) == []


def test_an_ignored_path_dropped_by_plain_add_is_caught(gate: ModuleType, staged) -> None:
    """The actual bug, reproduced: `git add -A` honours .gitignore and the file vanishes."""
    export, repo = staged(
        {"keep.txt": "x", "frontend/ios/AppDelegate.swift": "swift"},
        gitignore="frontend/ios/\n",
        stage_force=False,
    )
    problems = gate.compare(export, repo, placeholders=[])
    assert any(
        "MISSING FROM THE PUBLISHED TREE: frontend/ios/AppDelegate.swift" in p for p in problems
    )


def test_forcing_the_add_publishes_the_ignored_path(gate: ModuleType, staged) -> None:
    """The fix, and it is general — the rule never gets a vote, whatever it matches."""
    export, repo = staged(
        {"keep.txt": "x", "frontend/ios/AppDelegate.swift": "swift"},
        gitignore="frontend/ios/\n",
        stage_force=True,
    )
    assert gate.compare(export, repo, placeholders=[]) == []


def test_a_path_ignored_by_a_rule_nobody_anticipated_is_also_caught(
    gate: ModuleType, staged
) -> None:
    """Not a carve-out for frontend/ios. Any rule, any path, including future ones."""
    export, repo = staged(
        {"src/secret_engine.py": "code", "keep.txt": "x"},
        gitignore="*.py\n",
        stage_force=False,
    )
    problems = gate.compare(export, repo, placeholders=[])
    assert any("MISSING FROM THE PUBLISHED TREE: src/secret_engine.py" in p for p in problems)


def test_content_that_differs_is_caught(gate: ModuleType, staged) -> None:
    """Present-but-wrong is as bad as absent, and a path-only check would miss it."""
    export, repo = staged({"a.txt": "one"})
    (export / "a.txt").write_text("something else", encoding="utf-8")
    problems = gate.compare(export, repo, placeholders=[])
    assert any(p.startswith("CONTENT DIFFERS: a.txt") for p in problems)


def test_a_file_staged_that_was_never_exported_is_caught(gate: ModuleType, staged) -> None:
    """The derived tree is exactly the export — extra material is a defect the other way."""
    export, repo = staged({"a.txt": "one"})
    (repo / "stowaway.txt").write_text("x", encoding="utf-8")
    _git(repo, "add", "--all", "--force")
    problems = gate.compare(export, repo, placeholders=[])
    assert any("STAGED BUT NOT EXPORTED: stowaway.txt" in p for p in problems)


def test_an_empty_export_is_refused(gate: ModuleType, tmp_path: Path) -> None:
    """Comparing nothing to nothing succeeds trivially, which is the wrong answer."""
    export = tmp_path / "empty"
    export.mkdir()
    repo = tmp_path / "r"
    repo.mkdir()
    _git(repo, "init", "-q")
    problems = gate.compare(export, repo, placeholders=[])
    assert problems and "NOTHING EXPORTED" in problems[0]


def test_placeholders_are_checked_against_the_manifest_not_the_export(gate: ModuleType) -> None:
    """The one check that survives the export and the index agreeing with each other.

    If the exporter stopped generating placeholders, they would be absent from BOTH sides and a
    pure export-vs-index comparison would report no difference at all. The expected list is derived
    from assets-manifest.json instead, so it knows the file was supposed to exist. Mutation testing
    confirmed this: deleting a placeholder from the export directory and the repo together was
    caught by this check alone.
    """
    paths = gate.placeholder_paths()
    if not paths:
        pytest.skip("assets-manifest.json is private and absent in a derived tree")
    assert len(paths) > 100, "the manifest should list every withheld image"
    assert all(Path(p).suffix.lower() in gate.IMAGE_SUFFIXES for p in paths)
    assert all(not p.startswith("/") and ".." not in p for p in paths)
