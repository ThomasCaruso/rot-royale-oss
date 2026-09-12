"""Resize + recompress the shipped image assets.

Why this exists
---------------
Every image the app shipped was authored at master resolution and shipped at master resolution.
Home alone pulled 1.78 MB of PNG to paint avatars at 37-46 CSS px and hub icons at 44 px --- an
8-14x linear overdraw, which is 60-200x the pixels actually rasterised. That dwarfed the entire
JS bundle (122 KB gz), so it was the real load-speed lever.

Two rules, both deliberately conservative:

1. RESIZE only where the display size is KNOWN. Targets below are 3x the largest size the asset is
   ever rendered at --- 3x covers the densest phone screen anyone owns, so this is lossless in
   practice. Sizes came from measuring the running app (`getBoundingClientRect` on every <img> and
   CSS background across every screen) plus the `size=` call sites in code, NOT from guessing.
   Anything whose display size could not be established is left at its original dimensions; several
   assets (campaign world scenes, the podium, the hero map) turn out to be correctly sized for 3x
   already and are deliberately untouched.

2. RECOMPRESS, behind TWO gates depending on how much is known about the asset (see the gate block
   below). A first version of this used one RMSE limit for everything and shipped a real regression:
   the full-screen backdrop on the new-user screen collapsed from 128 colours to six and lost the
   golden halo through its centre, because per-pixel RMSE barely moves when a large low-contrast
   wash loses its structure. Assets whose render size was measured get the loose gate that was
   verified by eye at that size; everything else must be near-lossless or it keeps full colour.
   Untouched JPEGs are not re-encoded at all --- a few KB is not worth generation loss.

3. CONVERT TO WEBP (`--webp`). This was refused for years on one ground: `ios/App/App.xcodeproj`
   pinned IPHONEOS_DEPLOYMENT_TARGET = 13.0 and WKWebView only gained WebP in iOS 14, so WebP would
   have silently broken every image for iOS 13 users. Capacitor 8 raised that floor to 15.0, which
   retired the objection for the NATIVE app.

   It does not retire it for the WEB app, and that distinction is deliberate rather than overlooked.
   rotroyale.live is served to whatever browser arrives, and Safari gained WebP only in iOS 14
   --- so
   a visitor on iOS 13 Safari sees broken images with no fallback. That is an accepted trade, not an
   oversight: iOS 13's share of web traffic is now negligible, and a <picture> fallback would double
   the asset count and the reference surface to serve it. Revisit only if that population reappears.

   The quality gates below apply UNCHANGED to WebP, with one correction. RMSE over raw RGBA is
   MEANINGLESS for transparent art: lossy WebP rewrites the RGB of fully-transparent pixels, which
   are never rasterised, and that alone scored crown.png at RMSE 25 and the crown showcase at 47 ---
   numbers that would have rejected both as catastrophic when nothing visible had changed. WebP is
   judged on the image COMPOSITED OVER THE PAGE COLOUR, plus the alpha channel compared separately.
   Measured that way the same two files score 4.11 and 2.98, with alpha error of exactly 0.00.

Usage
-----
    python scripts/optimize_images.py --dry-run     # report, write nothing
    python scripts/optimize_images.py               # rewrite in place

Files under `public/` are NOT content-hashed by Vite, so replacing one leaves every browser that
already fetched it serving the old bytes forever. After a real run, bump the `?v=` on each changed
public/ asset (docs/architecture.md section 13). The script prints exactly which ones need it.
"""

from __future__ import annotations

import argparse
import math
import os
import re
import sys
from io import BytesIO

from PIL import Image, ImageChops, ImageFilter

# --- Resize targets: longest side in px, = 3x the largest measured display size. -----------------
# key = path prefix (posix, repo-relative from frontend/); first match wins, so list specific first.
RESIZE_TARGETS: list[tuple[str, int, str]] = [
    # Identity portraits + the Blank pair's line-art marks. Avatar's largest `size=` in the whole
    # app is 88 px (measured max on screen: 79). 3 x 88 = 264, rounded up.
    ("public/avatars/portraits/", 288, "Avatar, max size=88"),
    ("public/avatars/", 288, "Avatar line-art, max size=88"),
    # Home hub-row icons render at 44 px; the royale icon shares the set.
    ("public/assets/themes/starter/starter-icon-", 160, "hub row icon, 44px"),
    # The brain mark tops out at 62 px on the Brain Boost row.
    ("public/assets/themes/starter/brain", 192, "brain mark, 62px"),
    # Header wordmark R: 31x40.
    ("public/assets/themes/starter/starter-logo-r-mark", 128, "header logo, 40px"),
    # VS badge + avatar frame overlay ride on top of an avatar disc (<= 116 px on the duel card).
    ("public/assets/themes/starter/starter-vs-badge", 352, "duel VS badge, <=116px"),
    ("public/assets/themes/starter/starter-avatar-frame", 352, "frame over avatar, <=116px"),
]

