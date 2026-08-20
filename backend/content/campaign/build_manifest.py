"""Build the committed campaign manifest by AUTO-GENERATING each world from its category bank.

Inputs (this package — `backend/content/`, the single canonical content tree):
  - content/bank/*.json            the trivia banks; each campaign category's bank is 100 questions
                                   (40 easy / 40 medium / 20 hard). Non-campaign banks (Money &
                                   Business, Street Smarts) live here too and are ignored by the
                                   build (no plan references them).
  - content/campaign/plan/*.json   the world→category mapping ONLY (`{world, category}`); the old
                                   per-level question_indices / sub-topic titles were retired in
                                   favour of generation, so a plan file no longer authors structure.

Output (same package, loaded at runtime via `Path(__file__).parent`):
  - content/campaign/campaign_levels.json   each level's questions resolved to stable question_keys

This is an offline/build step (run locally, commit the JSON); prod loads the committed artifact and
never rebuilds. The builder re-validates EVERYTHING and exits non-zero on any violation — a broken
manifest must fail loudly here, never ship. Run with `python -m content.campaign.build_manifest`
(from backend/) or `python -m app.jobs.run build_campaign`.

DESIGN — intermixed sub-topics + a monotonic difficulty ramp (the deliberate v2 structure):
  Each world is its category (world keys are LOCKED — cosmetics/achievements couple on the
  `world:<key>` requirement). Within a world the 10 levels are NOT sub-topic silos: questions are
  assigned to levels purely by DIFFICULTY, drawn from across the WHOLE category bank via a
  DETERMINISTIC seeded shuffle (seeded by the category name, so the committed manifest is stable +
  reproducible). Shuffling the full bank before dealing spreads sub-topics across every level
  instead of clustering them.

  Difficulty ramps monotonically by level (early levels easiest, the boss L10 hardest), using
  exactly each category's 40 easy / 40 medium / 20 hard. The per-level mix is `RAMP` below; it is
  validated to sum to 40E/40M/20H and to be non-decreasing by difficulty score (medium + 2*hard),
  boss hardest.
"""

from __future__ import annotations

import hashlib
import json
import random
import sys
from pathlib import Path
from typing import Any

from content.campaign import spec as spec_mod
from content.campaign.keys import question_key

# build_manifest.py → campaign/ → content/(the package). All content lives in this package tree.


def _content_root() -> Path:
    """The content package being built. Topology and bank both come from here."""
    from app.core.config import settings

    return settings.content_root


def _bank_dir(content_root: Path | None = None) -> Path:
    return (content_root or _content_root()) / "bank"


def _out_path() -> Path:
    """The built manifest belongs to the content package that produced it."""
    return spec_mod.levels_path(_content_root())


DIFFICULTIES = spec_mod.DIFFICULTIES


class ManifestError(Exception):
    """A bank violates a hard invariant against the declared spec — the build must abort."""


