"""render.yaml is a deployment CONTRACT, so it gets tests (Phase 2R.1).

The blueprint is the one artifact whose mistakes are invisible until a deploy: it is not imported,
not type-checked, and not exercised by any other test. The failures it can cause are the expensive
kind — a service booting against absent content, two services in one deploy resolving different
content, or a credential written into source. Each is cheap to assert here and dear to discover in
production.

The precedent is real: ROT_CONTENT_DIR was already declared in this file while the application read
CONTENT_DIR, which would have stopped all four services from booting on the first deploy. That is
why test_content_boundary cross-checks the variable name against this file, and why the rules below
are asserted rather than reviewed.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[2]
RENDER_YAML = REPO / "render.yaml"
STAGING_YAML = REPO / "render.staging.yaml"

# Both blueprints must satisfy the same content contract. Staging is the one that deploys FIRST, so
# leaving it untested would put the least-verified file on the critical path.
#
# The staging blueprint is PRIVATE — it describes internal deployment topology for an environment
# that only ever existed to rehearse the content split, so it is not exported to the open-source
# repository. Every staging assertion below is therefore conditional on the file being present:
# present in this repo, absent in a public clone. Filtering the list rather than skipping inside
# each test means a public run reports honestly on what it checked instead of listing phantom skips.
BLUEPRINTS = tuple(p for p in (RENDER_YAML, STAGING_YAML) if p.is_file())

CONTENT_REPO = "ThomasCaruso/rot-royale-content"
FETCH_COMMAND = "scripts.fetch_private_content"
# Environment-SPECIFIC group names, one per blueprint. Not one name shadowed per environment:
# nothing documents that two identically named groups resolve safely through `fromGroup`, and the
# failure mode is production reading a staging credential — or a staging content revision.
ENV_GROUP = "rot-royale-content-staging"
ENV_GROUP_FOR = {
    "render.yaml": "rot-royale-content-production",
    "render.staging.yaml": "rot-royale-content-staging",
}

# Variables that must NEVER carry a literal value in source.
SECRET_KEYS = frozenset({"GITHUB_CONTENT_TOKEN", "SECRET_KEY", "VAPID_PRIVATE_KEY"})


@pytest.fixture(params=BLUEPRINTS, ids=lambda p: p.name)
def path(request) -> Path:
    return request.param


@pytest.fixture
def blueprint(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _services(blueprint: dict) -> list[dict]:
    return blueprint["services"]


def _content_services(blueprint: dict) -> list[dict]:
    """Services that read the content package: every Python service.

    Identified by runtime rather than by name, so a service added later is covered by default and
    has to be deliberately excluded rather than accidentally forgotten.
    """
    return [s for s in _services(blueprint) if s.get("runtime") == "python"]


def _env(service: dict) -> dict[str, dict]:
    return {e["key"]: e for e in service.get("envVars", []) if "key" in e}


def _groups(service: dict) -> list[str]:
    return [e["fromGroup"] for e in service.get("envVars", []) if "fromGroup" in e]


def test_the_blueprint_declares_content_services(blueprint, path):
    """PRODUCTION must carry all four Python services — that count is the contract, and a service
    silently dropped from the live blueprint is a whole job disappearing.

    Staging carries one on purpose. A cron's buildCommand runs the same fetch string through the
    same code and the same environment group, so three more services would re-prove one code path
    at triple the cost. What that leaves unobserved — four live builds resolving one CONTENT_COMMIT
    — is structural rather than empirical: they share a single environment group, which is asserted
    against render.yaml by test_every_content_service_uses_the_same_settings below.
    """
    count = len(_content_services(blueprint))
    names = [s["name"] for s in _services(blueprint)]
    if path.name == "render.yaml":
        assert count == 4, names
    else:
        assert count >= 1, names


# ---------------- retrieval ----------------


def test_every_content_service_fetches_the_package_in_its_build(blueprint):
    """Cron jobs included. Each service builds independently, so each must retrieve its own copy;
    a fetch on the web service alone leaves three services with no content at all."""
    for s in _content_services(blueprint):
        assert FETCH_COMMAND in (s.get("buildCommand") or ""), s["name"]


def test_the_fetch_is_never_in_a_pre_deploy_command(blueprint):
    """Render's pre-deploy runs on a SEPARATE instance whose filesystem changes do not reach the
    deployed service — the package would validate there and then be gone at runtime."""
    for s in _services(blueprint):
        assert FETCH_COMMAND not in (s.get("preDeployCommand") or ""), s["name"]


def test_dependencies_are_installed_before_the_fetch_runs(blueprint):
    """The fetcher imports httpx and the content validators, so `uv sync` has to precede it."""
    for s in _content_services(blueprint):
        build = s["buildCommand"]
        assert build.index("uv sync") < build.index(FETCH_COMMAND), s["name"]


def test_the_fetch_precedes_every_step_that_reads_content(blueprint):
    """seed / ingest / ingest-estimate / ingest-change all read ROT_CONTENT_DIR. The fetch happens
    in the build and those run at start, so ordering holds across the two commands — asserted so a
    future edit cannot move an ingest into the build ahead of the fetch."""
    for s in _content_services(blueprint):
        build = s["buildCommand"]
        if FETCH_COMMAND not in build:
            continue
        cut = build.index(FETCH_COMMAND)
        before = build[:cut]
        for step in ("run seed", "run ingest", "ingest-estimate", "ingest-change"):
            assert step not in before, f"{s['name']}: {step!r} runs before the content fetch"


def test_the_fetch_is_chained_so_a_failure_aborts_the_build(blueprint):
    """`&&`, never `;` or `||` — a failed retrieval must fail the deploy, not fall through to a
    build that ships without content."""
    for s in _content_services(blueprint):
        build = s["buildCommand"]
        # Structural, not textual: the fetch must be one whole `&&` segment. Slicing the string at
        # the command name cuts through "uv run python -m ", which says nothing about chaining.
        segments = [seg.strip() for seg in build.split("&&")]
        assert any(FETCH_COMMAND in seg for seg in segments), s["name"]
        assert ";" not in build and "||" not in build, s["name"]
        assert len(segments) >= 3, f"{s['name']}: expected install && sync && fetch, got {segments}"


# ---------------- configuration ----------------


def test_content_repo_is_pinned_exactly(blueprint):
    for s in _content_services(blueprint):
        entry = _env(s).get("CONTENT_REPO")
        assert entry is not None, s["name"]
        assert entry.get("value") == CONTENT_REPO, s["name"]


def test_content_commit_is_never_a_literal_in_source(blueprint, path):
    """It belongs to the environment group. In source it would tie every content release to an
    application commit, which is exactly the coupling this design removes."""
    for s in _content_services(blueprint):
        assert "CONTENT_COMMIT" not in _env(s), s["name"]
    raw = path.read_text(encoding="utf-8")
    assert not re.search(r"CONTENT_COMMIT\s*:?\s*\n?\s*value:", raw)


def test_content_commit_is_never_a_branch_or_head(blueprint, path):
    """Belt to the fetcher's own 40-character check: nothing in the blueprint may suggest a ref."""
    raw = path.read_text(encoding="utf-8")
    for ref in ("CONTENT_COMMIT: main", "CONTENT_COMMIT: HEAD", "value: main", "value: HEAD"):
        assert ref not in raw


