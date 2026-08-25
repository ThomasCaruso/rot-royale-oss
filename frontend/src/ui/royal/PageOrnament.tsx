import type { CSSProperties } from "react";
import { ContourBottomRight, ContourTopLeft } from "./Ornaments";

/**
 * The PAGE-WIDE half of the Rot Royale ornament: ambient light, film grain, and the two corner
 * contour sweeps.
 *
 * Split from `CrownStage` along the line that actually matters — everything here is fixed to the
 * VIEWPORT and knows nothing about any content, whereas the stage tracks the crown. That is also
 * why this can be shared verbatim by two screens whose compositions are otherwise unalike.
 *
 * Every layer is `aria-hidden` and `pointer-events: none`, and none of it participates in layout.
 */
export function PageOrnament() {
  return (
    <>
      <div style={atmosphere} aria-hidden />
      <span style={grain} aria-hidden />
      {/* Two crops of one contour render, sweeping in from opposite corners and mostly off-screen.
          Fixed to the VIEWPORT rather than to any column: an absolute corner ornament would pin
          itself to its container's corner instead of the phone's. */}
      <div style={contourFrameTL} aria-hidden>
        <ContourTopLeft style={contourTopLeft} />
      </div>
      <div style={contourFrameBR} aria-hidden>
        <ContourBottomRight style={contourBottomRight} />
      </div>
    </>
  );
}

/* ── Atmosphere ─────────────────────────────────────────────────────────────────────────────────
 *
 * The page is lit, not decorated. Four radial washes over `--bg` (which is left exactly as it is —
 * this adds to the ivory room, it does not replace it):
 *
 *   1. champagne key      high and wide, sitting behind the crown and wordmark
 *   2. lavender body      the largest of the four, centred between the branding and the buttons,
 *                         carrying the brand purple through the middle of the page
 *   3. lower-right pool   lavender
 *   4. lower-left pool    champagne — so the lower third has a direction to it
 *
 * THE CORNER SIDES ARE NOT ARBITRARY, and getting them backwards is the trap. `--bg` already lights
 * this room: a white bloom at 50%/-12%, a royal-purple pool at 88%/110% and a gold one at 6%/102%
 * (theme/tokens.ts, the Starter theme). The first version of this layer put lavender bottom-LEFT and
 * gold bottom-RIGHT — directly opposing both — and the two schemes cancelled: sampled pixels came
 * back at g−b = +1, i.e. neutral grey, and the page read dusty rather than warm. These four
 * reinforce the room's own light instead of arguing with it.
 *
 * HIGH-LUMINANCE TINTS, not saturated dyes. A mid-value purple at any alpha over warm cream mixes
 * toward grey — that is just what those two colours do. Lifting each wash's luminance close to the
 * base and letting the HUE do the work is what makes it read as light falling on the page rather
 * than as paint applied to it.
 *
 * FIXED, NOT ABSOLUTE. The shell is a 400px centred column; an absolute layer would be a 400px-wide
 * band of light with cream either side of it on any window wider than that. Fixed makes the whole
 * viewport the light source. It unmounts with the screen, so nothing leaks into the app.
 *
 * EVERY STOP IS A TRIPLE — colour, a low mid, then transparent — never colour→transparent. A
 * straight two-stop alpha ramp across a wash this large bands visibly on an 8-bit display; the app
 * already learned this on the Daily Royale backdrop (BrainBoostIntro's ART_FADE carries the same
 * note). The `grain` layer below is the second half of that fix: 1.5% noise dithers the remaining
 * steps out entirely, which is most of why it is here — the "not sterile" part is a bonus.
 *
 * Every gradient reaches `transparent` inside its own box, so there is no edge anywhere to catch.
 * Raw rgba rather than theme tokens is deliberate: this screen only ever renders on the default
 * Starter palette (it is pre-auth, so `equipped_theme` is always unset), and these are tuned as
 * light on that specific cream. */
