"""Theme colours + typefaces for server-side share-card rendering.

`frontend/src/theme/tokens.ts` is the ONE source of truth for theme colours. It cannot be imported
from Python, so `frontend/scripts/export-theme-palette.mjs` transpiles it and writes
`content/theme_palette.json`; this module loads that file. Nothing here hand-copies a colour —
change a theme in `tokens.ts`, re-run `npm run export:palette`, and the share card follows.

Only flat colours are exported. The CSS gradients (`--bg`, `--cta`) can't be evaluated by Pillow, so
the card derives its own background ramp from the solid tokens instead of duplicating them.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from app.core.constants import DEFAULT_THEME_ID

_PALETTE_PATH = Path(__file__).resolve().parents[2] / "content" / "theme_palette.json"
_FONT_DIR = Path(__file__).resolve().parents[1] / "assets" / "fonts"

RGB = tuple[int, int, int]

# Last-resort palette if the generated file is missing or unreadable. These are the Starter values;
# a share card in slightly wrong colours beats a 500 on the acquisition path.
_FALLBACK: dict[str, str] = {
    "name": "Starter",
    "style": "mono",
    "font": "PlayfairDisplay-Bold.ttf",
    "panel": "#FFFFFF",
    "panel2": "#F6F1FB",
    "line": "rgba(84,64,120,.13)",
    "brand": "#6C3FC5",
    "brand-2": "#8B5CF6",
    "amber": "#C9932B",
    "text": "#241A3E",
    "muted": "#6F678A",
    "faint": "#A69EBD",
    "btnText": "#FFFFFF",
    "ctaText": "#FFFFFF",
}


@lru_cache(maxsize=1)
def _palette() -> dict[str, dict[str, str]]:
    try:
        raw = json.loads(_PALETTE_PATH.read_text(encoding="utf-8"))
        themes = raw.get("themes")
        if isinstance(themes, dict) and themes:
            return themes
    except (OSError, ValueError):
        pass
    return {}


def theme_ids() -> list[str]:
    """Every theme id the palette knows — used by tests to render one card per theme."""
    return sorted(_palette())


def theme_colors(theme_id: str | None) -> dict[str, str]:
    """The palette entry for a theme, falling back to the default theme then to Starter.

    An unknown id is expected, not exceptional: a player can equip a theme shipped by a newer
    frontend than the running backend, and the share card must still render.
    """
    themes = _palette()
    if theme_id and theme_id in themes:
        return themes[theme_id]
    if DEFAULT_THEME_ID in themes:
        return themes[DEFAULT_THEME_ID]
    return _FALLBACK


_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_RGB_RE = re.compile(
    r"^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$", re.IGNORECASE
)


def parse_color(value: str | None, fallback: RGB = (0, 0, 0)) -> RGB:
    """CSS colour → RGB. Handles `#rgb`, `#rrggbb`, `rgb()` and `rgba()`.

    Alpha is DROPPED rather than composited: every token this renderer uses alpha for (`--line`)
    is drawn on a known opaque background, and `blend()` handles the mixing explicitly where it
    matters. Silently returning the fallback on a malformed value keeps a bad token from 500ing
    the unfurl.
    """
    if not isinstance(value, str):
        return fallback
    v = value.strip()
    if _HEX_RE.match(v):
        h = v.lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    m = _RGB_RE.match(v)
    if m:
        return (min(255, int(m.group(1))), min(255, int(m.group(2))), min(255, int(m.group(3))))
    return fallback


def blend(a: RGB, b: RGB, t: float) -> RGB:
    """Linear mix, `t` = how much of `b`. Used for the card's background ramp and hairlines."""
    t = max(0.0, min(1.0, t))
    return (
        round(a[0] + (b[0] - a[0]) * t),
        round(a[1] + (b[1] - a[1]) * t),
        round(a[2] + (b[2] - a[2]) * t),
    )


def relative_luminance(c: RGB) -> float:
    """WCAG relative luminance — decides light-skin vs dark-skin treatment on the card."""

    def channel(v: int) -> float:
        s = v / 255
        return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4

    return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])


def is_light(c: RGB) -> bool:
    return relative_luminance(c) > 0.5


def font_path(filename: str) -> Path:
    return _FONT_DIR / filename


def display_font_file(colors: dict[str, str]) -> str:
    """The committed TTF matching this theme's `--font-display` stack."""
    name = colors.get("font") or _FALLBACK["font"]
    if not (_FONT_DIR / name).is_file():
        return _FALLBACK["font"]
    return name


UI_FONT_FILE = "Manrope-Bold.ttf"
