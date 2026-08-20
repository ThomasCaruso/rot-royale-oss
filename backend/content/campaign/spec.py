"""Campaign topology, as CONTENT rather than code.

The shape of the campaign — how many worlds, how long each is, how difficulty ramps — used to be
constants in `build_manifest.py`. That made the engine inseparable from one particular corpus: a
content root with 30 questions could not express a campaign at all, so the whole mode became
unrunnable the moment the production bank moved behind ROT_CONTENT_DIR.

The topology is a property of a content package, not of the application. A private production root
declares 6 worlds x 10 levels x 10 questions with a 40/40/20 spread; the committed synthetic root
declares something small enough to actually ship. Same engine, same builder, same validation — a
different content package simply describes a different campaign.

Deliberately NOT solved with `SAMPLE_LEVELS_PER_WORLD` / `PRODUCTION_LEVELS_PER_WORLD` constants:
that would recreate the public/private split inside the source tree, which is the thing this whole
phase exists to remove.

    <content root>/campaign/config.json    the spec (this module validates it)
    <content root>/campaign/levels.json    the built manifest (build_manifest.py emits it)
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DIFFICULTIES = ("easy", "medium", "hard")


class CampaignSpecError(Exception):
    """The campaign spec violates a hard invariant — the build (or load) must abort."""


@dataclass(frozen=True)
class WorldSpec:
    world: str  # short display name, e.g. "Science"
    category: str  # canonical bank category, e.g. "Science & Nature"


@dataclass(frozen=True)
class ArcSpec:
    name: str
    first_level: int  # inclusive, 1-based
    last_level: int  # inclusive


@dataclass(frozen=True)
class CampaignSpec:
    levels_per_world: int
    questions_per_level: int
    worlds: tuple[WorldSpec, ...]
    ramp: tuple[tuple[int, int, int], ...]  # per level: (easy, medium, hard)
    arcs: tuple[ArcSpec, ...]
    level_titles: tuple[str, ...]
    # What "clear" and "perfect" mean for THIS package. They were absolute constants (7 and 10),
    # which silently assumed ten questions per level: at any other width "clear" is either trivial
    # or unreachable, and the mode stops working. Production declares 7 and 10 and behaves exactly
    # as before; a narrower package declares its own.
    clear_threshold: int
    strong_threshold: int
    perfect_threshold: int

    @property
    def questions_per_world(self) -> int:
        return self.levels_per_world * self.questions_per_level

    def bank_requirement(self) -> dict[str, int]:
        """How many of each difficulty a world's bank must contain — the ramp's column totals."""
        return {d: sum(mix[k] for mix in self.ramp) for k, d in enumerate(DIFFICULTIES)}

    def arc_for(self, level_number: int) -> ArcSpec:
        for arc in self.arcs:
            if arc.first_level <= level_number <= arc.last_level:
                return arc
        raise CampaignSpecError(f"no arc covers level {level_number}")


def difficulty_score(mix: tuple[int, int, int]) -> int:
    """Scalar ordering for level difficulty: medium counts 1, hard counts 2."""
    _easy, medium, hard = mix
    return medium + 2 * hard


def validate(spec: CampaignSpec) -> None:
    """Enforce every invariant the hard-coded RAMP used to guarantee.

    These are the same rules as before, now checked against whatever the content package declares
    rather than against a table in this file: rows match the level count, each row sums to the
    questions per level, difficulty never decreases, and the final level is the single hardest.
    """
    if spec.levels_per_world < 1 or spec.questions_per_level < 1:
        raise CampaignSpecError("levels_per_world and questions_per_level must be >= 1")
    if not spec.worlds:
        raise CampaignSpecError("spec declares no worlds")
    if len({w.category for w in spec.worlds}) != len(spec.worlds):
        raise CampaignSpecError("two worlds share a category")

    if len(spec.ramp) != spec.levels_per_world:
        raise CampaignSpecError(
            f"ramp has {len(spec.ramp)} rows but levels_per_world is {spec.levels_per_world}"
        )
    for i, mix in enumerate(spec.ramp, start=1):
        if len(mix) != 3:
            raise CampaignSpecError(f"ramp L{i} must be [easy, medium, hard], got {mix}")
        if any(n < 0 for n in mix):
            raise CampaignSpecError(f"ramp L{i} has a negative count: {mix}")
        if sum(mix) != spec.questions_per_level:
            raise CampaignSpecError(
                f"ramp L{i} sums to {sum(mix)}, expected {spec.questions_per_level}"
            )

    scores = [difficulty_score(m) for m in spec.ramp]
    if any(scores[i] > scores[i + 1] for i in range(len(scores) - 1)):
        raise CampaignSpecError(f"ramp difficulty must be non-decreasing; scores={scores}")
    if scores[-1] != max(scores) or scores.count(max(scores)) != 1:
        raise CampaignSpecError(f"the last level must be the single hardest; scores={scores}")

    if not (
        1
        <= spec.clear_threshold
        <= spec.strong_threshold
        <= spec.perfect_threshold
        <= spec.questions_per_level
    ):
        raise CampaignSpecError(
            f"thresholds must satisfy 1 <= clear ({spec.clear_threshold}) <= strong "
            f"({spec.strong_threshold}) <= perfect ({spec.perfect_threshold}) <= "
            f"questions_per_level ({spec.questions_per_level})"
        )
    if len(spec.level_titles) != spec.levels_per_world:
        raise CampaignSpecError(
            f"{len(spec.level_titles)} level titles for {spec.levels_per_world} levels"
        )
    covered = {n for arc in spec.arcs for n in range(arc.first_level, arc.last_level + 1)}
    if covered != set(range(1, spec.levels_per_world + 1)):
        raise CampaignSpecError("arcs must cover every level exactly once, with no gaps")


def from_dict(data: dict[str, Any]) -> CampaignSpec:
    try:
        spec = CampaignSpec(
            levels_per_world=int(data["levels_per_world"]),
            questions_per_level=int(data["questions_per_level"]),
            worlds=tuple(WorldSpec(w["world"], w["category"]) for w in data["worlds"]),
            ramp=tuple(tuple(int(n) for n in row) for row in data["ramp"]),  # type: ignore[misc]
            arcs=tuple(
                ArcSpec(a["name"], int(a["first_level"]), int(a["last_level"]))
                for a in data["arcs"]
            ),
            level_titles=tuple(str(t) for t in data["level_titles"]),
            clear_threshold=int(data["clear_threshold"]),
            strong_threshold=int(data["strong_threshold"]),
            perfect_threshold=int(data["perfect_threshold"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise CampaignSpecError(f"malformed campaign spec: {exc}") from exc
    validate(spec)
    return spec


def spec_path(content_root: Path) -> Path:
    return content_root / "campaign" / "config.json"


def levels_path(content_root: Path) -> Path:
    return content_root / "campaign" / "levels.json"


def load(content_root: Path) -> CampaignSpec:
    """Read and validate the campaign spec for a content root."""
    path = spec_path(content_root)
    if not path.is_file():
        raise CampaignSpecError(
            f"no campaign spec at {path.name} for this content root — a content package must "
            f"declare its own campaign topology"
        )
    return from_dict(json.loads(path.read_text(encoding="utf-8")))
