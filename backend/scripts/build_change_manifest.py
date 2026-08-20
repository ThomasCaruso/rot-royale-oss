"""Build (and validate) a change-detection manifest by pixel-diffing the delivered image pairs.

    uv run python scripts/build_change_manifest.py <dir> [--out manifest.json] [--strict]

The art brief (content/change/BRIEF.md) deliberately does NOT ask for bounding boxes. Coordinates
guessed by eye — or by a model — are the most error-prone part of this content type, and a wrong
bbox is invisible until a player taps the right spot and is told they missed. Diffing the pair gives
the exact region, and the same diff doubles as the quality gate: a pair produced by two independent
generations (rather than one image edited in place) differs EVERYWHERE, which shows up immediately
as a diff spanning the whole frame.

Rejections are reported per pair and exit non-zero, so a bad delivery is loud rather than silently
ingested — same contract as the trivia and estimate ingests (CLAUDE.md §5a, §5d).
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageChops

# A pixel counts as changed above this per-channel difference. Non-zero so PNG re-encoding or a
# resample that is not bit-exact cannot register as a change; low enough that a genuine edit of a
# similarly-toned object still registers.
DIFF_THRESHOLD = 24

# Authored tiers live next to the brief they were assigned in.
_DEFAULT_DIFFICULTY = Path(__file__).resolve().parents[1] / "content" / "change" / "difficulty.json"

# The mask is analysed at this width. Connected-component labelling on a full 1024px frame is
# needlessly slow, and the questions being asked (how many regions, how big, where) are all
# scale-invariant.
ANALYSIS_WIDTH = 256

# Brief §4/§5: a change smaller than this is not findable at the ~325px the image renders at.
MIN_REGION_FRAC = 0.04
# Brief §4: nothing in the outer 5% — taps near the border are awkward.
EDGE_MARGIN = 0.05
# A single edited region should not sprawl across the frame; this catches "two generations".
MAX_REGION_FRAC = 0.45
# Share of the changed pixels' own bounding box that must actually be changed. A real edit fills a
# meaningful part of its box; a frame-wide re-render leaves a sparse dusting across a huge box.
MIN_FILL = 0.02


@dataclass
class Pair:
    key: str
    width: int
    height: int
    bbox: dict[str, float] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems


def _changed_mask(base: Image.Image, altered: Image.Image) -> tuple[list[list[bool]], int, int]:
    """Boolean mask (row-major) of changed pixels, computed at ANALYSIS_WIDTH."""
    diff = ImageChops.difference(base.convert("RGB"), altered.convert("RGB"))
    w = min(ANALYSIS_WIDTH, diff.width)
    h = max(1, round(diff.height * w / diff.width))
    # BOX averaging keeps a small high-contrast edit visible after downscaling instead of letting
    # a nearest-neighbour sample miss it entirely.
    small = diff.resize((w, h), Image.Resampling.BOX).convert("L")
    px = small.tobytes()  # "L" → exactly one byte per pixel, row-major
    mask = [[px[y * w + x] >= DIFF_THRESHOLD for x in range(w)] for y in range(h)]
    return mask, w, h


def analyse_pair(key: str, base_path: Path, altered_path: Path) -> Pair:
    base = Image.open(base_path)
    altered = Image.open(altered_path)
    pair = Pair(key=key, width=base.width, height=base.height)

    if base.size != altered.size:
        pair.problems.append(f"dimensions differ: base {base.size} vs altered {altered.size}")
        return pair

    mask, w, h = _changed_mask(base, altered)
    changed = [(x, y) for y in range(h) for x in range(w) if mask[y][x]]
    if not changed:
        pair.problems.append("the two images are identical — no change to find")
        return pair

    # Locality is measured as "is every changed pixel inside one compact area", NOT as connectivity.
    # A single real edit is often disconnected — an object plus its shadow, a spotty object, or a
    # deliberately distributed change like one run of string lights going dark — and an
    # is-it-contiguous test rejects exactly those. The size cap below is what actually catches the
    # failure that matters (two independent generations, which differ across the whole frame).
    xs = [p[0] for p in changed]
    ys = [p[1] for p in changed]
    # +1 on the far edge: a single-cell region still has real extent.
    x0, x1 = min(xs) / w, (max(xs) + 1) / w
    y0, y1 = min(ys) / h, (max(ys) + 1) / h
    bw, bh = x1 - x0, y1 - y0

    fill = len(changed) / max(1.0, (bw * w) * (bh * h))
    if fill < MIN_FILL:
        pair.problems.append(
            f"change is a sparse dusting over {bw:.0%}x{bh:.0%} of the frame (only {fill:.1%} of "
            f"that area actually differs) — the pair looks like two separate generations rather "
            f"than one image edited in place (see BRIEF.md §3)"
        )
    if max(bw, bh) > MAX_REGION_FRAC:
        pair.problems.append(
            f"changed region spans {bw:.0%}x{bh:.0%} of the frame — too large to be one edit"
        )
    if max(bw, bh) < MIN_REGION_FRAC:
        pair.problems.append(
            f"changed region is {bw:.1%}x{bh:.1%} of the frame — under the {MIN_REGION_FRAC:.0%} "
            f"floor, it will not be findable at the ~325px this renders at"
        )
    if x0 < EDGE_MARGIN or y0 < EDGE_MARGIN or x1 > 1 - EDGE_MARGIN or y1 > 1 - EDGE_MARGIN:
        pair.problems.append(
            f"changed region touches the outer {EDGE_MARGIN:.0%} of the frame "
            f"(x {x0:.2f}-{x1:.2f}, y {y0:.2f}-{y1:.2f})"
        )

    pair.bbox = {
        "x": round(x0, 4),
        "y": round(y0, 4),
        "w": round(bw, 4),
        "h": round(bh, 4),
    }
    return pair


def collect(directory: Path) -> list[tuple[str, Path, Path]]:
    """(key, base, altered) for every *_base.png with a matching *_altered.png."""
    found = []
    for base in sorted(directory.glob("*_base.png")):
        key = base.name[: -len("_base.png")]
        altered = base.with_name(f"{key}_altered.png")
        if not altered.exists():
            print(f"  MISSING PAIR {key}: no {altered.name}", file=sys.stderr)
            continue
        found.append((key, base, altered))
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("directory", help="folder holding <key>_base.png / <key>_altered.png")
    ap.add_argument(
        "--out", default=None, help="manifest path (default: <directory>/manifest.json)"
    )
    ap.add_argument(
        "--url-prefix",
        default="/assets/change",
        help="URL prefix the images are served under (default: /assets/change)",
    )
    ap.add_argument(
        "--assets",
        default=None,
        help=(
            "public assets dir the URLs resolve against (e.g. frontend/public/assets/change). "
            "When given, every referenced file must EXIST and match the master's dimensions."
        ),
    )
    ap.add_argument(
        "--difficulty",
        default=None,
        help="JSON map of key -> easy|medium|hard (default: content/change/difficulty.json)",
    )
    ap.add_argument(
        "--strict",
        action="store_true",
        help="write nothing unless every pair passes (default: write the passing ones)",
    )
    args = ap.parse_args()

    directory = Path(args.directory)
    if not directory.is_dir():
        raise SystemExit(f"build_change_manifest: {directory} is not a directory")

    # Difficulty is authored alongside the brief, not derived from the pixels — it is an attention
    # property (is this on the subject or in the background?), which no diff can measure.
    diff_path = Path(args.difficulty) if args.difficulty else _DEFAULT_DIFFICULTY
    tiers: dict[str, str] = {}
    if diff_path.exists():
        tiers = {
            k: v
            for k, v in json.loads(diff_path.read_text(encoding="utf-8")).items()
            if not k.startswith("_")
        }

    pairs = [analyse_pair(k, b, a) for k, b, a in collect(directory)]
    if not pairs:
        raise SystemExit(f"build_change_manifest: no *_base.png/*_altered.png pairs in {directory}")

    # Two failures that are otherwise SILENT in production, both worth catching here rather than
    # from a player report:
    #   - a URL that does not resolve → every player that day stares at an empty box for the whole
    #     time limit and takes a forced miss, with no error anywhere;
    #   - a shipped file whose dimensions differ from the master the bbox was measured on → the
    #     container's aspect ratio no longer matches the image, object-fit crops, and every tap
    #     lands somewhere other than where the player aimed.
    if args.assets:
        assets = Path(args.assets)
        for p in pairs:
            if not p.ok:
                continue
            for role in ("base", "altered"):
                shipped = assets / f"{p.key}_{role}.png"
                alternatives = sorted(assets.glob(f"{p.key}_{role}.*"))
                if not shipped.exists() and alternatives:
                    shipped = alternatives[0]
                if not shipped.exists():
                    p.problems.append(
                        f"{role} asset is not in {assets} — a URL that 404s costs every player "
                        f"that round, silently"
                    )
                    continue
                with Image.open(shipped) as im:
                    if (im.width, im.height) != (p.width, p.height):
                        p.problems.append(
                            f"shipped {role} is {im.width}x{im.height} but the master (and so the "
                            f"measured bbox) is {p.width}x{p.height} — every tap would be offset"
                        )

    good = [p for p in pairs if p.ok]
    bad = [p for p in pairs if not p.ok]

    for p in good:
        b = p.bbox
        tier = tiers.get(p.key, "unbanded")
        print(f"  OK  {p.key} [{tier}]: bbox x={b['x']} y={b['y']} w={b['w']} h={b['h']}")
    for p in bad:
        for reason in p.problems:
            print(f"  REJECTED {p.key}: {reason}", file=sys.stderr)

    print(f"\nbuild_change_manifest: {len(good)} usable, {len(bad)} rejected, {len(pairs)} total")

    if bad and args.strict:
        print("strict mode: nothing written", file=sys.stderr)
        return 1

    out = Path(args.out) if args.out else directory / "manifest.json"
    manifest = {
        "version": 1,
        "items": [
            {
                "key": p.key,
                "base_url": f"{args.url_prefix}/{p.key}_base.png",
                "altered_url": f"{args.url_prefix}/{p.key}_altered.png",
                "width": p.width,
                "height": p.height,
                "bbox": p.bbox,
                **({"difficulty": tiers[p.key]} if p.key in tiers else {}),
            }
            for p in good
        ],
    }
    out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(good)} item(s))")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
