"""Turn a generated card render into a Daily Royale hero plate.

The home hero card renders ONE painted image as its whole face — crown, podium, halo, sparkles and
the colour sweep, with a deliberately empty left side for the copy and CTA (see
`ThemeArt.dailyCard` in theme/tokens.ts and `screens/home/hero/MonoDailyCard.tsx`). This script is
how those files are made, and it exists because the same operation has now been done four times by
hand (Starter, Daylight, Bubblegum, Midnight Arcade) and hand-repeating it is how the plates drift
apart.

    uv run python scripts/prep_hero_plate.py <source.png> <theme-id> [--dot X,Y,R]

Writes public/assets/themes/starter/background-hero-card-<theme-id>.jpg.

WHAT IT DOES, AND WHY EACH STEP IS THERE
----------------------------------------
1. **Find the card inside the render.** These sources come out of an image generator as a rounded
   card floating on a flat margin. The margin is sampled from the corner and the card's bounds are
   the first pixels that differ from it.

2. **Inset past the border and the corner arc.** The card carries a hairline stroke, and its corners
   are rounded. A rectangle inset by d clears an arc of radius r only when d >= r(1 - 1/sqrt2)
   ~= 0.293r, so too small an inset ships dark nicks in the plate's corners — nearly invisible in a
   preview and permanent once out.
   The inset is therefore MEASURED, not assumed: it starts at 20 (which cleared the first three
   sources) and climbs until all four corners match the art around them. Apex needed 28, because its
   render came with a noticeably rounder card. Trusting the old constant would have shipped the
   nicks.

3. **Resize to 900 wide.** Height follows the source's own inner aspect — it is not forced. The
   shipped plates run 657px painted (Starter/Daylight/Midnight, 1.370:1) and 665px (Bubblegum,
   1.353:1); the composition is whatever the artwork is, and the card crops rather than stretches.

4. **Extend the bottom to 900x803.** The painted art is ~1.37:1 but the card is 1.121:1, so the CTA
   would otherwise sit on a colour band butted against the art. Instead the art's own bottom edge is
   sampled into a horizontal colour profile and run down to fill the rest, so the plate simply keeps
   going. Two details make it clean, and both were bugs first:
     - EDGE columns are DISCARDED before the profile is taken. The outermost columns of the crop
       still carry a whisper of the rounded corner (measured: luminance 222 against 247 two columns
       in), and tiling that produced a visible smear in the bottom-left of the first Starter plate.
     - The profile is low-passed hard (BLUR). Any real detail left in it becomes a vertical streak
       once it is repeated for 150 rows.

5. **Save progressive JPEG q88** — matched to the shipped plates' quantization tables.

Verified against the shipped Daylight plate: rebuilding its extension with these constants
reproduces the real file to within 2/255 (JPEG rounding).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "assets" / "themes" / "starter"

# Plate geometry — the card's aspect is 900/803 (MonoDailyCard's `aspectRatio`).
WIDTH, HEIGHT = 900, 803
# Inset from the detected card bounds: clears the hairline stroke and the corner arc (step 2).
# The starting point — the script raises it until the corners come out clean.
INSET_MIN, INSET_MAX = 20, 60
# How far a corner pixel may sit from the 12x12 patch it lives in before it reads as corner
# darkness rather than the artwork's own gradient. Apex's nicks measured 14-21 off; a clean crop of
# the same art measures under 4.
CORNER_TOL = 8
# Columns dropped from each side before the bottom profile is sampled (step 4).
EDGE = 26
# Rows of real art averaged into the profile.
PROFILE_ROWS = 8
# Horizontal low-pass on the profile, in px.
BLUR = 90
QUALITY = 88
# How far out --dot samples the background it fills from. Must stay inside the artwork: on the Apex
# source the card's border stroke is only ~60px from the dot, and reaching it poisons the fill.
RING_SPAN = 16


def _card_bounds(a: np.ndarray, tol: int = 10) -> tuple[int, int, int, int]:
    """The card's bounds inside the render, found against the flat outer margin."""
    h, w, _ = a.shape
    bg = a[2, 2]
    diff = np.abs(a.astype(int) - bg.astype(int)).max(axis=2) > tol
    cols = np.nonzero(diff.any(axis=0))[0]
    rows = np.nonzero(diff.any(axis=1))[0]
    if not len(cols) or not len(rows):
        sys.exit("Could not find a card in this render — is it already edge-to-edge?")
    return int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1