def test_content_dir_is_inside_each_service_root(blueprint):
    """Render runs build and start commands from the service's rootDir, and files outside it are
    unavailable. A path that escapes it resolves to nothing at runtime."""
    for s in _content_services(blueprint):
        entry = _env(s).get("ROT_CONTENT_DIR")
        assert entry is not None, s["name"]
        value = entry.get("value")
        assert value, f"{s['name']}: ROT_CONTENT_DIR must have a value, not sync:false"
        assert not Path(value).is_absolute(), f"{s['name']}: {value!r} is absolute"
        assert not value.startswith(".."), f"{s['name']}: {value!r} escapes rootDir"
        assert ".." not in Path(value).parts, f"{s['name']}: {value!r} escapes rootDir"


def test_content_dir_does_not_collide_with_the_python_package(blueprint):
    """`backend/content/` is the Python content package; unpacking a corpus over it would shadow
    the code that reads it."""
    for s in _content_services(blueprint):
        value = _env(s)["ROT_CONTENT_DIR"]["value"]
        assert Path(value).parts[0] != "content", s["name"]


def test_every_content_service_uses_the_same_settings(blueprint):
    """One CONTENT_REPO, one ROT_CONTENT_DIR, one environment group across all four. Divergence is
    how two services in the same deploy end up on different content."""
    repos = {_env(s)["CONTENT_REPO"]["value"] for s in _content_services(blueprint)}
    dirs = {_env(s)["ROT_CONTENT_DIR"]["value"] for s in _content_services(blueprint)}
    groups = {tuple(sorted(_groups(s))) for s in _content_services(blueprint)}
    assert len(repos) == 1, repos
    assert len(dirs) == 1, dirs
    assert len(groups) == 1, groups


