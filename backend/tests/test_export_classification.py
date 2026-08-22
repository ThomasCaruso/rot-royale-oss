"""Every tracked file must have a publication decision recorded against it.

The exporter's older model was "publish everything except the private things we have thought of".
That is a blocklist, and its failure mode is not visible by reading it: a file nobody classified
gets published, silently, on the next merge to main. It happened twice — a `git add -A` swept an
unreviewed tooling directory into the tracked tree, and a documentation blocklist naming one runbook
published the other 45 files beside it.

Both were caught by the export's CONTENT checks, which look for artwork and secrets. Those checks
cannot recognise a proprietary scoring algorithm or an unreleased game mode, because those look
exactly like the rest of the codebase. Only a decision can, and only if someone is made to make it.

So this runs in CI on every pull request: a new path with no rule fails here, in front of the person
who wrote it and knows what it is, rather than in the public repository where it cannot be undone.
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

# `.source-revision` is written by the exporter into every tree it produces, so its presence means
# "this IS the derived public repository". The tree-wide assertions below describe the SOURCE
# repository's publication policy: which of its files may be published, and whether its inventory is
# current. A derived tree publishes nothing and tracks only the subset that survived the export, so
# those assertions are not merely untestable there — they have no subject. The algorithm tests in
# this file still run everywhere, because the matching rules are worth checking wherever they live.
IS_DERIVED_TREE = (REPO / ".source-revision").is_file()

only_in_the_source_repo = pytest.mark.skipif(
    IS_DERIVED_TREE,
    reason="this is an exported tree; the classification registry governs the source repository",
)


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
def registry() -> ModuleType:
    return _load("export_classification")


@pytest.fixture(scope="module")
def rules(registry: ModuleType) -> list:
    return registry.load_rules()


@pytest.fixture(scope="module")
def tracked() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files"], cwd=REPO, capture_output=True, text=True, check=True
    ).stdout
    paths = [line for line in out.splitlines() if line]
    assert paths, "git ls-files returned nothing — the check would pass vacuously"
    return paths


@only_in_the_source_repo
def test_every_tracked_path_is_classified(
    registry: ModuleType, rules: list, tracked: list[str]
) -> None:
    """The gate. A new file with no rule fails here rather than being published by omission."""
    unclassified = [p for p in tracked if registry.classify(p, rules) is None]
    assert not unclassified, (
        f"{len(unclassified)} tracked path(s) have no publication decision:\n  "
        + "\n  ".join(unclassified[:25])
        + "\n\nAdd a rule to export-classification.toml. A file with no rule is not published — "
        "decide deliberately rather than by omission."
    )


@only_in_the_source_repo
def test_the_declared_classification_matches_what_the_export_would_do(
    registry: ModuleType, rules: list, tracked: list[str]
) -> None:
    """Declaration and implementation must agree.

    The registry says what SHOULD happen; export_public.treatment() computes what WILL happen from
    the manifest, the exclusion list and the docs allowlist. Two independent answers that must
    match — which is also how a new image dropped into a placeholder directory is caught: the
    registry declares `placeholder`, but a blob absent from the asset manifest would be exported
    verbatim, and the disagreement stops the build.
    """
    exporter = _load("export_public")
    private, _, _ = exporter.load_manifest()
    actual = {rel: exporter.treatment(rel, private) for rel in tracked}
    unclassified, mismatched = registry.audit(actual, rules)

    assert not unclassified  # covered in detail by the test above
    assert not mismatched, "registry and exporter disagree:\n  " + "\n  ".join(
        f"{rel}: declared {declared}, export would {got}" for rel, declared, got in mismatched[:25]
    )


@only_in_the_source_repo
def test_the_committed_inventory_is_current(registry: ModuleType, tracked: list[str]) -> None:
    """The gate that actually catches new proprietary code.

    Subtree rules cannot do this. `backend/` is classified public — correctly, it is the
    application — so a new file inside it inherits "public" and violates no rule. A proprietary
    matchmaker dropped into backend/app/services/ was exported clean in mutation testing, with the
    registry in place and every rule satisfied.

    The inventory records the CONSEQUENCE of the rules per path, so that file becomes one added
    line reading `public` in the pull request diff. The decision stays cheap to make and impossible
    to skip, which is the only property that survives contact with a hurried afternoon.
    """
    exporter = _load("export_public")
    private, _, _ = exporter.load_manifest()
    actual = {rel: exporter.treatment(rel, private) for rel in tracked}

    drift = registry.inventory_drift(actual)
    assert not drift, (
        "export-classification.lock no longer matches the tree:\n  "
        + "\n  ".join(drift[:25])
        + "\n\nReview each line — a new path recorded as `public` is a publication decision — then "
        "run: python scripts/export_classification.py --write-inventory"
    )


def test_a_new_file_in_a_public_subtree_is_still_caught(registry: ModuleType) -> None:
    """Pins the property directly, without needing a real file on disk.

    Written because the rule-level checks all PASS for this case: it is only the inventory that
    notices. A refactor that dropped the inventory would leave every other test in this file green.
    """
    recorded = {"backend/app/main.py": "public"}
    with_new_file = {
        "backend/app/main.py": "public",
        "backend/app/services/proprietary_matchmaker.py": "public",
    }
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        lock = Path(tmp) / "inv.lock"
        lock.write_text(registry.build_inventory(recorded), encoding="utf-8")

        assert registry.inventory_drift(recorded, lock) == []
        drift = registry.inventory_drift(with_new_file, lock)
        assert len(drift) == 1
        assert "proprietary_matchmaker" in drift[0]
        assert drift[0].startswith("NOT IN INVENTORY")


def test_a_classification_change_is_flagged(registry: ModuleType) -> None:
    """Withheld quietly becoming public is the worst silent change; it must not be silent."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        lock = Path(tmp) / "inv.lock"
        lock.write_text(registry.build_inventory({"tools/thing.py": "withheld"}), encoding="utf-8")
        drift = registry.inventory_drift({"tools/thing.py": "public"}, lock)
        assert len(drift) == 1 and drift[0].startswith("CHANGED")
        assert "withheld" in drift[0] and "public" in drift[0]


