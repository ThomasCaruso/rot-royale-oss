import type { CSSProperties } from "react";
import { CrownFieldArcs, HaloRing } from "./Ornaments";

/**
 * THE CROWN STAGE — the crown and every layer of light that makes it belong to the page.
 *
 * Nine layers, painted in this order and all behind the crown except where noted:
 *
 *   aura           the dome that fills the ring, near-white so it LIGHTENS rather than tints
 *   crownField     wide and shallow, pressed in behind the crown's lower half
 *   rays           a faint fan from behind the base
 *   HaloRing       the gold arc
 *   CrownFieldArcs thin arcs bending around the crown's lower flanks
 *   lightFloor     the caustic, outside the contact shadow
 *   baseFlare      the bright band level with the crown's rim
 *   contactShadow  the warm dark that stops it floating
 *   the crown      (z 1)
 *
 * EVERY DIMENSION IS DERIVED FROM `size`, the crown's box. That is the whole contract: pass a
 * different crown size and the halo, the arcs, the glow and the grounding all rescale together and
 * stay registered to it. Nothing here is tied to the viewport, so the same stage works on a screen
 * where the crown is 174px and one where it is 250px.
 *
 * `size` is the crown's BOX, not the crown you can see: the PNG is 512² with the artwork's opaque
 * pixels spanning x 53–450 and y 33–467, so the visible crown is 0.7754 of the box wide and its
 * base sits at 0.912 of the box height (`CROWN_BASE`). Every ratio below is written against the box
 * because that is what CSS can address, but the ones that matter visually were derived from the
 * visible crown — see the individual comments.
 *
 * Decorative throughout: `aria-hidden`, `pointer-events: none`, no layout participation, no motion.
 */
export function CrownStage({
  size,
  src,
  style,
  animate = false,
}: {
  /** The crown's box as a CSS length — everything else is derived from it. */
  size: string;
  /** The crown image (`ThemeArt.crownBare`). */
  src: string;
  /** Positioning for the stage's own box; it establishes the containing block. */
  style?: CSSProperties;
  /**
   * Entrance + idle motion. OPT-IN, and off by default on purpose: the sign-in screen is a door,
   * not an event, and a breathing halo behind a login form is exactly the kind of ambient movement
   * that reads as a page still loading. The front door turns it on.
   *
   * All of it is transform/opacity only and collapses to a still frame under
   * `prefers-reduced-motion` — see the keyframes in theme/global.css for why the loops are written
   * to freeze at their origin rather than their end state.
   */
  animate?: boolean;
}) {
  return (
    <div
      style={{ position: "relative", ...style }}
      className={animate ? "rr-hero-in" : undefined}
      aria-hidden
    >
      <span style={aura(size)} />
      <span style={crownField(size)} />
      <span style={rays(size)} />
      <HaloRing style={halo(size)} className={animate ? "rr-hero-halo" : undefined} />
      <CrownFieldArcs style={fieldArcs(size)} />
      <span style={lightFloor(size)} />
      <span style={baseFlare(size)} />
      <span style={contactShadow(size)} />
      <img
        src={src}
        alt=""
        style={crownImg(size)}
        className={animate ? "rr-hero-crown" : undefined}
        draggable={false}
      />
    </div>
  );
}

/* Halo box ÷ crown box. The reference's ring core is 79.2% of the viewport wide and the crown's box
 * is 44.1% of it: 0.792 / 0.441 = 1.795. Deriving the halo from the crown rather than from the
 * viewport is the point — both are clamped, and clamped differently, so a vw-based halo would drift
 * off the crown the moment either clamp bit. */
const HALO_TO_CROWN = 1.795;

