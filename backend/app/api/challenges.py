"""Challenge share loop endpoints.

Two surfaces:
  * an authed JSON API to create a challenge (POST /challenges) and read its public snapshot
    (GET /api/challenges/{id}) — the SPA uses these;
  * PUBLIC, app-root share pages (GET /c/{id} → OG-tagged HTML that redirects a human into the SPA;
    GET /c/{id}/og.png → a dynamically rendered result card) that crawlers unfurl and humans click.

Anti-cheat: every response is a display-only snapshot. No endpoint here ever reads or returns a
question, option, or answer.
"""

from __future__ import annotations

import html
import io
import json

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.db import get_session
from app.models import Challenge, User
from app.schemas.challenge import ChallengeCreateIn, ChallengeOut, ChallengePublicOut
from app.services.challenge import (
    ChallengeEntryNotFound,
    ChallengeEntryNotPlayable,
    ChallengeNotYours,
    create_challenge,
    creator_theme,
    get_challenge,
    percentile,
    today_royale_playable,
)
from app.services.theme_palette import (
    UI_FONT_FILE,
    blend,
    display_font_file,
    font_path,
    is_light,
    parse_color,
    theme_colors,
)

# The authed JSON API. The public /c/... share pages are a SEPARATE app-root router (below).
router = APIRouter(tags=["challenges"])


def _challenge_url(challenge_id: str) -> str:
    return f"{settings.challenge_base_url}/c/{challenge_id}"


@router.post("/challenges", response_model=ChallengeOut)
async def create(
    body: ChallengeCreateIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ChallengeOut:
    try:
        challenge = await create_challenge(session, creator=user, entry_id=body.entry_id)
    except ChallengeEntryNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found") from exc
    except ChallengeNotYours as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your entry") from exc
    except ChallengeEntryNotPlayable as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Entry is not a finished Daily Royale run"
        ) from exc
    await session.commit()
    return ChallengeOut(
        id=challenge.id,
        url=_challenge_url(challenge.id),
        contest_no=challenge.contest_no,
        score=challenge.score,
        place=challenge.place,
        field_size=challenge.field_size,
        percentile=percentile(challenge.place, challenge.field_size),
    )


@router.get("/api/challenges/{challenge_id}", response_model=ChallengePublicOut)
async def public_snapshot(
    challenge_id: str, session: AsyncSession = Depends(get_session)
) -> ChallengePublicOut:
    challenge = await get_challenge(session, challenge_id)
    if challenge is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Challenge not found")
    return ChallengePublicOut(
        id=challenge.id,
        username=challenge.username,
        contest_no=challenge.contest_no,
        contest_date=challenge.contest_date,
        score=challenge.score,
        place=challenge.place,
        field_size=challenge.field_size,
        percentile=percentile(challenge.place, challenge.field_size),
        playable_window_id=await today_royale_playable(session),
        theme=await creator_theme(session, challenge),
    )


# ── Public app-root share pages (no /api prefix — these are the human-facing share links) ──
public_router = APIRouter(tags=["challenges-public"])

_NOT_FOUND_HTML = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    "<title>Challenge not found · Rot Royale</title></head>"
    '<body style="font-family:system-ui;background:#14101f;color:#f4efe6;'
    'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">'
    '<div style="text-align:center"><h1>Challenge not found</h1>'
    "<p>This share link has expired or never existed.</p></div></body></html>"
)


@public_router.get("/c/{challenge_id}", response_class=HTMLResponse)
async def share_page(
    challenge_id: str, session: AsyncSession = Depends(get_session)
) -> HTMLResponse:
    challenge = await get_challenge(session, challenge_id)
    if challenge is None:
        return HTMLResponse(_NOT_FOUND_HTML, status_code=status.HTTP_404_NOT_FOUND)

    pct = percentile(challenge.place, challenge.field_size)
    page_url = _challenge_url(challenge.id)
    image_url = f"{page_url}/og.png"
    play_url = f"{settings.web_base_url}/?c={challenge.id}"

    e = html.escape
    # json.dumps, not !r: Python's repr is not a JavaScript escaper and would emit
    # a literal </script> straight out of the tag. Not reachable today (play_url is
    # config + a base62 id) — but the safety of !r here depends on that staying true.
    play_url_js = json.dumps(play_url)
    title = f"{challenge.username} scored {challenge.score} in Rot Royale #{challenge.contest_no}"
    description = "Beat me 👇 Play today's Daily Royale — free, no signup."
    top_line = f" · Top {pct}% today" if pct is not None else ""

    doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(description)}">