def test_every_rule_states_a_reason(rules: list) -> None:
    """A rule with no reason cannot be safely changed by whoever inherits it."""
    for rule in rules:
        assert len(rule.reason) > 20, f"{rule.path}: reason is too thin to be useful"


@only_in_the_source_repo
def test_no_rule_is_dead(rules: list, tracked: list[str]) -> None:
    """A rule matching nothing is usually a typo, and a typo here fails open for the real path."""
    dead = []
    for rule in rules:
        if rule.is_subtree:
            if not any(p.startswith(rule.path) for p in tracked):
                dead.append(rule.path)
        elif rule.path not in tracked:
            dead.append(rule.path)
    assert not dead, f"rules matching no tracked path (typo?): {dead}"


def test_classifications_are_from_the_known_set(registry: ModuleType, rules: list) -> None:
    for rule in rules:
        assert rule.classification in registry.CLASSIFICATIONS


def test_the_most_specific_rule_wins(registry: ModuleType) -> None:
    """Exact beats subtree, and the longer subtree beats the shorter one.

    Without this a broad `frontend/` rule could not be narrowed, and every exception would have to
    be spelled out file by file — which is how a registry becomes too tedious to keep accurate.
    """
    Rule = registry.Rule
    rules = [
        Rule("frontend/", "public", "broad"),
        Rule("frontend/src/assets/", "placeholder", "narrower"),
        Rule("frontend/src/assets/lobby/index.ts", "public", "exact"),
    ]
    assert registry.classify("frontend/src/app/App.tsx", rules) == "public"
    assert registry.classify("frontend/src/assets/lobby/crown.png", rules) == "placeholder"
    assert registry.classify("frontend/src/assets/lobby/index.ts", rules) == "public"
    assert registry.classify("backend/app/main.py", rules) is None


def test_a_malformed_registry_refuses_rather_than_defaulting(
    registry: ModuleType, tmp_path: Path
) -> None:
    """Every way of being wrong must fail closed. None of these may fall back to publishing."""
    cases = {
        "unknown classification": '[[rule]]\npath="a/"\nclassification="maybe"\nreason="x"\n',
        "missing reason": '[[rule]]\npath="a/"\nclassification="public"\n',
        "empty reason": '[[rule]]\npath="a/"\nclassification="public"\nreason=""\n',
        "no rules at all": "version = 1\n",
        "duplicate path": (
            '[[rule]]\npath="a/"\nclassification="public"\nreason="x"\n'
            '[[rule]]\npath="a/"\nclassification="withheld"\nreason="y"\n'
        ),
    }
    for name, body in cases.items():
        bad = tmp_path / f"{abs(hash(name))}.toml"
        bad.write_text(body, encoding="utf-8")
        with pytest.raises(registry.RegistryError):
            registry.load_rules(bad)

    with pytest.raises(registry.RegistryError):
        registry.load_rules(tmp_path / "does-not-exist.toml")


def test_the_registry_itself_is_classified(registry: ModuleType, rules: list) -> None:
    """It refused to export until it classified itself, which is the gate working.

    Kept as a test because the bootstrap case is easy to lose in a later refactor, and losing it
    means the file that decides what is public is itself undecided.
    """
    assert registry.classify("export-classification.toml", rules) is not None
