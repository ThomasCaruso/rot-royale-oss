"""Read export-classification.toml and decide what every tracked path is allowed to be.

The registry DECLARES intent. `export_public.py` IMPLEMENTS it. This module is only the first half,
and keeping the two apart is deliberate: the exporter's answer is computed from the manifest, the
exclusion list and the docs allowlist, and the export then refuses unless that computed answer
matches what was declared here. A declaration nobody checks is a comment; a check with nothing to
check against cannot notice a file that was never considered.

Two failures are worth naming separately, because they mean different things:

  UNCLASSIFIED  a tracked path matches no rule. Nobody decided. This is the case the registry
                exists for — it is what happens when new code lands and no one thinks about
                publication, and the answer must be "stop", not "publish".

  MISMATCH      a rule says one thing and the exporter does another. Someone decided, and the
                machinery disagrees. Either the rule is stale or the exporter has a bug; either way
                publishing is the wrong move until a human says which.
"""

from __future__ import annotations

import pathlib
import subprocess
import tomllib
from dataclasses import dataclass

REPO = pathlib.Path(__file__).resolve().parents[1]
REGISTRY = REPO / "export-classification.toml"

CLASSIFICATIONS = frozenset({"public", "withheld", "placeholder"})


@dataclass(frozen=True)
class Rule:
    path: str
    classification: str
    reason: str

    @property
    def is_subtree(self) -> bool:
        return self.path.endswith("/")


class RegistryError(Exception):
    """The registry itself is malformed. Never a reason to fall back to publishing."""


def load_rules(registry: pathlib.Path | None = None) -> list[Rule]:
    path = registry or REGISTRY
    if not path.is_file():
        raise RegistryError(f"{path} is missing — refusing to classify anything without it")
    data = tomllib.loads(path.read_text(encoding="utf-8"))

    rules: list[Rule] = []
    seen: set[str] = set()
    for raw in data.get("rule", []):
        for field in ("path", "classification", "reason"):
            if not str(raw.get(field, "")).strip():
                raise RegistryError(f"rule {raw.get('path', '?')!r} is missing {field}")
        if raw["classification"] not in CLASSIFICATIONS:
            raise RegistryError(
                f"rule {raw['path']!r} has unknown classification {raw['classification']!r}; "
                f"expected one of {sorted(CLASSIFICATIONS)}"
            )
        if raw["path"] in seen:
            # Two rules for one path means the answer depends on file order, which is not an
            # answer. Better to refuse than to pick one silently.
            raise RegistryError(f"duplicate rule for {raw['path']!r}")
        seen.add(raw["path"])
        rules.append(Rule(raw["path"], raw["classification"], raw["reason"].strip()))

    if not rules:
        raise RegistryError(f"{path} declares no rules")
    return rules


def classify(rel: str, rules: list[Rule]) -> str | None:
    """The declared classification for one repo-relative path, or None if nothing matches.

    Exact rules beat subtree rules; between subtrees the longest prefix wins, so a broad rule can
    be narrowed by a more specific one without either having to know about the other.
    """
    best: Rule | None = None
    for rule in rules:
        if rule.is_subtree:
            if rel.startswith(rule.path) and (best is None or len(rule.path) > len(best.path)):
                best = rule
        elif rel == rule.path:
            return rule.classification
    return best.classification if best else None