/* What fills the ring — and it has to LIGHTEN, not tint. This is the difference the comp turned out
 * to hinge on, and it is invisible until you sample it: inside the comp's ring the page reads
 * (254,244,231) against a (247,239,231) background — BRIGHTER than the page it sits on. Every
 * previous version of this layer was a coloured wash at low alpha, and a coloured wash over cream
 * can only ever go DOWN (measured: −3 where the comp is +7). It looked like a stain under the
 * crown instead of light behind it, and no amount of tuning the hue was going to fix that, because
 * the sign was wrong.
 *
 * So the body of it is near-white warm — `rgba(255,250,238,…)`, which raises luminance — with a
 * champagne core beneath it for the hue. That core sits at 58% down, so the light reads as coming
 * from BEHIND the crown's waist (the comp's hottest point is immediately above the crown's base at
 * (253,243,205)) rather than as a glow traced around its outline.
 *
 * SMALLER THAN THE RING, at 1.5x the crown against the ring's 1.85x. They are concentric, so at
 * equal size the bright core would sit directly under the ring's stroke and wash out the one line
 * this whole layer exists to make legible. It has to stop before it gets there.
 *
 * Blurred to 40px so nothing here has an edge; every stop resolves to `transparent` inside the
 * span's own bounds, so it dissolves into `--bg` rather than ending somewhere. */
const aura = (size: string): CSSProperties => ({
  position: "absolute",
  left: "50%",
  // Centred slightly ABOVE the crown's middle, and shorter than it is wide. Both are so that the
  // glow stops before the crown's base: the contact shadow lives there, and a dome that reaches
  // down into it simply cancels it out — which is what happened first time (shadow measured +1.5
  // where the comp is -5).
  top: `calc(${size} * 0.46)`,
  transform: "translate(-50%, -50%)",
  // Sized to the RING, not to the crown, because the comp's dome fills the whole ring interior —
  // it is the light the ring encloses, not a glow stuck to the crown. The strength profile below
  // is what keeps it from flattening into a disc.
  width: `calc(${size} * ${HALO_TO_CROWN})`,
  height: `calc(${size} * ${HALO_TO_CROWN} * 1.017)`,
  zIndex: 0,
  pointerEvents: "none",
  // 13px, not 34. The gradient is already smooth — blur adds nothing to its shape and costs it
  // strength: at 34px the effective alpha where it matters (the crown's silhouette) had fallen to
  // ~0.45 of a colour whose maximum lift over this cream is +12.7, i.e. +5.7 against the comp's
  // +10. Blur was the whole deficit.
  filter: "blur(13px)",
  background:
    // A PLATEAU, not a peak. The crown covers the middle of this box, so a gradient that is
    // brightest at its centre spends all its light where nothing can see it and arrives at the
    // crown's silhouette — the only place it shows — already faded. Profiling the comp row by row
    // puts its brightest point just OUTSIDE the crown's outline at +15 luminance over the page,
    // decaying to nothing ~53px further out. So this holds full strength out to 52% (the crown's
    // half-width as a fraction of this box) and falls off after.
    // 1. the dome — a wide, weak fill across the ring's whole interior (+4 or so)
    "radial-gradient(50% 49% at 50% 46%, rgba(255,251,240,.82), rgba(255,249,232,.34) 60%, transparent 88%)," +
    // 2. the hot core — held at full strength out to 44%, which is exactly the crown's half-width
    //    in this box, so the brightest light lands ON the silhouette rather than behind it where
    //    the crown hides it (+10, matching the comp)
    "radial-gradient(47% 42% at 50% 54%, rgba(255,251,238,.95) 0%, rgba(255,250,235,.90) 44%, rgba(255,246,224,.38) 68%, transparent 90%)," +
    // 3. the champagne, low and central, where the render's warmest point is
    "radial-gradient(32% 26% at 50% 62%, rgba(255,250,238,.55), transparent 84%)," +
    "radial-gradient(54% 50% at 50% 44%, rgba(146,116,220,.07), transparent 78%)",
});

