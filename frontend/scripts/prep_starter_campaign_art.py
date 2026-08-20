"""Prep the Starter-system campaign art (the reference campaign hub) for the app.

Source PNGs ship with baked flat backgrounds (white for the badges/scenes/hero, a dark
vignette for the Arts easel). The hub renders this art on theme panels that are light on
the Starter/Daylight/Bubblegum skins but DARK on the Midnight/Apex/Champion skins, so a
baked background would show as a hard box on half the catalog. This strips the flat
background to transparency (flood-fill from the border, so interior highlights survive),
tight-crops to the content, and downscales oversized art. All text stays in React/CSS.

Run:  uv run python scripts/prep_starter_campaign_art.py   (from frontend/)
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

RAW = Path(__file__).resolve().parent.parent / "src" / "assets" / "campaign" / "starter" / "raw"
OUT = Path(__file__).resolve().parent.parent / "src" / "assets" / "campaign" / "starter"

# max longest edge per art kind (badges are small medallions; scenes/hero are wider)
MAX_EDGE = {"badge": 320, "scene": 560, "hero": 640}

# tolerance (colour distance to the sampled corner background) per file; the Arts easel sits
# on a soft dark vignette (a gradient), so it needs a wider tolerance than the crisp white beds.
TOL = {"world-scene-arts": 90}
DEFAULT_TOL = 44


def kind_of(stem: str) -> str:
    if "badge" in stem:
        return "badge"
    if "hero" in stem:
        return "hero"
    return "scene"


def strip_bg(im: Image.Image, tol: float) -> Image.Image:
    """Flood-fill the flat background from the image border to transparency."""
    arr = np.asarray(im.convert("RGBA")).astype(np.int16)
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3]
    corners = np.array([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]], dtype=np.float32)
    bg = corners.mean(axis=0)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    is_bg = dist <= tol

    visited = np.zeros((h, w), dtype=bool)
    dq: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_bg[y, x] and not visited[y, x]:
                visited[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if is_bg[y, x] and not visited[y, x]:
                visited[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and is_bg[ny, nx]:
                visited[ny, nx] = True
                dq.append((ny, nx))

    alpha = arr[:, :, 3].copy()
    # soft edge: pixels on the boundary between kept + removed fade by their bg-closeness
    alpha[visited] = 0
    out = arr.copy()
    out[:, :, 3] = alpha
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def square_medallion(im: Image.Image) -> Image.Image:
    """Crop a round badge tight to the medallion (ignoring the faint leftover drop-shadow) and pad
    it to a centered SQUARE. The source badges arrive on portrait canvases with the disc pushed to
    the top and empty space below, so at a fixed box they'd render at different visual sizes; this
    normalizes every badge to the same framing as the Sports badge (disc fills the frame)."""
    alpha = np.asarray(im.convert("RGBA"))[:, :, 3]
    ys, xs = np.where(alpha > 140)  # 140 keeps the opaque disc, drops the soft shadow halo
    if len(xs) == 0:
        return im
    l, r, t, b = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    crop = im.crop((l, t, r, b))
    w, h = crop.size
    s = max(w, h)
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    canvas.paste(crop, ((s - w) // 2, (s - h) // 2), crop)
    return canvas


def main() -> None:
    files = sorted(RAW.glob("*.png"))
    if not files:
        raise SystemExit(f"no source PNGs in {RAW}")
    for src in files:
        stem = src.stem
        kind = kind_of(stem)
        tol = TOL.get(stem, DEFAULT_TOL)
        im = Image.open(src)
        im = strip_bg(im, tol)
        if kind == "badge":
            im = square_medallion(im)  # uniform square framing for every medallion
        else:
            bbox = im.getbbox()
            if bbox:
                im = im.crop(bbox)
        longest = max(im.size)
        cap = MAX_EDGE[kind]
        if longest > cap:
            scale = cap / longest
            im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        dst = OUT / f"{stem}.png"
        im.save(dst, optimize=True)
        print(f"{stem:28s} {kind:5s} tol={tol:<3} -> {im.size[0]}x{im.size[1]}")


if __name__ == "__main__":
    main()
