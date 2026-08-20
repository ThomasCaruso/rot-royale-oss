"""Regenerate the full app-icon set from a single source artwork.

Usage:  uv run --with pillow python frontend/scripts/make_icons.py <source.png>
        (run from the repo root; writes into frontend/public/)

The source is expected to be a large square render of the icon (the crown-? mark on a cream
tile — baked rounded corners / drop shadow / outer margin are fine). The script:
  1. samples the tile's background color from a blank spot above the artwork;
  2. finds the dark line-art's bounding box (luminance threshold — the soft shadow stays above
     it, so only the strokes count);
  3. re-composes FULL-BLEED squares (the OS applies its own corner mask) at every size, scaling
     the mark to ~62% width (48% for the maskable icon's safe zone; 78% for the tiny favicon).

Outputs: icons/pwa-192.png, icons/pwa-512.png, icons/maskable-512.png,
         icons/apple-touch-icon.png (180), favicon.png (64).
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

PUBLIC = Path(__file__).resolve().parents[1] / "public"

# (filename, canvas px, artwork width as a fraction of the canvas)
OUTPUTS = [
    (PUBLIC / "icons" / "pwa-192.png", 192, 0.62),
    (PUBLIC / "icons" / "pwa-512.png", 512, 0.62),
    (PUBLIC / "icons" / "maskable-512.png", 512, 0.48),  # inside the 80% maskable safe zone
    (PUBLIC / "icons" / "apple-touch-icon.png", 180, 0.62),
    (PUBLIC / "favicon.png", 64, 0.78),
]

DARK_LUMA = 120  # strokes are near-black; the tile, margin and soft shadow all sit far above


def main(src_path: str) -> None:
    src = Image.open(src_path).convert("RGB")
    w, h = src.size

    # 1. Tile background: sampled inside the tile, above the crown tip (art starts ~23% down).
    bg = src.getpixel((int(w * 0.30), int(h * 0.15)))

    # 2. Artwork bbox via dark-pixel scan (downsample first — the bbox only needs ~2px accuracy).
    small = src.resize((512, 512), Image.LANCZOS)
    px = small.load()
    xs, ys = [], []
    for y in range(512):
        for x in range(512):
            r, g, b = px[x, y]
            if (r * 299 + g * 587 + b * 114) // 1000 < DARK_LUMA:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise SystemExit("no dark artwork found — wrong source image?")
    pad = 6  # keep the anti-aliased stroke edges
    x0 = max(0, min(xs) - pad) * w // 512
    x1 = min(511, max(xs) + pad) * w // 512
    y0 = max(0, min(ys) - pad) * h // 512
    y1 = min(511, max(ys) + pad) * h // 512
    art = src.crop((x0, y0, x1, y1))

    # 3. Compose each output: full-bleed tile color, mark centered at the size's scale.
    for out, size, frac in OUTPUTS:
        canvas = Image.new("RGB", (size, size), bg)
        target_w = int(size * frac)
        target_h = int(target_w * art.height / art.width)
        max_h = int(size * frac)
        if target_h > max_h:
            target_h = max_h
            target_w = int(target_h * art.width / art.height)
        scaled = art.resize((target_w, target_h), Image.LANCZOS)
        canvas.paste(scaled, ((size - target_w) // 2, (size - target_h) // 2))
        out.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(out, "PNG")
        print(f"wrote {out.relative_to(PUBLIC.parent)} ({size}x{size}, art {target_w}x{target_h}, bg rgb{bg})")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
