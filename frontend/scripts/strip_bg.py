"""One-off: remove the opaque light background from the lobby PNGs.

The supplied assets ship with a solid but GRAINY near-white background (alpha 255, values ~165-255
with off-colour specks), which renders as a light/dotted box on the dark cards. Pipeline:

  1. Classify every pixel as "background-coloured" = light AND low-saturation. This catches the grain
     specks too, not just the flat white.
  2. Keep only the background region CONNECTED to the border (flood-fill from edge seeds). Interior
     light areas (globe clouds, metal highlights, coin shine) aren't border-connected, so they survive.
  3. Erode the alpha a few px to cut the blended halo ring, then downscale with PREMULTIPLIED alpha
     (the correct way to resize transparent art) so edges never fringe.

Originals are left untouched; cleaned copies are written to ./clean/.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "lobby")
OUT = os.path.join(SRC, "clean")
os.makedirs(OUT, exist_ok=True)
FILES = [
    "avatar-bot.png", "avatar-hooded.png", "chest-vault.png", "coin.png", "crown-hero.png",
    "crown-arena.png", "crown-cta.png", "crown-podium.png", "gem.png", "flag-progress.png",
    "flame-streak.png", "globe-campaign.png", "shield-gold-iii.png", "shield-avatar.png",
    "rot-royale-banner.png",
]
# Assets tight-cropped to their content bbox after stripping (they have heavy transparent padding).
TIGHT_CROP = {"crown-podium.png", "crown-arena.png", "crown-cta.png", "rot-royale-banner.png"}
# Soft-glow assets get UN-MATTED (fractional alpha recovered from the known light background) instead
# of the binary classify+flood+erode below — a hard cutout chops their wide halo at an arbitrary
# luminance contour and leaves a ragged, chewed edge. See soft_unmatte().
SOFT_UNMATTE = {"crown-arena.png"}
MIN_LIGHT = 150        # a background pixel's darkest channel is at least this (light)
MAX_SAT = 60           # ...and its channel spread is at most this (near-grey/white)
MAXDIM = 512           # downscale: source is 1254px but nothing displays above ~165px (3x = crisp)


def premultiplied_resize(rgb, alpha01, size):
    """Resize an RGBA image by premultiplying alpha, so edges don't fringe."""
    pre = rgb.astype(np.float32) * alpha01[..., None]
    pre_s = np.asarray(Image.fromarray(np.clip(pre, 0, 255).astype("uint8"), "RGB").resize(size, Image.LANCZOS)).astype(np.float32)
    a_s = np.asarray(Image.fromarray((alpha01 * 255).astype("uint8"), "L").resize(size, Image.LANCZOS)).astype(np.float32) / 255.0
    with np.errstate(divide="ignore", invalid="ignore"):
        rgb_s = np.where(a_s[..., None] > 0.004, pre_s / np.maximum(a_s[..., None], 1e-4), 0.0)
    return np.clip(rgb_s, 0, 255).astype("uint8"), np.clip(a_s * 255, 0, 255).astype("uint8")