def tracked_paths(repo: pathlib.Path | None = None) -> list[str]:
    out = subprocess.run(
        ["git", "ls-files"],
        cwd=repo or REPO,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return [line for line in out.splitlines() if line]


INVENTORY = REPO / "export-classification.lock"

INVENTORY_HEADER = """\
# GENERATED — do not edit by hand. Regenerate with:
#     python scripts/export_classification.py --write-inventory
#
# Every tracked path and what will happen to it on the next export.
#
# Subtree rules alone cannot do this job. `backend/` is classified public, correctly, because it is
# the application — but that means a NEW file inside it inherits "public" without anyone deciding.
# A proprietary matchmaker dropped into backend/app/services/ would have been published on the next
# merge, and no rule would have been violated.
#
# So the rules stay coarse and reviewable, and this file makes every consequence of them explicit.
# A new source file shows up here as one added line saying `public`, in the diff, where a reviewer
# reads it. That is the whole mechanism: the decision is cheap to make and impossible to skip.
#
# CI fails when this file disagrees with the rules, so it cannot quietly go stale.
"""


def build_inventory(actual: dict[str, str]) -> str:
    """The committed record: one line per tracked path, sorted, `classification<TAB>path`."""
    lines = [f"{cls}\t{rel}" for rel, cls in sorted(actual.items())]
    return INVENTORY_HEADER + "\n".join(lines) + "\n"


def read_inventory(path: pathlib.Path | None = None) -> dict[str, str]:
    p = path or INVENTORY
    if not p.is_file():
        raise RegistryError(f"{p} is missing — regenerate it with --write-inventory")
    out: dict[str, str] = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        cls, _, rel = line.partition("\t")
        if not rel:
            raise RegistryError(f"malformed inventory line: {line!r}")
        out[rel] = cls
    return out


def inventory_drift(actual: dict[str, str], path: pathlib.Path | None = None) -> list[str]:
    """Human-readable differences between the committed inventory and reality. Empty = in step."""
    recorded = read_inventory(path)
    problems: list[str] = []
    for rel in sorted(set(actual) - set(recorded)):
        problems.append(f"NOT IN INVENTORY: {rel} (would be {actual[rel]})")
    for rel in sorted(set(recorded) - set(actual)):
        problems.append(f"STALE INVENTORY ENTRY: {rel} no longer tracked")
    for rel in sorted(set(actual) & set(recorded)):
        if actual[rel] != recorded[rel]:
            problems.append(
                f"CHANGED: {rel} recorded as {recorded[rel]}, would now be {actual[rel]}"
            )
    return problems


def audit(
    actual: dict[str, str], rules: list[Rule] | None = None
) -> tuple[list[str], list[tuple[str, str, str]]]:
    """Compare what the exporter WILL do against what the registry SAYS.

    `actual` maps repo-relative path -> classification the exporter arrived at on its own.
    Returns (unclassified paths, [(path, declared, actual) mismatches]).
    """
    rules = rules if rules is not None else load_rules()
    unclassified: list[str] = []
    mismatched: list[tuple[str, str, str]] = []
    for rel, got in sorted(actual.items()):
        declared = classify(rel, rules)
        if declared is None:
            unclassified.append(rel)
        elif declared != got:
            mismatched.append((rel, declared, got))
    return unclassified, mismatched


def _main() -> int:
    """`--write-inventory` regenerates the committed record. Nothing else: this module decides
    nothing on its own, it only reports what the exporter's own logic arrives at."""
    import argparse
    import sys

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write-inventory", action="store_true")
    args = ap.parse_args()
    if not args.write_inventory:
        ap.print_help()
        return 2

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import export_public

    private, _, _ = export_public.load_manifest()
    actual = {rel: export_public.treatment(rel, private) for rel in tracked_paths()}

    unclassified, mismatched = audit(actual)
    if unclassified or mismatched:
        # Writing an inventory over an unclassified tree would record the omission as if it were a
        # decision, which is the one thing this whole mechanism exists to prevent.
        print("refusing to write: classify these first", file=sys.stderr)
        for rel in unclassified[:20]:
            print(f"  UNCLASSIFIED: {rel}", file=sys.stderr)
        for rel, d, a in mismatched[:20]:
            print(f"  MISMATCH: {rel} declared {d}, would be {a}", file=sys.stderr)
        return 1

    # What is ABOUT to be recorded as newly publishable, printed before it is written.
    #
    # The operating rule this serves: never regenerate the lock mechanically and approve the diff
    # without reading the new `public` entries. That rule is the last protection against
    # open-sourcing future gameplay work by accident, and it depends on a human actually looking —
    # so the thing to look at is put in front of them here, at the one moment they are guaranteed
    # to be present, rather than left to be noticed in a diff among a thousand other lines.
    #
    # No automation can infer business sensitivity from code. This does not try. It only makes the
    # decision impossible to make silently.
    try:
        previously = read_inventory()
    except RegistryError:
        previously = {}
    newly_public = sorted(
        rel for rel, cls in actual.items() if cls == "public" and previously.get(rel) != "public"
    )

    INVENTORY.write_text(build_inventory(actual), encoding="utf-8", newline="\n")
    counts: dict[str, int] = {}
    for cls in actual.values():
        counts[cls] = counts.get(cls, 0) + 1
    print(f"wrote {INVENTORY.name}: {len(actual)} paths {counts}")

    if newly_public and previously:
        print(f"\n  {len(newly_public)} path(s) are newly PUBLIC — read these before committing:")
        for rel in newly_public[:40]:
            print(f"    + {rel}")
        if len(newly_public) > 40:
            print(f"    ... and {len(newly_public) - 40} more")
        print(
            "\n  Anything here that is meant to stay proprietary belongs in a `withheld` subtree,\n"
            "  or needs a rule of its own, BEFORE this is merged."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
