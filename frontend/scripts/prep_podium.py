"""Strip the dark studio background from the podium render to transparency + tight-crop.

The source is a white/gold 3D podium on a dark gradient with a warm glow. We flood-fill the dark
background inward from the border (keeping the podium + its soft light halo intact), then crop to
content so it drops cleanly onto the ivory Leaderboard.
"""

from collections import deque
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# Taken from argv. Hardcoding one machine's Downloads folder made this script unusable by anyone
# else, put a local path (and a username) into the repository, and leaked how the source art was
# produced through the filename itself.
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else None
OUT = Path(__file__).resolve().parent.parent / "src" / "assets" / "leaderboard" / "podium.png"
TOL = 82  # colour distance from the sampled corner that still counts as background


def main() -> None:
    if SRC is None or not SRC.is_file():
        raise SystemExit(f"usage: python {Path(__file__).name} <source-image.png>")
    im = Image.open(SRC).convert("RGBA")
    arr = np.asarray(im).astype(np.int16)
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3]
    corners = np.array([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]], dtype=np.float32)
    bg = corners.mean(axis=0)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    is_bg = dist <= TOL

    visited = np.zeros((h, w), bool)
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
    alpha[visited] = 0
    out = arr.copy()
    out[:, :, 3] = alpha
    res = Image.fromarray(out.astype(np.uint8), "RGBA")
    bbox = res.getbbox()
    if bbox:
        res = res.crop(bbox)
    # cap width so the asset isn't huge
    if res.width > 900:
        s = 900 / res.width
        res = res.resize((900, round(res.height * s)), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    res.save(OUT, optimize=True)
    print("saved", OUT, res.size)


if __name__ == "__main__":
    main()
