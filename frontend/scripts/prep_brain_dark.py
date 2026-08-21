"""One-off: cut the dark-authored Brain Boost brain out of its background.

WHY A SECOND BRAIN EXISTS
-------------------------
`brain.png` is drawn for a LIGHT page: its wispy upper edge has real alpha gaps meant to let ivory
show through. On the dark skins the card shows through them instead, so the brain reads chewed and
speckled. That was patched in `Home.tsx` with a white silhouette underlay, which filled the gaps but
was always a workaround for artwork that did not exist. This is that artwork — a brain authored to
sit on dark — so the dark skins get the real thing and the underlay comes out.

EXTRACTION
----------
The source is a glowing brain on a flat dark navy. That is the mirror image of `strip_bg.py`'s
`soft_unmatte` (art on near-WHITE), and the same algebra applies: the render is C = a*F + (1-a)*B
with B known, so alpha comes from how far each pixel rises ABOVE the background and the true
foreground is recovered as F = (C - (1-a)*B)/a. Recovering F matters — without it the glow keeps the
navy mixed into it and muddies over an ember or garnet card.

Two things the measurements settled:

  * **The brain body is opaque, and the key can prove it.** An eroded interior of the brain has a
    minimum luminance of 171 and a 1st percentile of 222, so nothing inside it is dim enough to be
    confused with background. A ramp topping out at OPAQUE_AT makes the whole body solid with no
    see-through creases, and the core is hole-filled on top of that as a belt-and-braces step.

  * **The wide glow is cut back to a rim on purpose.** The source's halo reaches ~600px. Keeping it
    cost two things: the canvas went from 73% transparent (what `brain.png` is) to 3.7%, tripling the
    file, and the brain's luminous footprint grew far wider than the light version's — so switching
    themes would visibly change how much room the brain takes. It is also redundant, because
    `BrainVisual` already draws a `--brand`-tinted CSS haze that is correct per theme, whereas a
    baked violet wash would fight Crown Arena's ember and Champion's garnet. So the halo is masked
    down to a rim (HALO_PX) and only the brain's own edge light survives.

FRAMING
-------
Matched to `brain.png` so the two are interchangeable: both render through the same
`<RowArt size={62}>` with `object-fit: contain`, so if the body filled a different fraction of its
canvas the brain would visibly change size when you switched themes. `brain.png` is 512x512 with its
body spanning 425x310 at bbox x53..477 / y96..405 — i.e. 83.0% of the canvas wide, centred at
(51.8%, 48.9%). The crop below reproduces exactly that.

    uv run python scripts/prep_brain_dark.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

# Taken from argv. Hardcoding one machine's Downloads folder made this script unusable by anyone
# else, put a local path (and a username) into the repository, and leaked how the source art was
# produced through the filename itself.
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else None
OUT = Path(__file__).resolve().parent.parent / "public" / "assets" / "themes" / "starter" / "brain-dark.png"
REF = Path(__file__).resolve().parent.parent / "public" / "assets" / "themes" / "starter" / "brain.png"

# 384, not brain.png's 512: the only consumer is a 62px box, which is 186 device px at 3x DPR, so
# this is still 2x oversampled — and it lands under brain.png's own weight (116 KB vs 134 KB) rather
# than adding 184 KB to the PWA precache. The canvases need not match; what must match is the
# FRAMING fraction below, since that is what sets the rendered size.
CANVAS = 384
# Excess-over-background at which a pixel is fully opaque. Below the brain's dimmest interior (which
# measures 171 luminance, ~127 above the background) so the body can never key out.
OPAQUE_AT = 150.0
# A pixel is part of the solid core above this excess — used only to hole-fill the body.
CORE_AT = 120.0
# How far the kept rim glow reaches beyond the brain, in CANVAS px (so ~3px at the 62px render).
HALO_PX = 26.0


def _fill_holes(mask: np.ndarray) -> np.ndarray:
    """Flood from the border; anything unreached is an interior hole and belongs to the core."""
    from collections import deque

    h, w = mask.shape
    outside = np.zeros_like(mask, dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not mask[y, x] and not outside[y, x]:
                outside[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not mask[y, x] and not outside[y, x]:
                outside[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not mask[ny, nx] and not outside[ny, nx]:
                outside[ny, nx] = True
                q.append((ny, nx))
    return ~outside


def _ref_framing() -> tuple[float, float, float]:
    """(body width as a fraction of canvas, body centre x, body centre y) read off brain.png."""
    a = np.asarray(Image.open(REF).convert("RGBA"))
    ys, xs = np.nonzero(a[:, :, 3] > 128)
    w = a.shape[1]
    return (
        (xs.max() - xs.min() + 1) / w,
        ((xs.min() + xs.max()) / 2) / w,
        ((ys.min() + ys.max()) / 2) / a.shape[0],
    )


def main() -> None:
    if SRC is None or not SRC.is_file():
        raise SystemExit(f"usage: python {Path(__file__).name} <source-image.png>")
    src = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32)

    # The flat background, measured from the border rather than assumed.
    border = np.concatenate([src[0], src[-1], src[:, 0], src[:, -1]])
    bg = np.median(border, axis=0)

    excess = np.clip(src - bg, 0, None)
    lex = excess.max(axis=2)
    alpha = np.clip(lex / OPAQUE_AT, 0.0, 1.0)

    core = _fill_holes(lex > CORE_AT)
    alpha = np.maximum(alpha, core.astype(np.float32))

    # Un-mix the true foreground so the glow does not carry the navy into a new background.
    safe = np.maximum(alpha, 1e-3)[..., None]
    fg = np.clip((src - (1 - safe) * bg) / safe, 0, 255)

    ys, xs = np.nonzero(core)
    bx0, bx1, by0, by1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    body_w = bx1 - bx0 + 1
    frac, cx_frac, cy_frac = _ref_framing()

    crop = body_w / frac                       # source px that map to the full canvas
    left = (bx0 + bx1) / 2 - cx_frac * crop
    top = (by0 + by1) / 2 - cy_frac * crop

    # Mask the halo down to a rim that hugs the silhouette. Blurring the core mask gives exactly a
    # soft falloff from the brain's own outline — no scipy distance transform needed — and scaling it
    # up keeps the mask saturated across the body so only the outside fades.
    halo_src = HALO_PX * (crop / CANVAS)       # canvas px -> source px
    rim = np.asarray(
        Image.fromarray((core * 255).astype(np.uint8), "L").filter(
            ImageFilter.GaussianBlur(halo_src / 2.2)
        )
    ).astype(np.float32) / 255.0
    alpha *= np.clip(rim * 2.6, 0.0, 1.0)

    # Premultiply BEFORE resizing, or the transparent edges pull background colour in.
    pre = np.concatenate([fg * alpha[..., None], alpha[..., None] * 255], axis=2)
    box = (left, top, left + crop, top + crop)
    small = np.asarray(
        Image.fromarray(pre.round().clip(0, 255).astype(np.uint8), "RGBA").resize(
            (CANVAS, CANVAS), Image.LANCZOS, box=box
        )
    ).astype(np.float32)

    a_s = small[:, :, 3:4] / 255.0
    rgb = np.where(a_s > 0.004, small[:, :, :3] / np.maximum(a_s, 1e-4), 0.0)
    out = np.concatenate([rgb, small[:, :, 3:4]], axis=2).round().clip(0, 255).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(OUT, optimize=True)

    a8 = out[:, :, 3]
    sy, sx = np.nonzero(a8 > 128)
    print(f"{OUT.name}: {CANVAS}x{CANVAS}, {OUT.stat().st_size / 1024:.1f} KB")
    print(f"  background sampled at {bg.round().astype(int).tolist()}")
    print(
        f"  body {sx.max() - sx.min() + 1}x{sy.max() - sy.min() + 1} "
        f"({(sx.max() - sx.min() + 1) / CANVAS:.3f} of canvas; brain.png is {frac:.3f})"
    )
    print(f"  fully-opaque px {(a8 == 255).mean():.3f}, edge alpha max {a8[0].max()}/{a8[-1].max()}")


if __name__ == "__main__":
    main()