/* ── The localized field ────────────────────────────────────────────────────────────────────────
 *
 * PROPORTIONS ARE ALL RELATIVE TO `CROWN_SIZE`, never to the viewport, so the crown defines the
 * scale and everything else follows it: halo = crown x 1.795, this field = crown x 1.45, the arcs
 * are radii inside the halo's own box, the caustic = crown x 1.45. Change the crown and the whole
 * stage rescales together. Note `CROWN_SIZE` is the crown's BOX; the crown you can actually see is
 * 0.7754 of it, so this field at 1.45 boxes is ~187% of the visible crown — inside the intended
 * 150-190% band.
 *
 * A NOTE ON THE COLOURS, because it caught every layer here at once. "Champagne" is the obvious
 * choice for warm light and it is wrong on this page. `--bg` is cream at roughly (241,234,233), so
 * its BLUE channel is already 233; any glow whose blue sits in the 190-215 range — which every
 * champagne does — pulls blue down and reads as a yellow stain rather than as light, no matter how
 * bright its red is. Measured against the comp, per channel, the first version of these layers ran
 * about 9 units low in blue everywhere:
 *
 *     comp, beside the crown    +5.0 / +2.5 / +5.0      <- all three UP
 *     ours                      +4.0 / +3.0 / -4.0      <- yellow, not light
 *
 * So the body of every glow here is near-WHITE (255,252,246-ish) with only a small warm core inside
 * it. Judge these by per-channel delta against the page, never by mean luminance — a warm tint can
 * lower the mean while looking brighter, and a yellow one can look warm while being darker in the
 * only channel that matters.
 *
 * The problem these three solve: with only a halo behind it, the crown reads as sitting in FRONT of
 * a flat sheet. In the comp the light and lines appear to curve, compress and brighten as they
 * approach the crown, which is what makes it feel physically in the scene. None of that is a real
 * distortion of the background — it is faked with layers, because a displacement filter would cost
 * a full-screen filter pass to say something three gradients can say.
 *
 * 1. `crownField` — WIDE AND SHALLOW, which is the whole point. It is 1.78× the crown across but
 *    only 0.60× tall, so it reads as light pressed flat behind the crown rather than as another
 *    round glow (there is already a round one: `aura`). Centred at 0.62 of the crown's height so
 *    it is strongest behind the LOWER half and the crown's tips stay in cleaner air.
 * 2. `CrownFieldArcs` — the bending itself. See the component.
 * 3. `lightFloor` — the caustic. A very soft, very wide horizontal pool just under the base,
 *    OUTSIDE the tight `contactShadow`: a real contact shadow is small and dark and is ringed by
 *    light that has travelled around the object. Shadow alone reads as a smudge; shadow with a
 *    caustic around it reads as an object standing on a lit surface.
 *
 * All three are sized off CROWN_SIZE, so the field tracks the crown through every clamp rather than
 * drifting off it on a different phone. */
const crownField = (size: string): CSSProperties => ({
  position: "absolute",
  zIndex: 0,
  pointerEvents: "none",
  left: "50%",
  top: `calc(${size} * 0.62)`,
  transform: "translate(-50%, -50%)",
  width: `calc(${size} * 1.45)`,
  height: `calc(${size} * 0.52)`,
  filter: "blur(16px)",
  background:
    "radial-gradient(50% 50% at 50% 54%, rgba(255,252,246,.78), rgba(255,251,242,.32) 46%, transparent 80%)," +
    "radial-gradient(38% 42% at 50% 60%, rgba(255,249,236,.28), transparent 78%)," +
    // Lavender at the OUTSIDE, as the reference has. Blue 250 against the page's 233, so it
    // lightens: a mid-value lavender here would be another yellow-stain mistake in purple.
    "radial-gradient(58% 62% at 50% 46%, rgba(226,214,250,.16), transparent 82%)",
});

const lightFloor = (size: string): CSSProperties => ({
  position: "absolute",
  zIndex: 0,
  pointerEvents: "none",
  left: "50%",
  top: `calc(${size} * 1.055)`,
  transform: "translate(-50%, -50%)",
  width: `calc(${size} * 1.45)`,
  height: `calc(${size} * 0.11)`,
  filter: "blur(11px)",
  background:
    "radial-gradient(50% 50% at 50% 50%, rgba(255,252,245,.50), rgba(255,249,238,.18) 44%, transparent 80%)",
});

/* The `CrownFieldArcs` box: concentric with the crown and the SAME size as the halo, so the arcs'
 * radii are directly comparable to the main ring's 50 — the whole compression effect is a
 * relationship between them.
 *
 * NO CSS MASK HERE, deliberately. It used to carry a `linear-gradient(to bottom)` fade, which is a
 * RECTANGULAR mask: it terminates every arc at the same height and reads as a horizontal edge. The
 * component now owns a radial mask centred on the crown, which fades the arcs along a curve and
 * holds them off the wordmark on its own. */