const atmosphere: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 0,
  pointerEvents: "none",
  background:
    // 1. champagne key — behind crown + wordmark (they sit between ~8% and ~32% of the viewport
    //    across the supported range, so the centre goes at 15% and the falloff covers the spread).
    "radial-gradient(122% 46% at 50% 15%, rgba(255,226,164,.22), rgba(255,226,164,.085) 46%, transparent 73%)," +
    // 2. lavender body — branding down through the button stack. Centred at 52% rather than 45%:
    //    higher up it desaturates the wordmark's navy and greys the tagline.
    "radial-gradient(118% 60% at 50% 52%, rgba(182,152,244,.10), rgba(182,152,244,.038) 50%, transparent 76%)," +
    // 3/4. the bottom corners, on the SAME sides as --bg's own pools (purple right, gold left).
    //      Centres sit off-canvas (102% / 100%) so only the inner shoulder of each ellipse is on
    //      screen — a centre inside the frame reads as a blob.
    "radial-gradient(90% 54% at 93% 102%, rgba(163,128,236,.15), rgba(163,128,236,.055) 46%, transparent 74%)," +
    //      The gold corner runs LEANER than the lavender one. Gold shifts a cream base much further
    //      per unit alpha than purple does — at matched .15 it sampled r−b = +32 against the
    //      lavender corner's −8, and read as a visible yellow wedge rather than as light.
    "radial-gradient(78% 44% at 4% 100%, rgba(248,214,146,.10), rgba(248,214,146,.033) 46%, transparent 71%)",
};

/* Fractal noise, generated inline so it costs no request (same technique as the Daily Royale
 * intro's grain, kept local rather than shared — extracting it would mean editing that screen).
 * `overlay` disturbs only the extremes and leaves mid-tones alone, which is how film grain behaves.
 * 1.5% is below the threshold where it registers as texture; its real job is dithering the washes
 * above so a large low-contrast gradient cannot band. */
