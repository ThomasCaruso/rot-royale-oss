"""Theme palette + themed share-card rendering.

The share card is painted in the sharer's equipped theme using colours GENERATED from
`frontend/src/theme/tokens.ts` (see `frontend/scripts/export-theme-palette.mjs`). These tests pin
the two things that would silently degrade the highest-traffic surface in the product:

  * the generated palette is present, complete, and free of CSS gradients Pillow cannot paint;
  * every theme actually renders a valid PNG — including the unknown-theme and edge-case paths.

Plus a drift guard: if node is available, regenerate the palette and diff it, so a theme retune in
the frontend that never re-ran the exporter fails here instead of shipping stale share cards.
"""

from __future__ import annotations

import io
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from app.core.constants import DEFAULT_THEME_ID
from app.services.theme_palette import (
    blend,
    display_font_file,
    font_path,
    is_light,
    parse_color,
    theme_colors,
    theme_ids,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
PALETTE_PATH = REPO_ROOT / "backend" / "content" / "theme_palette.json"
EXPORTER = REPO_ROOT / "frontend" / "scripts" / "export-theme-palette.mjs"

# Tokens the renderer reads for every theme. A missing one would silently fall back to black.
REQUIRED_KEYS = ("panel", "panel2", "brand", "amber", "text", "muted", "font")


def test_palette_file_exists_and_covers_the_default_theme() -> None:
    assert PALETTE_PATH.is_file(), "run `npm run export:palette` in frontend/"
    ids = theme_ids()
    assert len(ids) >= 5, f"suspiciously few themes exported: {ids}"
    assert DEFAULT_THEME_ID in ids


@pytest.mark.parametrize("theme_id", theme_ids())
def test_every_theme_has_the_keys_the_renderer_needs(theme_id: str) -> None:
    colors = theme_colors(theme_id)
    for key in REQUIRED_KEYS:
        assert colors.get(key), f"{theme_id} is missing {key}"
    # Pillow cannot evaluate a CSS gradient — the exporter must have filtered these out.
    for key, value in colors.items():
        assert "gradient(" not in str(value), f"{theme_id}.{key} leaked a gradient"


@pytest.mark.parametrize("theme_id", theme_ids())
def test_every_theme_ships_its_display_font(theme_id: str) -> None:
    assert font_path(display_font_file(theme_colors(theme_id))).is_file()


def test_unknown_theme_falls_back_to_the_default_rather_than_raising() -> None:
    # A player can equip a theme from a newer frontend than the running backend; the share card
    # must still render rather than 500 on the acquisition path.
    assert theme_colors("no-such-theme-xyz") == theme_colors(DEFAULT_THEME_ID)
    assert theme_colors(None) == theme_colors(DEFAULT_THEME_ID)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("#FFFFFF", (255, 255, 255)),
        ("#000", (0, 0, 0)),
        ("#6C3FC5", (108, 63, 197)),
        ("rgba(84,64,120,.13)", (84, 64, 120)),
        ("rgb(1, 2, 3)", (1, 2, 3)),
        ("linear-gradient(180deg, #fff, #000)", (0, 0, 0)),  # malformed → fallback
        (None, (0, 0, 0)),
    ],
)
def test_parse_color(value: str | None, expected: tuple[int, int, int]) -> None:
    assert parse_color(value) == expected


def test_blend_and_luminance() -> None:
    assert blend((0, 0, 0), (255, 255, 255), 0.5) == (128, 128, 128)
    assert blend((10, 20, 30), (200, 200, 200), 0) == (10, 20, 30)
    assert is_light((255, 255, 255)) and not is_light((20, 16, 31))


class _FakeChallenge:
    """Just the display fields `_render_og_png` reads — no DB round-trip needed."""

    def __init__(self, username: str, score: int, place: int | None, field: int | None) -> None:
        self.username = username
        self.score = score
        self.place = place
        self.field_size = field
        self.contest_no = 142


@pytest.mark.parametrize("theme_id", theme_ids())
def test_share_card_renders_for_every_theme(theme_id: str) -> None:
    from app.api.challenges import _render_og_png
    from PIL import Image

    png = _render_og_png(_FakeChallenge("rot_tommy", 742, 3, 96), theme_id)
    img = Image.open(io.BytesIO(png))
    assert img.size == (1200, 630), "OG cards must stay 1200x630 or unfurls crop them"
    assert img.format == "PNG"
    # A blank card would still be a valid PNG — assert it actually has ink by checking the render
    # produced more than a trivial number of distinct colours.
    assert len(img.convert("RGB").getcolors(maxcolors=1 << 16) or []) > 20


@pytest.mark.parametrize(
    ("username", "score", "place", "field"),
    [
        ("a_very_long_handle_here", 1284, None, None),  # no percentile + overlong handle
        ("x", 0, 1, 1),  # shortest handle, zero score, solo field
        ("émoji_ünïcode", 99999, 12, 12),  # non-ascii handle, five-digit score
    ],
)
def test_share_card_survives_edge_cases(
    username: str, score: int, place: int | None, field: int | None
) -> None:
    from app.api.challenges import _render_og_png

    png = _render_og_png(_FakeChallenge(username, score, place, field), DEFAULT_THEME_ID)
    assert png.startswith(b"\x89PNG")


@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_palette_is_not_stale_vs_tokens_ts(tmp_path: Path) -> None:
    """Regenerate from tokens.ts and diff — a theme retune must re-run `npm run export:palette`."""
    backup = PALETTE_PATH.read_text(encoding="utf-8")
    try:
        result = subprocess.run(  # noqa: S603 - fixed argv, repo-local script
            ["node", str(EXPORTER)],  # noqa: S607
            cwd=REPO_ROOT / "frontend",
            capture_output=True,
            text=True,
            timeout=180,
        )
        if result.returncode != 0:
            pytest.skip(f"exporter could not run here: {result.stderr[-300:]}")
        regenerated = PALETTE_PATH.read_text(encoding="utf-8")
    finally:
        PALETTE_PATH.write_text(backup, encoding="utf-8")

    assert json.loads(regenerated) == json.loads(backup), (
        "backend/content/theme_palette.json is stale — run `npm run export:palette` in frontend/"
    )