const fieldArcs = (size: string): CSSProperties => ({
  position: "absolute",
  zIndex: 0,
  pointerEvents: "none",
  left: "50%",
  top: `calc(${size} / 2)`,
  transform: "translate(-50%, -50%)",
  width: `calc(${size} * ${HALO_TO_CROWN})`,
  aspectRatio: "1",
});

/* The light rays fanning out from behind the crown's base. Small, but they are a real part of why
 * the comp's crown reads as standing IN light rather than on top of it — without them the dome is
 * just a bright patch, and a bright patch behind an object is what a sticker looks like.
 *
 * A repeating conic gradient gives the spokes for nothing; the radial mask is what stops it being
 * a novelty sunburst, fading the fan out well before it reaches the ring. Blurred 3px so the
 * spokes are light rather than geometry, and kept under .30 alpha — at the density where you would
 * start to count them, it stops being atmosphere.
 *
 * Reduced-motion is irrelevant here (nothing animates), but this is still the first thing to drop
 * if the screen ever needs to get cheaper: it is the only layer that costs a conic gradient. */
const rays = (size: string): CSSProperties => ({
  position: "absolute",
  zIndex: 0,
  pointerEvents: "none",
  left: "50%",
  top: `calc(${size} * 0.88)`,
  transform: "translate(-50%, -50%)",
  width: `calc(${size} * 2.05)`,
  height: `calc(${size} * 1.5)`,
  filter: "blur(3px)",
  background:
    "repeating-conic-gradient(from 196deg at 50% 60%, rgba(255,250,236,0) 0deg 3.4deg," +
    " rgba(255,250,236,.30) 3.4deg 4.6deg)",
  maskImage:
    "radial-gradient(closest-side at 50% 60%, #000 14%, rgba(0,0,0,.55) 42%, transparent 76%)",
  WebkitMaskImage:
    "radial-gradient(closest-side at 50% 60%, #000 14%, rgba(0,0,0,.55) 42%, transparent 76%)",
});

/* ── The halo ───────────────────────────────────────────────────────────────────────────────────
 *
 * CONCENTRIC WITH THE CROWN, and sized from it (`HALO_TO_CROWN`). `top` is half the crown's height
 * and the transform is a plain `-50%, -50%`, so the ring's centre and the crown's centre are the
 * same point at every viewport. The comp measures ring centre (419, 623) against crown centre
 * (424, 617) — five pixels of render noise apart, i.e. concentric. An earlier pass seated the crown
 * low in the ring on the theory that centred would read as a badge; the comp says otherwise, and
 * what actually prevents the badge read is the mask below, not an offset.
 *
 * THE LOWER ARC IS MASKED OFF, and that is the whole trick. A complete ring centred on the crown
 * puts its bottom arc straight through "Rot Royale" — the comp has no such arc, because it fades
 * out around the crown's waist and lets the crown's own base glow finish the shape. So the asset is
 * a full ring and the mask makes it an arc. This is also why the composition never needs the halo
 * to be "big enough to clear the type": it stops before it gets there.
 *
 * The stop positions are load-bearing and were wrong first time. The asset's ring core starts 6%
 * into the box and spans 88% of it, so the ring's WIDEST POINT — the thing that makes it read as a
 * circle rather than as a cap over the crown — sits at 50% of the box. Fading out at 72% (with the
 * ramp starting at 42%) killed it just before that point, and the result looked like a small arc
 * balanced on the crown's shoulders. Solid to 50%, gone by 78%, keeps the shoulders.
 *
 * `WebkitMaskImage` is not optional. ios/App pins IPHONEOS_DEPLOYMENT_TARGET 13.0 and WKWebView
 * wants the prefix; unprefixed alone, every iPhone in the installed base draws the full ring
 * straight across the wordmark. Both are set, always.
 *
 * Normal blend, deliberately. The comp's ring is a specular stroke — a near-white highlight
 * (255,255,252) alongside a gold core (242,207,147) that is DARKER than the page. Gold pigment over
 * cream is what produces that, so `screen` (the obvious choice for art recovered from an additive
 * render) would be wrong here: it can only lighten, and would drop the gold body entirely. */