def _seed_for(category: str) -> int:
    """A stable seed derived from the category name (sha256), so the committed manifest is
    reproducible: same category → same shuffle → identical generated levels every build."""
    digest = hashlib.sha256(category.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def _load_banks_by_category(content_root: Path | None = None) -> dict[str, list[dict[str, Any]]]:
    banks: dict[str, list[dict[str, Any]]] = {}
    for f in sorted(_bank_dir(content_root).glob("*.json")):
        rows = json.loads(f.read_text(encoding="utf-8"))
        cat = rows[0]["category"]
        banks[cat] = rows
    return banks


def _build_world(
    world: str, category: str, bank: list[dict[str, Any]], spec: spec_mod.CampaignSpec
) -> dict[str, Any]:
    """Auto-generate a world's levels from its bank by the SPEC's ramp + a category-seeded shuffle.

    Indices for each difficulty are taken in STABLE bank order, then deterministically shuffled
    (seeded by category) so questions from across the whole bank — i.e. across sub-topics — are
    interleaved before being dealt level by level. The per-level question order is shuffled too, so
    a level is a genuine mix rather than a contiguous bank slice.
    """
    # Bucket bank indices by difficulty, preserving stable bank order within each bucket.
    by_diff: dict[str, list[int]] = {d: [] for d in DIFFICULTIES}
    for i, row in enumerate(bank):
        d = row["difficulty"]
        if d not in by_diff:
            raise ManifestError(f"{world}: bank index {i} has unknown difficulty {d!r}")
        by_diff[d].append(i)

    needed = spec.bank_requirement()
    for d in DIFFICULTIES:
        have = len(by_diff[d])
        if have != needed[d]:
            raise ManifestError(
                f"{world}: bank has {have} {d} questions but this content package's campaign spec "
                f"needs {needed[d]} (required per world: {needed})"
            )

    rng = random.Random(_seed_for(category))
    # Shuffle each difficulty bucket independently (deterministic) → sub-topics interleave.
    for d in DIFFICULTIES:
        rng.shuffle(by_diff[d])

    cursors = {d: 0 for d in DIFFICULTIES}
    seen_key: set[str] = set()
    used_idx: set[int] = set()
    levels_out: list[dict[str, Any]] = []
    for level_number, mix in enumerate(spec.ramp, start=1):
        counts = dict(zip(DIFFICULTIES, mix, strict=True))
        level_indices: list[int] = []
        for d in DIFFICULTIES:
            n = counts[d]
            level_indices.extend(by_diff[d][cursors[d] : cursors[d] + n])
            cursors[d] += n
        # Mix the per-level order (so a level isn't easy-block then medium-block then hard-block).
        rng.shuffle(level_indices)

        questions: list[dict[str, str]] = []
        mix_count = {"easy": 0, "medium": 0, "hard": 0}
        for idx in level_indices:
            if idx in used_idx:
                raise ManifestError(f"{world}: bank index {idx} dealt to more than one level")
            used_idx.add(idx)
            row = bank[idx]
            key = question_key(category, row["question"])
            if key in seen_key:
                raise ManifestError(f"{world}: duplicate question_key {key} (idx {idx})")
            seen_key.add(key)
            mix_count[row["difficulty"]] += 1
            questions.append({"key": key, "difficulty": row["difficulty"]})

        if mix_count != {"easy": mix[0], "medium": mix[1], "hard": mix[2]}:
            raise ManifestError(f"{world} L{level_number}: built mix {mix_count} != ramp {mix}")
        levels_out.append(
            {
                "level_number": level_number,
                "title": spec.level_titles[level_number - 1],
                "is_boss": level_number == spec.levels_per_world,
                "difficulty_mix": mix_count,
                "questions": questions,
            }
        )

    if used_idx != set(range(len(bank))):
        missing = sorted(set(range(len(bank))) - used_idx)
        raise ManifestError(
            f"{world}: levels must cover all {len(bank)} questions; missing {missing}"
        )

    # Group levels into difficulty-band chapters (arcs).
    out_arcs: list[dict[str, Any]] = []
    for arc in spec.arcs:
        arc_levels = [
            lvl for lvl in levels_out if arc.first_level <= lvl["level_number"] <= arc.last_level
        ]
        out_arcs.append({"name": arc.name, "levels": arc_levels})

    return {"world": world, "category": category, "arcs": out_arcs}


def build(
    spec: spec_mod.CampaignSpec | None = None, content_root: Path | None = None
) -> dict[str, Any]:
    """Build the manifest for the active content package (or an explicitly supplied one).

    The world list, level count, ramp, arcs and titles all come from the package's own
    campaign/config.json — this function knows the ALGORITHM, never the topology.

    `content_root` exists so a package can be validated BEFORE it becomes the active one — the
    retrieval step (scripts/fetch_private_content.py) has to verify a freshly downloaded package
    while `settings.content_root` still points at the previous deploy's copy, or at nothing at all.
    Defaults to the active package, so every existing caller is unchanged.
    """
    root = content_root or _content_root()
    spec = spec or spec_mod.load(root)
    banks = _load_banks_by_category(root)
    worlds = []
    for w in spec.worlds:
        bank = banks.get(w.category)
        if bank is None:
            raise ManifestError(f"{w.world}: no bank file for category {w.category!r}")
        worlds.append(_build_world(w.world, w.category, bank, spec))
    return {"version": 1, "worlds": worlds}


def main() -> int:
    try:
        manifest = build()
    except (ManifestError, spec_mod.CampaignSpecError) as exc:
        print(f"campaign manifest build FAILED: {exc}", file=sys.stderr)
        return 1
    out = _out_path()
    out.parent.mkdir(parents=True, exist_ok=True)
    # newline="\n" is load-bearing, not style. Python's text mode otherwise takes the HOST's
    # newline, so the same inputs gave a CRLF manifest on Windows and an LF one on Linux —
    # semantically
    # identical, two different SHA-256s. This artifact's hash is used as release identity and is
    # compared byte-for-byte against production, so "same content, different hash depending on who
    # built it" is a defect. LF is canonical because that is what Render produces.
    out.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    n_levels = sum(len(a["levels"]) for w in manifest["worlds"] for a in w["arcs"])
    print(f"wrote {out} — {len(manifest['worlds'])} worlds, {n_levels} levels")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
