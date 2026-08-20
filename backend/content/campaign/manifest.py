"""Runtime access to the committed campaign manifest (the level ladder content).

Pure / no DB: this module only reads the static `campaign_levels.json` artifact (built by
`build_manifest.py`). Progress overlay (locked/best/clear) lives in the campaign service, which
combines this static ladder with the player's `user_campaign_progress` rows. Question keys are
resolved to live DB questions in the service via `fetch_bank` + `content.campaign.keys`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from content.campaign import spec as spec_mod


def _manifest_path() -> Path:
    """The built campaign for the ACTIVE content package.

    Topology is a property of the content, not of this module: a package declares its own worlds,
    level count and ramp in campaign/config.json and ships the built campaign/levels.json beside
    its bank. Nothing here assumes one particular corpus.
    """
    from app.core.config import settings

    return spec_mod.levels_path(settings.content_root)


def levels_per_world() -> int:
    from app.core.config import settings

    return spec_mod.load(settings.content_root).levels_per_world


def questions_per_level() -> int:
    from app.core.config import settings

    return spec_mod.load(settings.content_root).questions_per_level


@dataclass(frozen=True)
class CampaignLevel:
    world: str  # short display name, e.g. "Science"
    category: str  # canonical bank category, e.g. "Science & Nature"
    arc_name: str
    level_number: int  # 1..LEVELS_PER_WORLD
    title: str
    is_boss: bool
    difficulty_mix: dict[str, int]  # {"easy": n, "medium": n, "hard": n}
    question_keys: tuple[str, ...]  # QUESTIONS_PER_LEVEL stable keys, in serve order


@dataclass(frozen=True)
class CampaignArc:
    name: str
    levels: tuple[CampaignLevel, ...]


@dataclass(frozen=True)
class CampaignWorld:
    world: str
    category: str
    arcs: tuple[CampaignArc, ...]

    @property
    def levels(self) -> tuple[CampaignLevel, ...]:
        return tuple(lvl for arc in self.arcs for lvl in arc.levels)


@lru_cache(maxsize=1)
def load_manifest() -> tuple[CampaignWorld, ...]:
    """Parse and cache the manifest. Cached for the process — it is static, committed content."""
    raw = json.loads(_manifest_path().read_text(encoding="utf-8"))
    worlds: list[CampaignWorld] = []
    for w in raw["worlds"]:
        arcs: list[CampaignArc] = []
        for arc in w["arcs"]:
            levels = tuple(
                CampaignLevel(
                    world=w["world"],
                    category=w["category"],
                    arc_name=arc["name"],
                    level_number=lvl["level_number"],
                    title=lvl["title"],
                    is_boss=lvl["is_boss"],
                    difficulty_mix=dict(lvl["difficulty_mix"]),
                    question_keys=tuple(q["key"] for q in lvl["questions"]),
                )
                for lvl in arc["levels"]
            )
            arcs.append(CampaignArc(name=arc["name"], levels=levels))
        worlds.append(CampaignWorld(world=w["world"], category=w["category"], arcs=tuple(arcs)))
    return tuple(worlds)


def worlds() -> tuple[CampaignWorld, ...]:
    return load_manifest()


def get_world(world: str) -> CampaignWorld | None:
    return next((w for w in load_manifest() if w.world == world), None)


def get_level(world: str, level_number: int) -> CampaignLevel | None:
    w = get_world(world)
    if w is None:
        return None
    return next((lvl for lvl in w.levels if lvl.level_number == level_number), None)