# Skipped entirely. The PWA/manifest icon set is contracted by exact pixel size, and its cache
# lifecycle belongs to workbox (precache revisions) + the raw <link> tags in index.html rather than to
# the `?v=` convention --- so re-encoding them buys ~150 KB on a one-time install fetch in exchange for
# touching the install path. Not a trade worth making.
SKIP_PREFIXES = ("public/icons/", "public/favicon.png")

# Resize these, but NEVER palette-quantise them.
#
# The four Blank-theme line-art marks each carry an image editor's transparency checkerboard
# FLATTENED INTO OPAQUE PIXELS --- alternating 246-252 grey squares across the whole canvas, with
# alpha 255 everywhere (this is the defect docs/architecture.md section 13 warns about, and which already shipped
# once on starter-logo-r-mark). Two things follow. It is why crescent.png will not compress: the
# periodic near-white noise defeats a palette. And quantising the other three MERGES the squares, so
# the optimiser would quietly repaint the artwork --- a low-contrast periodic pattern costs almost
# nothing in RMSE, so the quality gate above does not catch it.
#
# Deleting a rendering defect is an art decision, not a compression one, so this list makes the
# script preserve the pixels exactly and leaves the call to a human. Cleaning the checkerboard first
# would take these from ~90 KB to ~3 KB each (knight quantises to 2,866 bytes once the noise is gone).
PRESERVE_COLOR = (
    "public/avatars/knight.png",
    "public/avatars/bishop.png",
    "public/avatars/rook.png",
    "public/avatars/crescent.png",
)

# --- Quantisation gates ------------------------------------------------------------------------
#
# There are TWO, and which one applies is the whole point.
#
# RMSE alone is dangerous here, and shipped a real regression: it is computed per pixel, so a large
# low-contrast wash can lose its entire structure while scoring "fine". `background_art_starter.png`
# --- the full-screen backdrop on the first screen a new user sees --- collapsed from 128 colours to
# SIX, losing the warm golden halo through its centre completely, at an RMSE of 3.84. Under a flat
# 4.5 limit that passed. It should never have been close.
#
# What actually separates the safe cases from that one is not a better error metric, it is DISPLAY
# SIZE. A portrait quantised at RMSE 4.0 is invisible because it is rasterised at 46-88 px from a
# 288 px source --- a 6x downscale averages the quantisation noise away before a human sees it. A
# backdrop is drawn at its native size, so every artefact lands on screen at 1:1.
#
# So the loose gate applies ONLY to assets with an explicit RESIZE_TARGETS entry. That list is not
# arbitrary: an entry exists precisely because the asset's render size was measured and found to be a
# fraction of its native size, and each of those was then compared against its full-colour encode at
# that real display size by eye. Everything else --- unmeasured art, backdrops, scenes, glows ---
# gets a gate strict enough that quantisation is only accepted when it is genuinely near-lossless.
#
# `blur_rmse` backs the strict gate up: blurring first discards high-frequency dither (which is what
# harmless quantisation looks like) and keeps low-frequency error (which is what a destroyed gradient
# looks like), so a lost glow cannot hide behind a small per-pixel average.
RMSE_LIMIT_MEASURED = 4.5  # verified by eye at real display size; see RESIZE_TARGETS
RMSE_LIMIT_STRICT = 1.5
BLUR_RMSE_LIMIT_STRICT = 0.5

ROOTS = ("public", "src/assets")
SKIP_DIR_PARTS = ("/raw/",)  # authoring masters, never shipped


def rmse(a: Image.Image, b: Image.Image) -> float:
    """Root-mean-square difference between two same-size RGBA images."""
    diff = ImageChops.difference(a.convert("RGBA"), b.convert("RGBA"))
    hist = diff.histogram()
    total = 0.0
    count = 0
    # histogram() is 4 concatenated 256-bin channel histograms (R,G,B,A).
    for channel in range(4):
        bins = hist[channel * 256 : (channel + 1) * 256]
        total += sum(value * value * n for value, n in enumerate(bins))
        count += sum(bins)
    return math.sqrt(total / count) if count else 0.0


def blur_rmse(a: Image.Image, b: Image.Image, radius: int = 8) -> float:
    """RMSE after a heavy blur — keeps low-frequency (structural) error, drops dither noise."""
    return rmse(a.filter(ImageFilter.GaussianBlur(radius)), b.filter(ImageFilter.GaussianBlur(radius)))


def accepts(original: Image.Image, candidate: Image.Image, measured: bool) -> bool:
    """Is this quantisation safe to ship? See the gate comments above for why `measured` decides."""
    if measured:
        return rmse(original, candidate) <= RMSE_LIMIT_MEASURED
    return (
        rmse(original, candidate) <= RMSE_LIMIT_STRICT
        and blur_rmse(original, candidate) <= BLUR_RMSE_LIMIT_STRICT
    )