const GRAIN_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>` +
      `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='3' stitchTiles='stitch'/>` +
      `<feColorMatrix type='saturate' values='0'/></filter>` +
      `<rect width='180' height='180' filter='url(#n)'/></svg>`
  );

const grain: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 0,
  pointerEvents: "none",
  opacity: 0.015,
  mixBlendMode: "overlay",
  backgroundImage: `url("${GRAIN_SVG}")`,
  backgroundRepeat: "repeat",
  backgroundSize: "180px 180px",
};

/* ── The contour ornaments ──────────────────────────────────────────────────────────────────────
 *
 * Two crops of the same render, entering from opposite corners. Three rules hold them in their
 * place, and all three are about restraint rather than about the art:
 *
 * MOSTLY OFF-SCREEN, AND MUCH BIGGER THAN THE PHONE. Each renders at ~165vw and is pulled out past
 * its corner, so roughly a fifth of it is on the page. That is not just about cropping: the comp's
 * corner ornaments are three or four LONG, GENTLE, WELL-SPACED arcs (traced: one enters the top
 * edge around x 0.17W and leaves the left edge around y 0.28H), and this artwork only looks like
 * that at scale. At the 88vw the first pass used, the same lines packed into a tight, busy bundle
 * — right art, wrong radius. Blowing it up puts the dense part off-screen and leaves the sparse
 * outer sweeps, which is exactly the comp. An ornament fully inside the frame stops framing and
 * starts decorating; it also acquires a visible outer edge, which is the "sticker" read.
 *
 * THE ART'S OWN EMPTINESS DOES THE PROTECTING. Both crops are dense along their own corner diagonal
 * and blank in the opposite corner. Anchored corner-to-corner, the part of each box that reaches
 * into the middle of the page — over the wordmark, over the buttons — is the blank part. That is
 * why this works with pure positioning and needs no mask.
 *
 * VIEWPORT-RELATIVE OFFSETS, NOT PERCENTAGES OF THEMSELVES. `left: -34vw` keeps the same fraction
 * of the ornament off-screen on a 390 and a 430 phone; a percentage of the element would drift.
 * The clamps stop a desktop window from flinging them off the page entirely.
 *
 * Low opacity, no blur: the lines are already hairlines at this scale, and blurring a hairline just
 * turns it into a smudge. */
const CONTOUR_FADE_TL =
  "radial-gradient(circle 132vw at 0% 0%, #000 0%, #000 50%, rgba(0,0,0,.4) 66%, transparent 84%)";
const CONTOUR_FADE_BR =
  "radial-gradient(circle 96vw at 100% 100%, #000 0%, #000 46%, rgba(0,0,0,.4) 64%, transparent 84%)";

/* THE MASK LIVES ON A VIEWPORT-SIZED FRAME, NOT ON THE IMAGE, and that is not a detail.
 *
 * At the scale these now run, the artwork's arcs cross the whole screen — straight through the
 * wordmark and behind the buttons — which the comp never does. What the comp has is a fan of arcs
 * that is strong in its corner and simply gone by the middle of the page. Expressing that as a
 * radial fade centred on the corner is exact; expressing it on the <img> is not, because the
 * corner's position INSIDE the image changes with every clamp in `left`/`top`, so the gradient
 * would have to be recomputed per viewport and would silently drift when an offset is retuned.
 * A fixed, inset-0 frame makes "the corner" mean the screen's corner at every size, and the image
 * can then be moved freely underneath it.
 *
 * The two radii differ because the comp's do. Traced crossings: the top-left fan reaches 234px
 * along the top edge and 253px down the left, while the bottom-right one is tighter — 133px along
 * the bottom and 84-152px up the right. So TL gets a wider fade than BR.
 *
 * `overflow: hidden` is belt-and-braces: with the image several viewports wide, a mask that failed
 * to apply (an engine without `mask-image`) would otherwise paint the whole fan across the page.
 * Clipped to the viewport it degrades to "too many arcs", not to a broken screen. */
const contourFrameTL: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 0,
  pointerEvents: "none",
  overflow: "hidden",
  maskImage: CONTOUR_FADE_TL,
  WebkitMaskImage: CONTOUR_FADE_TL,
};

const contourFrameBR: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 0,
  pointerEvents: "none",
  overflow: "hidden",
  maskImage: CONTOUR_FADE_BR,
  WebkitMaskImage: CONTOUR_FADE_BR,
};

/* Scale and offsets found by SEARCH, not by taste. A grid of (width, x-offset, y-offset) was
 * rendered in the live browser and each candidate scored on how closely its arcs crossed the screen
 * EDGES where the comp's do — traced off the comp at top 0.52/0.65 W and left 0.25/0.27 H for this
 * one, right 0.82/0.90 H and bottom 0.66 W for its partner — with a penalty for any arc crossing
 * where the comp has none. 16 candidates each; these won, landing within ~0.02 of every target.
 * Re-run that search if the crops in prep_login_ornaments.py change: these numbers are a property
 * of the crop, not of the layout.
 *
 * ~1.4x their native size, which is the other half of the crop decision — small crops keep the arcs
 * near hairlines on screen, instead of the soft 2x-upscaled bands the whole-lobe crops produced.
 *
 * All three values are width-proportional. The ornament fills a corner at a fixed apparent scale,
 * so it tracks the phone's width; tying the vertical offset to height would stretch the fan on a
 * tall screen and undo the curvature the search just fixed. The clamps only bind outside phone
 * widths. */
const contourTopLeft: CSSProperties = {
  position: "absolute",
  top: "clamp(-48px, -10.3vw, -32px)",
  left: "clamp(-36px, -7.7vw, -24px)",
  width: "clamp(300px, 87vw, 400px)",
  opacity: 0.72,
};

const contourBottomRight: CSSProperties = {
  position: "absolute",
  bottom: "clamp(-180px, -38.5vw, -120px)",
  right: "clamp(-48px, -10.3vw, -32px)",
  width: "clamp(440px, 128vw, 580px)",
  opacity: 0.72,
};