def _fill_dot(a: np.ndarray, cx: int, cy: int, r: int) -> np.ndarray:
    """Erase a generator artifact by re-deriving the gradient that belongs underneath it.

    The Apex render came out with a green status dot baked into the card's top-left. What is behind
    it is a smooth colour gradient, so a quadratic surface is fitted per channel to an annulus AROUND
    the hole and evaluated inside it — the fill is then part of the same gradient by construction,
    with no edge to find.

    Three methods were tried; the first two are recorded because both failed the same way and only a
    3x look at a flat field revealed it:
      - Diffusion (averaging neighbours inward) left a disc ~3/255 DARKER than its surroundings.
      - A quadratic least-squares fit over a wide annulus overshot and left one clearly LIGHTER.
      - Normalized convolution left one darker again — and measuring finally explained all three:
        the dot sits ~62px from the card's rounded corner, so any wide kernel reaches past the
        card's border stroke into the near-black OUTER MARGIN and drags it inward.
    So the sampling ring is kept strictly inside the artwork. A radial profile of the Apex source
    shows the dot is gone by r=20 and the background is flat to under 1/255 all the way out to r=60,
    where the border stroke begins — RING_SPAN keeps the samples in that band. A plane (not a
    quadratic) is fitted so a gentle gradient is still followed without any room to overshoot.
    """
    out = a.astype(float).copy()
    yy, xx = np.mgrid[0 : a.shape[0], 0 : a.shape[1]].astype(float)
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    hole, ring = dist <= r, (dist > r) & (dist <= r + RING_SPAN)
    if not hole.any() or ring.sum() < 60:
        return a

    def plane(x: np.ndarray, y: np.ndarray) -> np.ndarray:
        return np.stack([np.ones_like(x), (x - cx) / r, (y - cy) / r], axis=1)

    coeffs = np.linalg.lstsq(plane(xx[ring], yy[ring]), out[ring], rcond=None)[0]
    filled = plane(xx[hole], yy[hole]) @ coeffs
    # Feather the outer 4px so the fit meets the real pixels gradually.
    blend = np.clip((r - dist[hole]) / 4.0, 0.0, 1.0)[:, None]
    out[hole] = filled * blend + out[hole] * (1 - blend)
    return out.round().clip(0, 255).astype(np.uint8)


def _corner_error(art: np.ndarray) -> float:
    """How far the worst corner pixel sits from the 12x12 patch around it.

    Rounded-corner darkness shows up here and nowhere else — the middle of the crop looks perfect
    either way — so this is the number the inset search minimises.
    """
    worst = 0.0
    for y, x in ((0, 0), (0, -1), (-1, 0), (-1, -1)):
        patch = art[
            (slice(0, 12) if y == 0 else slice(-12, None)),
            (slice(0, 12) if x == 0 else slice(-12, None)),
        ]
        dev = np.abs(art[y, x].astype(float) - patch.reshape(-1, 3).mean(axis=0)).max()
        worst = max(worst, float(dev))
    return worst


def build(source: Path, theme_id: str, dot: tuple[int, int, int] | None) -> Path:
    a = np.asarray(Image.open(source).convert("RGB"))
    if dot:
        a = _fill_dot(a, *dot)

    x0, y0, x1, y1 = _card_bounds(a)

    # Climb the inset until the corners come out clean (step 2). Each candidate is judged on the
    # RESIZED art, because that is what actually ships.
    art, inset, err = None, None, None
    for candidate in range(INSET_MIN, INSET_MAX + 1, 2):
        crop = a[y0 + candidate : y1 - candidate, x0 + candidate : x1 - candidate]
        ch, cw = crop.shape[:2]
        painted_h = round(WIDTH * ch / cw)
        if painted_h >= HEIGHT:
            sys.exit(f"Painted art is {painted_h}px tall at {WIDTH} wide — taller than the {HEIGHT}px plate.")
        resized = np.asarray(Image.fromarray(crop).resize((WIDTH, painted_h), Image.LANCZOS))
        err = _corner_error(resized)
        if err <= CORNER_TOL:
            art, inset = resized, candidate
            break
    if art is None or inset is None:
        sys.exit(
            f"No inset up to {INSET_MAX}px produced clean corners (worst corner still {err:.0f}/255 "
            "off its surroundings). Check the source for an artifact near an edge."
        )
    painted_h = art.shape[0]
    print(f"inset {inset}px (corner error {err:.1f}/255)")

    profile = art[painted_h - PROFILE_ROWS : painted_h].astype(float).mean(axis=0)
    profile[:EDGE] = profile[EDGE]
    profile[-EDGE:] = profile[-EDGE - 1]
    profile = np.asarray(
        Image.fromarray(np.repeat(profile.reshape(1, WIDTH, 3), 3, axis=0).round().astype(np.uint8))
        .filter(ImageFilter.GaussianBlur(BLUR))
    )[1]

    plate = np.empty((HEIGHT, WIDTH, 3), dtype=np.uint8)
    plate[:painted_h] = art
    plate[painted_h:] = profile

    out = OUT_DIR / f"background-hero-card-{theme_id}.jpg"
    Image.fromarray(plate).save(out, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    print(f"{out.name}: {WIDTH}x{HEIGHT}, painted {painted_h}px + {HEIGHT - painted_h}px extension, "
          f"{out.stat().st_size / 1024:.1f} KB")
    print("Remember: bump the ?v= on this theme's `dailyCard` token (public/ is not hashed).")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("source")
    ap.add_argument("theme_id")
    ap.add_argument("--dot", help="Artifact to erase before cropping, as X,Y,RADIUS in source px")
    args = ap.parse_args()
    d = tuple(int(v) for v in args.dot.split(",")) if args.dot else None
    build(Path(args.source), args.theme_id, d)  # type: ignore[arg-type]