# The app's cream page colour (--bg). Transparent art is composited over this before being
# measured, because that is what a viewer actually sees.
PAGE_BG = (241, 234, 233, 255)


def _composited(img: Image.Image) -> Image.Image:
    bg = Image.new("RGBA", img.size, PAGE_BG)
    return Image.alpha_composite(bg, img.convert("RGBA")).convert("RGB")


def visible_rmse(original: Image.Image, candidate: Image.Image) -> tuple[float, float, float]:
    """(visible RGB error, blurred visible error, alpha error) — see the WebP note in the docstring.

    Returned as a triple because a lossy codec can damage colour and alpha independently, and an
    alpha error is the one that shows up as a hard edge or a halo rather than as softness.
    """
    o, c = _composited(original), _composited(candidate)
    return (
        rmse(o, c),
        rmse(o.filter(ImageFilter.GaussianBlur(8)), c.filter(ImageFilter.GaussianBlur(8))),
        rmse(original.convert("RGBA").split()[3], candidate.convert("RGBA").split()[3]),
    )


# Alpha is cheap to keep exact and expensive to get wrong, so it is held to a far tighter bound than
# colour rather than being folded into one number.
ALPHA_RMSE_LIMIT = 1.0


def accepts_webp(original: Image.Image, candidate: Image.Image, measured: bool) -> bool:
    """Same two-gate rule as PNG quantisation (see above), measured on the composited image."""
    vis, blur, alpha = visible_rmse(original, candidate)
    if alpha > ALPHA_RMSE_LIMIT:
        return False
    if measured:
        return vis <= RMSE_LIMIT_MEASURED
    return vis <= RMSE_LIMIT_STRICT and blur <= BLUR_RMSE_LIMIT_STRICT


def encode_webp(img: Image.Image, measured: bool, lossless_only: bool) -> tuple[bytes, str]:
    """Smallest WebP that clears the applicable gate; lossless if nothing lossy does.

    `lossless_only` carries the PRESERVE_COLOR contract into this codec. Those four files exist to
    keep a known art defect from being quietly repainted by an optimiser, and a lossy encode would
    repaint it just as surely as a palette would — so they get lossless WebP, which is still a real
    win (crescent.png: 98.6 KB -> 57.6 KB) with the pixels bit-exact.
    """
    img = img.convert("RGBA")
    lossless = BytesIO()
    img.save(lossless, "WEBP", lossless=True, quality=100, method=6)
    if lossless_only:
        return lossless.getvalue(), "lossless"

    best, how = lossless.getvalue(), "lossless"
    # Ascending quality: the FIRST one that passes is the smallest acceptable encode.
    for q in (80, 85, 88, 92, 95):
        buf = BytesIO()
        img.save(buf, "WEBP", quality=q, method=6, alpha_quality=100)
        data = buf.getvalue()
        if len(data) >= len(best):
            continue
        if accepts_webp(img, Image.open(BytesIO(data)), measured):
            return data, f"q{q}"
    return best, how


def encode_png(img: Image.Image, allow_quantise: bool = True, measured: bool = False) -> tuple[bytes, str]:
    """Smallest acceptable PNG encoding: quantised only if it clears the applicable gate."""
    img = img.convert("RGBA")
    full = BytesIO()
    img.save(full, "PNG", optimize=True)
    best, how = full.getvalue(), "rgba"
    if not allow_quantise:
        return best, "rgba-pinned"
    for colors in (256, 128):
        buf = BytesIO()
        try:
            q = img.quantize(colors=colors, method=Image.Quantize.FASTOCTREE)
        except Exception:
            continue
        q.save(buf, "PNG", optimize=True)
        data = buf.getvalue()
        if len(data) >= len(best):
            continue
        if accepts(img, Image.open(BytesIO(data)), measured):
            best, how = data, f"pal{colors}"
            break
    return best, how


def encode_jpeg(img: Image.Image) -> tuple[bytes, str]:
    buf = BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=82, optimize=True, progressive=True)
    return buf.getvalue(), "q82"


def target_for(rel: str) -> tuple[int | None, str]:
    for prefix, longest, why in RESIZE_TARGETS:
        if rel.startswith(prefix):
            return longest, why
    return None, ""