def test_every_content_service_links_the_environment_group(blueprint, path):
    expected = ENV_GROUP_FOR[path.name]
    for s in _content_services(blueprint):
        assert expected in _groups(s), f"{s['name']}: {_groups(s)}"


def test_no_blueprint_links_another_environments_group(blueprint, path):
    """Production must never link staging's credential group, or vice versa. render.yaml carried
    the staging group for one commit after the blueprints were split — caught by
    `render blueprints validate`, which refused it as a non-existent group."""
    expected = ENV_GROUP_FOR[path.name]
    foreign = {v for v in ENV_GROUP_FOR.values() if v != expected}
    for s in _services(blueprint):
        assert not (set(_groups(s)) & foreign), f"{s['name']} links {_groups(s)}"


def test_the_static_site_needs_no_content(blueprint, path):
    """Change imagery moved behind the API in Phase 2Q, so the frontend build no longer touches the
    corpus. Giving it the credential anyway would widen the token's exposure for nothing."""
    static = [s for s in _services(blueprint) if s.get("runtime") == "static"]
    if not static:
        pytest.skip("this blueprint declares no static site")
    for s in static:
        assert "ROT_CONTENT_DIR" not in _env(s), s["name"]
        assert FETCH_COMMAND not in (s.get("buildCommand") or ""), s["name"]
        assert ENV_GROUP_FOR[path.name] not in _groups(s), s["name"]


# ---------------- secrets ----------------


def test_no_secret_carries_a_literal_value(blueprint):
    """A credential in the blueprint is a credential in the public repository."""
    for s in _services(blueprint):
        for key, entry in _env(s).items():
            if key in SECRET_KEYS:
                assert "value" not in entry, f"{s['name']}: {key} has a literal value"


def test_the_blueprint_contains_nothing_token_shaped(path):
    raw = path.read_text(encoding="utf-8")
    for pattern in (
        r"gh[pousr]_[A-Za-z0-9]{20,}",
        r"github_pat_[A-Za-z0-9_]{20,}",
        r"-----BEGIN [A-Z ]*PRIVATE KEY",
    ):
        assert not re.search(pattern, raw), pattern


def test_the_token_is_never_named_in_a_command(blueprint):
    """It must reach the fetcher through the environment, never through a command line, where it
    would land in process listings and build logs."""
    for s in _services(blueprint):
        for field in ("buildCommand", "startCommand", "preDeployCommand"):
            assert "GITHUB_CONTENT_TOKEN" not in (s.get(field) or ""), f"{s['name']}.{field}"


# ---------------- staging isolation ----------------
#
# The staging blueprint's most important property is not what it does but what it CANNOT touch. An
# apply that adopted a live service or pointed a staging job at the production database would be
# the single most expensive mistake available in this whole migration, and it is a mistake made by
# a name collision, which is exactly what a test can catch.


