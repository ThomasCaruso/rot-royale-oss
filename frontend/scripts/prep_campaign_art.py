"""One-off: ingest the Cosmic Labs campaign art pack from ~/Downloads into src/assets/campaign/cosmic.

Three treatments (techniques shared with scripts/strip_bg.py, self-contained here so the lobby
pipeline stays untouched):
  - BINARY strip (hard-edged medallions on a baked checkerboard): classify light/low-sat pixels,
    keep only the border-connected region, erode the halo ring, premultiplied-downscale, tight-crop.
  - SOFT un-matte (art that FADES into the baked light background — the moon's horizon haze, the
    nebula's clouds): recover fractional alpha from the drop below the background colour, un-mix the
    foreground, then lightly blur the alpha to suppress checkerboard ripple in the recovery.
  - RESIZE only (layers that already ship real alpha): premultiplied downscale.

Originals are copied in untouched; processed copies land in ./clean/ (the app imports clean/ only).
"""
import os
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

DL = os.path.expanduser("~/Downloads")
DEST = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "campaign", "cosmic")
OUT = os.path.join(DEST, "clean")
os.makedirs(OUT, exist_ok=True)

BINARY = [  # hard-edged medallions → strip + tight-crop, max 512px
    "campaign_node_completed.png",
    "campaign_node_current.png",
    "campaign_node_locked.png",
    "campaign_node_boss.png",
    "world_icon_cosmic_labs.png",
]
# The nebula ships as flat RGB with a checkerboard BAKED into its midtones (content is both darker
# and lighter than the checker, so difference-matting can't model it). Instead we KEY OUT the
# checker: alpha = smoothed NOT-checker-grey; the black sky stays opaque and disappears under the
# screen blend the layer is composited with in the app.
CHECKER_KEY = ["cosmic_layer_nebula_midground.png"]
RESIZE = ["cosmic_layer_moon_foreground.png", "cosmic_layer_boss_galaxy.png"]  # real alpha already → downscale only

MIN_LIGHT = 150
MAX_SAT = 60


def premultiplied_resize(rgb, alpha01, size):
    pre = rgb.astype(np.float32) * alpha01[..., None]
    pre_s = np.asarray(Image.fromarray(np.clip(pre, 0, 255).astype("uint8"), "RGB").resize(size, Image.LANCZOS)).astype(np.float32)
    a_s = np.asarray(Image.fromarray((alpha01 * 255).astype("uint8"), "L").resize(size, Image.LANCZOS)).astype(np.float32) / 255.0
    with np.errstate(divide="ignore", invalid="ignore"):
        rgb_s = np.where(a_s[..., None] > 0.004, pre_s / np.maximum(a_s[..., None], 1e-4), 0.0)
    return np.clip(rgb_s, 0, 255).astype("uint8"), np.clip(a_s * 255, 0, 255).astype("uint8")


def scaled_size(w, h, maxdim):
    s = min(1.0, maxdim / max(w, h))
    return (max(1, round(w * s)), max(1, round(h * s)))


def save(rgb_s, a_s, name):
    Image.fromarray(np.dstack([rgb_s, a_s]), "RGBA").save(os.path.join(OUT, name), optimize=True)


def binary_strip(arr, w, h):
    mn = arr.min(axis=2).astype(np.int16)
    mx = arr.max(axis=2).astype(np.int16)
    lightish = (mn >= MIN_LIGHT) & ((mx - mn) <= MAX_SAT)
    m = np.zeros((h, w, 3), "uint8")
    m[lightish] = (255, 255, 255)
    maskimg = Image.fromarray(m, "RGB")
    for s in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (0, h // 2), (w - 1, h // 2), (w // 2, h - 1)]:
        ImageDraw.floodfill(maskimg, s, (255, 0, 255), thresh=10)
    mm = np.asarray(maskimg)
    bg = (mm[:, :, 0] == 255) & (mm[:, :, 1] == 0) & (mm[:, :, 2] == 255)
    alpha = np.where(bg, 0, 255).astype("uint8")
    alpha_img = Image.fromarray(alpha, "L").filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MinFilter(3))
    return arr.astype(np.float32), np.asarray(alpha_img).astype(np.float32) / 255.0


def checker_key(arr):
    """Alpha = smoothed NOT-checker: the baked checkerboard is light near-grey (high min channel,
    tiny channel spread); everything saturated or dark is content. The RGB is then DE-MESHED — a
    median filter flattens the checker ripple that bleeds through the semi-transparent cloud pixels
    themselves, while bright star points (which a median would erase) are put back from the
    original."""
    mn = arr.min(axis=2).astype(np.int16)
    mx = arr.max(axis=2).astype(np.int16)
    checker = (mn >= 170) & ((mx - mn) <= 28)
    alpha = np.where(checker, 0, 255).astype("uint8")
    a_img = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(2.2))

    # The checker tiles are ~18px at source resolution — a Gaussian at the tile period averages one
    # light + one dark tile into a flat tone, erasing the mesh everywhere (clouds are soft, so the
    # feather is invisible); star points the blur would swallow are restored from the original.
    base = np.asarray(Image.fromarray(arr.astype("uint8"), "RGB").filter(ImageFilter.GaussianBlur(14))).astype(np.float32)
    orig = arr.astype(np.float32)
    stars = (orig.mean(axis=2) - base.mean(axis=2)) > 20  # bright outliers the blur flattened
    rgb = np.where(stars[..., None], orig, base)
    return rgb, np.asarray(a_img).astype(np.float32) / 255.0


for name in BINARY + CHECKER_KEY + RESIZE:
    src = os.path.join(DL, name)
    if not os.path.exists(src):
        print(f"MISSING: {name}")
        continue
    shutil.copy(src, os.path.join(DEST, name))  # original, untouched

    if name in RESIZE:
        im = Image.open(src).convert("RGBA")
        arr = np.asarray(im)
        rgb_s, a_s = premultiplied_resize(arr[:, :, :3].astype(np.float32), arr[:, :, 3].astype(np.float32) / 255.0, scaled_size(im.width, im.height, 760))
        save(rgb_s, a_s, name)
        print(f"{name}: resized -> {rgb_s.shape[1]}x{rgb_s.shape[0]}")
        continue

    im = Image.open(src).convert("RGB")  # drops any (unused) alpha; the baked bg is in the pixels
    arr = np.asarray(im)
    w, h = im.size
    if name in BINARY:
        rgb_f, alpha01 = binary_strip(arr, w, h)
        rgb_s, a_s = premultiplied_resize(rgb_f, alpha01, scaled_size(w, h, 512))
        out = Image.fromarray(np.dstack([rgb_s, a_s]), "RGBA")
        bbox = out.getbbox()
        if bbox:
            out = out.crop(bbox)
        out.save(os.path.join(OUT, name), optimize=True)
        print(f"{name}: stripped -> {out.size[0]}x{out.size[1]}")
    else:
        rgb_f, alpha01 = checker_key(arr)
        rgb_s, a_s = premultiplied_resize(rgb_f, alpha01, scaled_size(w, h, 760))
        save(rgb_s, a_s, name)
        print(f"{name}: checker-keyed -> {rgb_s.shape[1]}x{rgb_s.shape[0]}")

print("done")
