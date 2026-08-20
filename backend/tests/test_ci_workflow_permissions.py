"""CI must not silently regain broad GITHUB_TOKEN permissions (Audit 2B-2).

`.gitignore`-style guarantees rot: someone adds a job that needs to publish something, grants
`contents: write` to the whole workflow, and every later job inherits it — including third-party
actions. Once the repository is public and outsiders can open PRs, that token is what stands between
a poisoned action and a pushed commit.

This is a static assertion over the workflow file, so it fails in review rather than in production.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
WRITE_SCOPES = {"write", "write-all"}


def _workflows() -> list[Path]:
    return sorted(WORKFLOWS.glob("*.yml")) + sorted(WORKFLOWS.glob("*.yaml"))


def test_workflows_exist() -> None:
    assert _workflows(), f"no workflows found under {WORKFLOWS}"


@pytest.mark.parametrize("wf", _workflows(), ids=lambda p: p.name)
def test_workflow_declares_least_privilege(wf: Path) -> None:
    """Every workflow must declare permissions explicitly. Silence means 'inherit the repository
    default', which on older repositories is read/write."""
    doc = yaml.safe_load(wf.read_text(encoding="utf-8"))
    perms = doc.get("permissions")
    assert perms is not None, (
        f"{wf.name} declares no top-level `permissions:` — it would inherit the repository default"
    )
    assert perms == {"contents": "read"}, f"{wf.name} top-level permissions are {perms!r}"


@pytest.mark.parametrize("wf", _workflows(), ids=lambda p: p.name)
def test_no_job_grants_itself_write(wf: Path) -> None:
    """A job-level block can widen what the top level narrowed."""
    doc = yaml.safe_load(wf.read_text(encoding="utf-8"))
    for name, job in (doc.get("jobs") or {}).items():
        perms = job.get("permissions")
        if perms is None:
            continue
        if isinstance(perms, str):
            assert perms not in WRITE_SCOPES, f"{wf.name}:{name} grants `permissions: {perms}`"
            continue
        granted = {k: v for k, v in perms.items() if str(v) in WRITE_SCOPES}
        assert not granted, f"{wf.name}:{name} grants write scopes {granted}"


@pytest.mark.parametrize("wf", _workflows(), ids=lambda p: p.name)
def test_no_pull_request_target(wf: Path) -> None:
    """pull_request_target runs FORK code with the base repository's secrets and token. Nothing here
    needs it, and adding it would undo the isolation Audit 3A relies on."""
    doc = yaml.safe_load(wf.read_text(encoding="utf-8"))
    on = doc.get(True) if True in doc else doc.get("on")  # PyYAML parses bare `on:` as boolean True
    triggers = set(on) if isinstance(on, dict) else {on} if isinstance(on, str) else set(on or [])
    assert "pull_request_target" not in triggers, f"{wf.name} uses pull_request_target"


def test_ci_installs_python_deps_frozen() -> None:
    """CI must honour the lockfile the way production does, so drift fails here first."""
    ci = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")
    assert "uv sync --frozen" in ci, "CI must run `uv sync --frozen`"
    assert "\n        run: uv sync\n" not in ci, "CI still has an unfrozen `uv sync`"