const halo = (size: string): CSSProperties => ({
  position: "absolute",
  zIndex: 0,
  pointerEvents: "none",
  left: "50%",
  // Nudged DOWN by 0.065 of the crown, which seats the crown slightly ABOVE the ring's centre.
  // Measured: the reference's ring centre sits 25px below its crown centre at comp scale. It also
  // resolves an apparent contradiction — the crown *looks* like it sits in the lower-middle of the
  // halo, but that is the faded lower arc talking, not the geometry. Both are true at once: the
  // crown is high in the circle and low in the part of the circle you can see.
  top: `calc(${size} / 2 + ${size} * 0.065)`,
  transform: "translate(-50%, -50%)",
  width: `calc(${size} * ${HALO_TO_CROWN})`,
  // SQUARE, and it has to stay square — the ring is a true <circle> that fills this box edge to
  // edge, so the box's ratio IS the ring's roundness. The component stacks two absolutely
  // positioned <svg> fills inside it, which is why the ratio is declared rather than intrinsic.
  aspectRatio: "1",
  opacity: 1,
});

/* ── The crown's grounding ──────────────────────────────────────────────────────────────────────
 *
 * Everything here is positioned off the crown PNG's own geometry, which is the only way any of it
 * lands in the right place: the file is 512² and the opaque crown inside it spans y 33–467, so the
 * VISIBLE base sits at 0.912 of the box height, not at the bottom of it. Anchoring to the box
 * instead would float the flare ~15% of the crown's height below where the crown actually ends.
 *
 * Two layers, both measured off the comp as (pixel − page) luminance either side of the base:
 *
 *   flare    +8..10, a tight bright band ~14px ABOVE the base, reaching ~25px past the crown's
 *            silhouette on each side. It is what the crown appears to be standing in.
 *   shadow   starts LEVEL WITH THE RIM, not below it — the reference reads −9 three pixels ABOVE
 *            the crown's base and −6 eight pixels below, so it is cast by the widest part of the
 *            crown and spills sideways past it. Placing it below the base left the rim line
 *            measuring 0 where the reference is −9. It is what stops the
 *            crown floating, and it has to be warm — a neutral grey shadow on this page reads as
 *            dirt, because everything else in the room is warm.
 *
 * Both are behind the crown (z 0), so the crown occludes their middles and only the spill either
 * side is visible — which is exactly what the comp shows. */
const CROWN_BASE = 0.912; // fraction of the crown box at which the artwork's crown actually ends

const baseFlare = (size: string): CSSProperties => ({
  position: "absolute",
  zIndex: 0,
  pointerEvents: "none",
  left: "50%",
  top: `calc(${size} * ${CROWN_BASE - 0.097})`,
  transform: "translate(-50%, -50%)",
  width: `calc(${size} * 1.32)`,
  height: `calc(${size} * 0.13)`,
  filter: "blur(8px)",
  background:
    "radial-gradient(50% 50% at 50% 50%, rgba(255,253,248,1), rgba(255,250,238,.62) 40%, transparent 80%)",
});

const contactShadow = (size: string): CSSProperties => ({
  position: "absolute",
  zIndex: 0,
  pointerEvents: "none",
  left: "50%",
  top: `calc(${size} * ${CROWN_BASE + 0.005})`,
  transform: "translate(-50%, -50%)",
  width: `calc(${size} * 1.45)`,
  height: `calc(${size} * 0.19)`,
  filter: "blur(6px)",
  background:
    "radial-gradient(50% 50% at 50% 50%, rgba(110,102,104,.40), rgba(110,102,104,.15) 52%, transparent 80%)",
});

const crownImg = (size: string): CSSProperties => ({
  position: "relative",
  zIndex: 1,
  display: "block",
  width: size,
  height: size,
  margin: "0 auto",
  // NO drop-shadow. The art carries its own rendered lighting, and a cast shadow underneath is the
  // single loudest "this is an object sitting on top of the page" signal there is. The aura behind
  // it does the integrating instead — light around the crown rather than a shadow beneath it.
});