def soft_unmatte(arr, w, h):
    """Recover a smooth alpha channel for art composited onto a near-white background.

    The composite is C = a*F + (1-a)*B with B known (the near-white page). Per pixel we estimate
    a from how far the pixel drops below B in its most-darkened channel (a smooth ramp, so the
    halo keeps its gradual fade), then un-mix the true foreground F = (C - (1-a)*B) / a so the
    glow composites correctly over the dark cards. Isolated low-alpha specks (background grain)
    are dropped by keeping only the alpha region connected to the solid content core.
    Returns (rgb float array, alpha01 float array).
    """
    # B per channel from the border frame (pure background all around these assets).
    frame = np.concatenate([arr[:40].reshape(-1, 3), arr[-40:].reshape(-1, 3),
                            arr[:, :40].reshape(-1, 3), arr[:, -40:].reshape(-1, 3)])
    B = np.median(frame, axis=0)

    # Alpha ramp on the max per-channel drop below B: t0 swallows the bg grain (+-6 with specks),
    # t1 is where content counts as fully opaque (solid violet drops ~190 in green).
    d = np.clip(B[None, None, :] - arr.astype(np.float32), 0, None).max(axis=2)
    t0, t1 = 16.0, 150.0
    alpha01 = np.clip((d - t0) / (t1 - t0), 0.0, 1.0)

    # Keep only the alpha blob connected to the content core; stray grain specks elsewhere die.
    m = np.zeros((h, w, 3), "uint8")
    m[alpha01 > 0] = (255, 255, 255)
    maskimg = Image.fromarray(m, "RGB")
    cy, cx = np.unravel_index(np.argmax(d), d.shape)
    ImageDraw.floodfill(maskimg, (int(cx), int(cy)), (255, 0, 255), thresh=10)
    keep = np.asarray(maskimg)[:, :, 2] == 255  # magenta-filled blob
    alpha01 = np.where(keep, alpha01, 0.0)

    # Un-mix the foreground so semi-transparent halo pixels keep their true colour over dark bgs.
    a3 = alpha01[..., None]
    rgb = np.where(a3 > 0.004, (arr.astype(np.float32) - (1.0 - a3) * B[None, None, :]) / np.maximum(a3, 1e-4), 0.0)
    return np.clip(rgb, 0, 255), alpha01


only = set(sys.argv[1:])  # optional: regenerate just the named files
for name in FILES:
    if only and name not in only:
        continue
    p = os.path.normpath(os.path.join(SRC, name))
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert("RGB")
    arr = np.asarray(im)
    w, h = im.size

    if name in SOFT_UNMATTE:
        rgb_f, alpha01 = soft_unmatte(arr, w, h)
    else:
        mn = arr.min(axis=2).astype(np.int16)
        mx = arr.max(axis=2).astype(np.int16)
        lightish = (mn >= MIN_LIGHT) & ((mx - mn) <= MAX_SAT)

        # Keep only the light region CONNECTED to the border (preserves interior whites). Done via an
        # RGB mask + colour flood-fill (Pillow's floodfill no-ops on single-band "L" images).
        mrgb = np.zeros((h, w, 3), "uint8")
        mrgb[lightish] = (255, 255, 255)
        maskimg = Image.fromarray(mrgb, "RGB")
        seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (0, h // 2), (w - 1, h // 2), (w // 2, h - 1)]
        for s in seeds:
            ImageDraw.floodfill(maskimg, s, (255, 0, 255), thresh=10)
        m = np.asarray(maskimg)
        bg = (m[:, :, 0] == 255) & (m[:, :, 1] == 0) & (m[:, :, 2] == 255)

        alpha = np.where(bg, 0, 255).astype("uint8")
        # Erode the opaque region ~3px to cut the blended halo ring.
        alpha_img = Image.fromarray(alpha, "L").filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MinFilter(3))
        alpha01 = np.asarray(alpha_img).astype(np.float32) / 255.0
        rgb_f = arr.astype(np.float32)

    scale = min(1.0, MAXDIM / max(w, h))
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    rgb_s, a_s = premultiplied_resize(rgb_f, alpha01, size)
    out = Image.fromarray(np.dstack([rgb_s, a_s]), "RGBA")

    # Tight-crop to content for assets that ship with lots of transparent padding (e.g. the podium's
    # oval sits in a thin band of a square canvas). Cropping lets them be sized directly in the UI
    # instead of contain-shrinking to fit the padding. Only these are cropped — other assets rely on
    # their canvas padding for consistent placement across screens.
    if name in TIGHT_CROP:
        bbox = out.getbbox()  # non-zero-alpha bounds
        if bbox:
            out = out.crop(bbox)
    out.save(os.path.join(OUT, name), optimize=True)
    print(f"{name}: bg {(alpha01 == 0).mean() * 100:.1f}% -> {out.size[0]}x{out.size[1]}px")

print("done")