<meta property="og:image" content="{e(image_url)}">
<meta property="og:url" content="{e(page_url)}">
<meta property="og:site_name" content="Rot Royale">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(description)}">
<meta name="twitter:image" content="{e(image_url)}">
<meta http-equiv="refresh" content="0; url={e(play_url)}">
<script>window.location.replace({play_url_js});</script>
<style>body{{font-family:system-ui;background:#14101f;color:#f4efe6;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0}}a{{color:#e7c15a}}</style>
</head>
<body>
<div style="text-align:center">
<h1>{e(challenge.username)} scored {challenge.score}{e(top_line)}</h1>
<p>Rot Royale #{challenge.contest_no}</p>
<p><a href="{e(play_url)}">Play today's Daily Royale — free, no signup →</a></p>
</div>
</body>
</html>"""
    return HTMLResponse(doc)


def _render_og_png(challenge: Challenge, theme_id: str | None = None) -> bytes:
    """1200x630 share card, painted in the sharer's equipped theme.

    This is the highest-traffic surface in the product: it's what every recipient sees in the group
    chat before they ever tap. It mirrors the Starter hero composition — an eyebrow, the handle in
    the theme's display face, the score as the hero number, a hairline rule with a gold lozenge, and
    a CTA pill — so a link looks like the app the sender is actually playing.

    Colours and typeface come from `theme_palette` (generated from `tokens.ts`), so a theme retune
    in the frontend restyles the share card with no Python edit. Robust by construction: any failure
    falls back to a plain branded card rather than breaking the unfurl.
    """
    from PIL import Image, ImageDraw, ImageFont

    width, height = 1200, 630
    colors = theme_colors(theme_id)

    panel = parse_color(colors.get("panel"), (255, 255, 255))
    panel2 = parse_color(colors.get("panel2"), panel)
    text_c = parse_color(colors.get("text"), (36, 26, 62))
    muted = parse_color(colors.get("muted"), blend(text_c, panel, 0.45))
    brand = parse_color(colors.get("brand"), (108, 63, 197))
    amber = parse_color(colors.get("amber"), (201, 147, 43))
    cta_text = parse_color(colors.get("ctaText"), (255, 255, 255))
    light = is_light(panel)
    # The app's `--bg` is a CSS gradient Pillow can't evaluate, so the card derives its own vertical
    # ramp between the two panel tokens — same family of colour, never a second source of truth.
    top_bg, bottom_bg = panel, blend(panel2, text_c, 0.06 if light else 0.0)
    hairline = blend(panel, text_c, 0.14)

    img = Image.new("RGB", (width, height), panel)
    draw = ImageDraw.Draw(img)

    _Font = ImageFont.FreeTypeFont | ImageFont.ImageFont

    def load(filename: str, size: int) -> _Font:
        try:
            return ImageFont.truetype(str(font_path(filename)), size=size)
        except OSError:
            try:
                return ImageFont.load_default(size=size)
            except TypeError:  # pragma: no cover - very old Pillow
                return ImageFont.load_default()

    display_file = display_font_file(colors)

    def display(size: int) -> _Font:
        """The sender's theme display face — Playfair for mono skins, Luckiest Guy for arcade."""
        return load(display_file, size)

    def ui(size: int) -> _Font:
        """Manrope, for labels and small caps across every theme."""
        return load(UI_FONT_FILE, size)

    def centered(
        text: str, ink_top: int, f: _Font, fill: tuple[int, int, int], track: int = 0
    ) -> int:
        """Draw centred with the text's INK top at `ink_top`; returns the ink bottom.

        Pillow anchors at the font's ascent box, which for a display face carries a lot of empty
        space above the caps — stacking on raw y values drifts badly between sizes (it put a 168px
        score straight through the divider). Measuring the real ink box and compensating makes the
        vertical rhythm predictable, and returning the bottom lets each block stack off the last.
        """
        box = draw.textbbox((0, 0), text, font=f)
        y = ink_top - box[1]
        if track:
            widths = [draw.textlength(ch, font=f) for ch in text]
            total = sum(widths) + track * (len(text) - 1)
            x = (width - total) / 2
            for ch, w in zip(text, widths, strict=True):
                draw.text((x, y), ch, font=f, fill=fill)
                x += w + track
        else:
            draw.text(((width - (box[2] - box[0])) / 2, y), text, font=f, fill=fill)
        return round(y + box[3])

    try:
        pct = percentile(challenge.place, challenge.field_size)

        # Background ramp.
        for y in range(height):
            draw.line([(0, y), (width, y)], fill=blend(top_bg, bottom_bg, y / height))
        # Brand rail top, gold rail bottom — the card's frame.
        draw.rectangle([0, 0, width, 10], fill=brand)
        draw.rectangle([0, height - 10, width, height], fill=amber)

        # A long handle shrinks to fit rather than running into the card edge.
        handle = challenge.username[:20]
        handle_size = 76
        while handle_size > 34 and draw.textlength(handle, font=display(handle_size)) > width - 200:
            handle_size -= 4

        badge = f"TOP {pct}% TODAY" if pct is not None else f"DAILY ROYALE #{challenge.contest_no}"
        label, pill_font = "BEAT ME — FREE, NO SIGNUP", ui(27)
        pill_h = 66

        def ink_height(text: str, f: _Font) -> int:
            box = draw.textbbox((0, 0), text, font=f)
            return round(box[3] - box[1])

        # Pre-measure the stack so it can be optically centred: drawing top-down from a fixed
        # offset left ~80px of dead space under the CTA, which reads as a cropped card in a chat
        # preview. Gaps here must match the ones used in the draw pass below.
        stack = (
            ink_height("ROT ROYALE", ui(28))
            + 34
            + ink_height(handle, display(handle_size))
            + 40
            + ink_height("SCORE", ui(24))
            + 26
            + ink_height(str(challenge.score), display(150))
            + 46  # rule
            + 26
            + ink_height(badge, ui(32))
            + 26
            + pill_h
        )
        top = max(34, round((height - stack) / 2))

        # Every block stacks off the measured bottom of the one above, so the composition holds
        # whatever the handle length, score magnitude or theme typeface.
        y = centered("ROT ROYALE", top, ui(28), brand, track=9)
        y = centered(handle, y + 34, display(handle_size), text_c)
        y = centered("SCORE", y + 40, ui(24), muted, track=7)
        y = centered(str(challenge.score), y + 26, display(150), text_c)

        # Hairline rule with a gold lozenge — the Starter hero's divider, rotated 45° so it reads
        # as a diamond (regular_polygon with rotation=0 draws a flat square).
        rule_y = y + 46
        draw.line([(width / 2 - 190, rule_y), (width / 2 - 26, rule_y)], fill=hairline, width=2)
        draw.line([(width / 2 + 26, rule_y), (width / 2 + 190, rule_y)], fill=hairline, width=2)
        draw.regular_polygon((width / 2, rule_y, 9), n_sides=4, rotation=45, fill=amber)

        y = centered(badge, rule_y + 26, ui(32), amber, track=4)

        # CTA pill — the "beat me" hook, in the theme's brand colour.
        text_w = draw.textlength(label, font=pill_font) + 4 * (len(label) - 1)
        pill_w = round(text_w) + 76
        pill_y = y + 26
        draw.rounded_rectangle(
            [(width - pill_w) / 2, pill_y, (width + pill_w) / 2, pill_y + pill_h],
            radius=pill_h // 2,
            fill=brand,
        )
        centered(label, pill_y + 23, pill_font, cta_text, track=4)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:
        # Absolute fallback: a plain branded card so a render error never breaks the unfurl.
        fb = Image.new("RGB", (width, height), (20, 16, 31))
        d = ImageDraw.Draw(fb)
        d.rectangle([0, 0, width, 12], fill=(231, 193, 90))
        d.text((60, 280), "ROT ROYALE", fill=(231, 193, 90), font=ImageFont.load_default())
        buf = io.BytesIO()
        fb.save(buf, format="PNG")
        return buf.getvalue()


@public_router.get("/c/{challenge_id}/og.png")
async def share_image(challenge_id: str, session: AsyncSession = Depends(get_session)) -> Response:
    challenge = await get_challenge(session, challenge_id)
    if challenge is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Challenge not found")
    png = _render_og_png(challenge, await creator_theme(session, challenge))
    return Response(
        content=png,
        media_type="image/png",
        # Short TTL on purpose: the card is painted in the sharer's CURRENTLY equipped theme, so a
        # re-equip should restyle already-posted links within minutes rather than after an hour.
        # Crawlers re-fetch on unfurl, so this costs little.
        headers={"Cache-Control": "public, max-age=300"},
    )