@pytest.fixture(scope="module")
def prod() -> dict:
    return yaml.safe_load(RENDER_YAML.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def staging() -> dict:
    if not STAGING_YAML.is_file():
        pytest.skip("the staging blueprint is private and is not exported")
    return yaml.safe_load(STAGING_YAML.read_text(encoding="utf-8"))


def test_staging_reuses_no_production_resource_name(prod, staging):
    prod_names = {s["name"] for s in prod["services"]} | {
        d["name"] for d in prod.get("databases", [])
    }
    staging_names = {s["name"] for s in staging["services"]} | {
        d["name"] for d in staging.get("databases", [])
    }
    overlap = prod_names & staging_names
    assert not overlap, f"staging would adopt production resources: {sorted(overlap)}"


def test_every_staging_resource_is_marked_staging(staging):
    for s in staging["services"]:
        assert s["name"].endswith("-staging"), s["name"]
    for d in staging.get("databases", []):
        assert d["name"].endswith("-staging"), d["name"]


def test_staging_builds_the_candidate_branch(staging):
    for s in staging["services"]:
        assert s.get("branch") == "oss/public-release", s["name"]


def test_no_staging_service_can_reach_the_production_database(prod, staging):
    """Referenced through fromDatabase, so a live connection string is never typed anywhere it
    could be pasted into the wrong field."""
    prod_dbs = {d["name"] for d in prod.get("databases", [])}
    staging_dbs = {d["name"] for d in staging.get("databases", [])}
    assert staging_dbs
    for s in staging["services"]:
        entry = _env(s).get("DATABASE_URL")
        assert entry is not None, s["name"]
        ref = entry.get("fromDatabase", {}).get("name")
        assert ref in staging_dbs, f"{s['name']}: DATABASE_URL -> {ref!r}"
        assert ref not in prod_dbs, f"{s['name']}: points at the PRODUCTION database"
        assert "value" not in entry, f"{s['name']}: literal connection string"


def test_staging_declares_the_env_group_with_no_values(staging):
    groups = {g["name"]: g for g in staging.get("envVarGroups", [])}
    assert ENV_GROUP in groups, sorted(groups)
    keys = {e["key"]: e for e in groups[ENV_GROUP]["envVars"]}
    assert {"GITHUB_CONTENT_TOKEN", "CONTENT_COMMIT"} <= set(keys)
    for key, entry in keys.items():
        assert entry.get("sync") is False, f"{key} must be a placeholder, not a value"
        assert "value" not in entry, f"{key} carries a literal value"


def test_staging_runs_production_mode(staging):
    """The mode is the thing under test: the content guard, the disabled docs, and the no-fallback
    rule are all APP_ENV-gated."""
    for s in staging["services"]:
        assert _env(s).get("APP_ENV", {}).get("value") == "production", s["name"]


def test_staging_generates_its_own_secret_key(staging):
    for s in staging["services"]:
        entry = _env(s).get("SECRET_KEY")
        assert entry is not None, s["name"]
        assert entry.get("generateValue") is True, s["name"]
        assert "value" not in entry, s["name"]


def test_staging_is_free_tier(staging):
    """Staging is a throwaway that runs for days and is then deleted. A paid plan sneaking in is a
    recurring bill for an environment nobody remembers creating."""
    for s in staging["services"]:
        assert s.get("plan") == "free", f"{s['name']}: plan={s.get('plan')!r}"
    for d in staging.get("databases", []):
        assert d.get("plan") == "free", f"{d['name']}: plan={d.get('plan')!r}"


def test_production_never_runs_its_own_scheduler(prod):
    """Staging sets SCHEDULER_ENABLED=true because it has no cron and something must provision the
    day's window. Production must NOT: the cron owns scheduling there so settlement stays
    exactly-once across services (§7b), and an in-process daemon on the web service would race it.

    Asserted against production specifically, so the staging accommodation can never be copied over
    by someone diffing the two blueprints.
    """
    for s in prod["services"]:
        entry = _env(s).get("SCHEDULER_ENABLED")
        if entry is not None:
            assert entry.get("value") == "false", f"{s['name']}: {entry}"