def imported_assets() -> set[str]:
    """Absolute paths of every src/assets image reachable from an import in src/.

    Resolved by reading the import specifiers themselves, NOT by matching byte sizes against
    dist/assets: that shortcut silently mis-detects the moment dist is built from already-optimised
    art (the sizes stop matching and every source file looks unreferenced). Reading the imports is
    build-state independent, which is what a re-runnable script needs.

    This matters because ~68 MB of src/assets is authoring masters that nothing imports --- the
    `clean/` subfolders hold the variants the app actually uses --- and optimising those would burn
    minutes to change files that never ship.
    """
    found: set[str] = set()
    for dirpath, _, filenames in os.walk("src"):
        for fn in filenames:
            if not fn.endswith((".ts", ".tsx")):
                continue
            path = os.path.join(dirpath, fn)
            try:
                text = open(path, encoding="utf-8").read()
            except OSError:
                continue
            for spec in re.findall(r"""["'`]([^"'`]+\.(?:png|jpe?g))["'`]""", text, re.I):
                if spec.startswith("@/"):
                    resolved = os.path.join("src", spec[2:])
                elif spec.startswith("."):
                    resolved = os.path.join(dirpath, spec)
                else:
                    continue  # a public/ URL or a remote one; handled separately
                found.add(os.path.normpath(os.path.abspath(resolved)))
    return found


def shipped_files() -> list[str]:
    """Every image under public/ (copied verbatim) plus src/assets images that are imported."""
    imported = imported_assets()
    out = []
    for root in ROOTS:
        for dirpath, _, filenames in os.walk(root):
            posix_dir = dirpath.replace("\\", "/") + "/"
            if any(part in posix_dir for part in SKIP_DIR_PARTS):
                continue
            for fn in filenames:
                if not fn.lower().endswith((".png", ".jpg", ".jpeg")):
                    continue
                rel = os.path.join(dirpath, fn).replace("\\", "/")
                if rel.startswith(SKIP_PREFIXES):
                    continue
                if root == "src/assets" and os.path.normpath(os.path.abspath(rel)) not in imported:
                    continue  # authoring master, never bundled
                out.append(rel)
    return sorted(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--webp",
        action="store_true",
        help="convert to .webp (replacing the .png/.jpg) and print the reference renames needed",
    )
    args = ap.parse_args()

    files = shipped_files()
    before_total = after_total = 0
    changed_public: list[str] = []
    renames: list[tuple[str, str]] = []
    rows: list[tuple[int, str]] = []

    for rel in files:
        before = os.path.getsize(rel)
        img = Image.open(rel)
        w, h = img.size
        longest, why = target_for(rel)
        resized = False
        if longest and max(w, h) > longest:
            scale = longest / max(w, h)
            img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
            resized = True

        if args.webp:
            # A JPEG source is re-encoded here even when it was not resized: unlike the PNG path,
            # the format change is the point, and the gate still refuses anything visibly worse.
            data, how = encode_webp(
                img, measured=longest is not None, lossless_only=rel in PRESERVE_COLOR
            )
        elif rel.lower().endswith((".jpg", ".jpeg")):
            if not resized:
                # Re-encoding an untouched JPEG trades generation loss for a few KB. Skip it.
                before_total += before
                after_total += before
                continue
            data, how = encode_jpeg(img)
        else:
            data, how = encode_png(
                img, allow_quantise=rel not in PRESERVE_COLOR, measured=longest is not None
            )

        # Never make a file bigger; a no-win re-encode is left completely untouched.
        if len(data) >= before and not resized:
            after_total += before
            before_total += before
            continue

        after = len(data)
        before_total += before
        after_total += after
        note = f"{w}x{h}->{img.size[0]}x{img.size[1]} ({why})" if resized else f"{w}x{h} recompress"
        dest = re.sub(r"\.(png|jpe?g)$", ".webp", rel, flags=re.I) if args.webp else rel
        rows.append((before - after, f"  {before:8,} -> {after:8,}  {note:38s} {how:7s} {dest}"))
        if not args.dry_run:
            with open(dest, "wb") as fh:
                fh.write(data)
            if dest != rel:
                os.remove(rel)
        if dest != rel:
            renames.append((rel, dest))
        if rel.startswith("public/"):
            changed_public.append(rel)

    rows.sort(reverse=True)
    for _, line in rows[:30]:
        print(line)
    if len(rows) > 30:
        print(f"  ... and {len(rows) - 30} more")

    saved = before_total - after_total
    print(f"\n{len(files)} shipped images: {before_total:,} -> {after_total:,} bytes")
    pct = (100 * saved / before_total) if before_total else 0
    print(f"saved {saved:,} bytes ({pct:.1f}%){'  [DRY RUN - nothing written]' if args.dry_run else ''}")
    if changed_public:
        print(f"\n{len(changed_public)} public/ files changed -> bump their ?v= (docs/architecture.md section 13)")
    if renames:
        # Every reference must move with the file. `npm run build` fails loudly on a stale src/
        # import, but a stale public/ URL is a STRING -- it 404s silently at runtime, so those are
        # printed explicitly rather than left to be noticed.
        print(f"\n{len(renames)} files changed extension -> update every reference:")
        for src_path, dest_path in renames:
            print(f"  {src_path}  ->  {dest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
