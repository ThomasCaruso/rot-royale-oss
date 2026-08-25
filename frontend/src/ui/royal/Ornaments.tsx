import type { CSSProperties } from "react";
import { CONTOUR_BR, CONTOUR_TL, type OrnamentStroke } from "./ornamentPaths";

/**
 * The sign-in screen's ornament, as VECTORS.
 *
 * These were bitmaps first, and the bitmaps were wrong for a reason worth keeping. In the reference
 * comp the halo ring is a 1–2px line at 853px wide and each corner sweep is a hairline — the
 * thinness IS the crispness. The source renders are 941×1672, so a ring spanning ~320 CSS px went
 * through crop → downscale-to-a-sane-payload → browser upscale, and every one of those steps
 * spreads a line. It arrived as a 6px soft band. No opacity or size tuning fixes that, because a
 * bitmap is the wrong representation of a hairline.
 *
 * `scripts/trace_login_ornaments.py` therefore traces each CORNER stroke's centreline out of the
 * artwork and emits it as an SVG path (`ornamentPaths.ts`, generated — do not hand-edit). Those
 * shapes stay exactly the artist's, wobble and all, because on an organic sweep the wobble is the
 * character. The RING is the exception and is drawn as a true circle — see `HaloRing` for the
 * measurements behind that. Together the ornament went from 156 KB of PNG to ~8 KB of path data,
 * and is now resolution-independent: as sharp on a 3× phone as on this monitor.
 *
 * **`vectorEffect="non-scaling-stroke"` is what makes the widths mean anything.** Each block has a
 * viewBox in its own source-pixel units and is then scaled to a CSS size, so without it a stroke
 * width would be multiplied by whatever that scale happens to be, and the ring and the corners —
 * scaled very differently — would disagree about what a hairline is. With it, every width below is
 * CSS pixels, directly comparable, and independent of the box.
 *
 * Colours come from the theme (`--amber`, `--brand-2`) rather than the artwork's literal RGB, so
 * the ornament stays part of the palette. The per-stroke `w` from the tracer is the peak alpha that
 * stroke actually had in the render, so the relative weighting is still the artist's.
 */

/* Gold is the ring almost the whole way round; the render puts a lavender flare at the upper-right
 * and again at the lower-left, so a single diagonal gradient reproduces both. The mid stops are
 * lighter than the ends because the top of the arc is where the render's specular highlight sits. */
function RingGradient({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
        <stop offset="0%" stopColor="var(--brand-2)" />
        <stop offset="9%" stopColor="var(--amber)" />
        <stop offset="42%" stopColor="#E4BC63" />
        <stop offset="62%" stopColor="#E4BC63" />
        <stop offset="91%" stopColor="var(--amber)" />
        <stop offset="100%" stopColor="var(--brand-2)" />
      </linearGradient>
    </defs>
  );
}

/**
 * The halo — A TRUE CIRCLE, not a traced path, and that is a correction of a real defect.
 *
 * The ring WAS traced, like the corners are, and it came out visibly squiggly: a rounded polygon
 * with flats and kinks. The cause was not the artwork, which is what made it hard to see. Measured
 * as deviation from a perfect circle, stage by stage:
 *
 *     raw polar trace                       15.88%   (the argmax flipping between the render's
 *                                                     main stroke and its fainter second pass)
 *     + outlier reject + low-pass            0.95%   — as round as the comp's 0.92%
 *     + Douglas-Peucker simplification       3.44%   with chords up to 107px
 *
 * **Douglas-Peucker destroyed it.** DP's first split on a CLOSED curve is degenerate: its two
 * endpoints are adjacent points on the ring, so the reference chord is a few px long and every
 * perpendicular distance is measured against noise. The recursion bails early and leaves flats.
 * (The corner fans are unaffected — they are open chains, where that first split is meaningful.)
 *
 * The fix could have been a better simplifier, but a circle is the better answer: the cleaned trace
 * was 0.95% round and the comp is 0.92%, i.e. both are circles to within measurement noise, so the
 * traced wobble was worth exactly nothing and cost 8 KB of path data plus a pipeline that could
 * regress again. `<circle>` is exact at every size and cannot. The artwork still supplies
 * everything intentional about the ring — its radius, its gold-with-lavender colouring, its glow
 * and its weight; only the wobble is gone.
 *
 * Three concentric passes: a blurred glow, a mid bloom, and the hairline. That is how the comp's
 * ring reads when sampled — a thin core with a soft shoulder, not one soft band. The glow is its
 * own <svg> because SVG filter regions clip at the element's bounds and would cut the blur off
 * along the outside of the ring.
 *
 * A fourth pass — a fainter circle just inside the hairline, echoing the second stroke the render
 * actually draws — was tried and removed. At any radius far enough inside to be visible as an echo
 * it read as a SECOND RING, and at any radius close enough not to, it read as nothing. The comp
 * shows one line.
 *
 * THE MASK IS ELLIPTICAL, AND THAT IS A FIX. It used to be a `linear-gradient(to bottom)` on the
 * wrapping span, which is a RECTANGULAR mask: its iso-lines are horizontal, so the ring's left and
 * right arcs terminated at exactly the same height and the eye read the pair of endpoints as a
 * hard horizontal cut-off under the crown — a visible bounding box for something that is supposed
 * to be page ornament. It is now a radial field centred above the ring (see `rrHaloField`), so the
 * ring dissolves along a curve and there is no straight edge anywhere in the composition.
 *
 * The same mask still does the other job the linear one did: keeping the arc off the wordmark. At
 * the wordmark's cap height the ring sits at 0.925 of the field's radius, where the mask is 0.025.
 *
 * No `preserveAspectRatio="none"` here (unlike the corner fans): it is the one thing that could
 * turn this back into an egg if the box ever stopped being square.
 */
export function HaloRing({ style, className }: { style?: CSSProperties; className?: string }) {
  return (
    <span style={{ ...style, display: "block" }} className={className} aria-hidden>
      <svg viewBox="0 0 100 100" style={svgFill}>
        <RingGradient id="rrHaloLine" />
        <defs>
          {/* THE VISIBILITY FIELD — centred ABOVE the ring and SQUASHED vertically (scale y 0.7),
              which is what lets the ring die at the right clock positions.
              Traced off the reference, the ring's strength by clock position is: 12-1 o'clock full,
              3 o'clock 0.63, 3.7 o'clock 0.075, 4 o'clock ~0. That is a very fast collapse between
              3 and 4, and a CIRCULAR falloff cannot produce it — those two sit at nearly the same
              distance from any centre above the ring, so a circular field that is right at one is
              wrong at the other (measured: 0.25 at 3.7 where the reference is 0.075). Squashing
              the field makes downward distance count ~1.4x, which separates them: 3 o'clock lands
              at 0.70 of the radius, 3.7 at 0.87.
              Result: 12 o'clock 1.0, 3 o'clock 0.60, 3.7 o'clock 0.08, 4 o'clock 0. */}
          <radialGradient
            id="rrHaloField"
            cx="50"
            cy="16"
            r="100"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(50,16) scale(1,0.7) translate(-50,-16)"
          >
            <stop offset="0%" stopColor="#fff" />
            <stop offset="32%" stopColor="#fff" />
            <stop offset="58%" stopColor="#fff" stopOpacity="0.88" />
            <stop offset="72%" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="84%" stopColor="#fff" stopOpacity="0.14" />
            <stop offset="94%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id="rrHaloMask">
            <rect x="-40" y="-40" width="180" height="180" fill="url(#rrHaloField)" />
          </mask>
          {/* Where the ring goes SOFT rather than simply stopping. WIDE AND SHORT (scale y 0.45),
              so it lands on the left and right flanks — where the ring is dying — and reaches
              neither the top arc, which must stay crisp, nor the bottom, which is already gone.
              This is the reference's "brighter and softer just before it disappears". */}
          <radialGradient
            id="rrHaloDissolveField"
            cx="50"
            cy="52"
            r="60"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(50,52) scale(1,0.45) translate(-50,-52)"
          >
            <stop offset="0%" stopColor="#fff" />
            <stop offset="50%" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id="rrHaloDissolve">
            <rect x="-40" y="-40" width="180" height="180" fill="url(#rrHaloDissolveField)" />
          </mask>
        </defs>

        <g mask="url(#rrHaloMask)">
          {/* outer glow */}
          <g style={{ filter: "blur(9px)" }}>
            <circle
              cx={50}
              cy={50}
              r={50}
              fill="none"
              stroke="url(#rrHaloLine)"
              strokeWidth={9}
              strokeOpacity={0.3}
              vectorEffect="non-scaling-stroke"
            />
          </g>
          {/* mid bloom */}
          <circle
            cx={50}
            cy={50}
            r={50}
            fill="none"
            stroke="url(#rrHaloLine)"
            strokeWidth={3}
            strokeOpacity={0.2}
            vectorEffect="non-scaling-stroke"
          />
          {/* The hairline. 1.1px is the reference's ring measured at this size; below ~0.9 it
              starts to disappear into the page on a 1x display, above ~1.4 it stops reading as a
              hairline. */}
          <circle
            cx={50}
            cy={50}
            r={50}
            fill="none"
            stroke="url(#rrHaloLine)"
            strokeWidth={1.1}
            strokeOpacity={0.92}
            vectorEffect="non-scaling-stroke"
          />
          {/* THE DISSOLVE — brighter AND softer on the lower flanks, so the ring appears to be
              absorbed by the light gathering around the crown rather than to simply fade out. */}
          <g mask="url(#rrHaloDissolve)" style={{ filter: "blur(5px)" }}>
            <circle
              cx={50}
              cy={50}
              r={50}
              fill="none"
              stroke="#F7DFA8"
              strokeWidth={6}
              strokeOpacity={0.34}
              vectorEffect="non-scaling-stroke"
            />
          </g>
          {/* THE SPECULAR. A ~55 degree segment at 10-11 o'clock, brighter than the rest of the
              stroke. A circle of even weight reads as drawn; one bright arc reads as a highlight,
              i.e. as a lit object. Placed by stroke-dasharray along the circumference: 2*pi*r =
              314.16 user units, so a 55 degree dash is 48, and the offset that starts it at 10:30
              (225 degrees clockwise from 3 o'clock, where SVG circles begin) is -196.
              NO non-scaling-stroke here, deliberately: that effect puts dasharray into screen
              pixels too, which would slide the highlight to a different clock position on every
              viewport width. In user units it stays at 10:30 everywhere.
              It is a BLOOM, not a paler line. A near-white stroke was tried first and vanished --
              on a 248-bright cream page there is almost no headroom above the background, so
              "brighter" has to be carried by a wide soft warm glow rather than by stroke colour. */}
          <g style={{ filter: "blur(4px)" }}>
            <circle
              cx={50}
              cy={50}
              r={50}
              fill="none"
              stroke="#F7D68C"
              strokeWidth={3.4}
              strokeOpacity={0.55}
              strokeLinecap="round"
              strokeDasharray="48 314.16"
              strokeDashoffset={-196}
            />
            <circle
              cx={50}
              cy={50}
              r={50}
              fill="none"
              stroke="#FFEFC4"
              strokeWidth={1.1}
              strokeOpacity={0.9}
              strokeLinecap="round"
              strokeDasharray="34 314.16"
              strokeDashoffset={-203}
            />
          </g>
        </g>
      </svg>
    </span>
  );
}

/**
 * The FIELD ARCS — two or three ultra-thin arcs behind the crown that make the background look like
 * it bends around it.
 *
 * The main halo alone leaves the page reading as a flat sheet with a ring drawn on it. What sells
 * "the crown is embedded in this scene" is the light appearing to compress as it nears the crown,
 * and that is cheap to fake with nested arcs that do three things at once:
 *
 *   0. **They live on the crown's lower flanks** — lower-left, behind, lower-right — which is
 *      where the reference shows the field disturbed, and the only place they can be seen at all
 *      (anything crossing the crown is occluded by it).
 *   1. **They are SEGMENTS, not ovals.** One short sweep over each shoulder, nothing across the top
 *      or out at the sides. This is the difference between the effect working and not: the first
 *      attempt drew closed ellipses and the result was unmistakably a TARGET — four countable
 *      concentric rings. A curve that starts and ends near the crown reads as light bending around
 *      it; a curve that closes reads as a ring, no matter how faint you make it.
 *   2. **Closing gaps.** Radii 34 / 29.5 / 26.5 — gaps of 4.5 then 3. It is the DECREASING spacing,
 *      not the count, that reads as compression; evenly spaced arcs read as a diagram.
 *   3. **Increasing vertical squash** (ry/rx 0.91 → 0.88 → 0.85) with the centres drifting DOWN
 *      (50 → 51.5 → 53), so each arc is flatter than the last and the family tips onto the crown's
 *      body rather than its bounding box.
 *
 * Sized so the innermost arc grazes the crown's tips (the crown's half-height is 23.6 of these
 * units, the tightest ry is 22.5) and the outermost clears them by ~7. Round caps let each segment
 * taper out instead of stopping; the radial mask fades whatever is left as it travels away from the
 * crown, and the caller adds a vertical fade so nothing can reach the wordmark.
 *
 * All three are behind the crown (the caller puts them at z 0), so their middles are occluded and
 * only the part arcing over and around the crown is ever visible.
 */
/** One elliptical arc SEGMENT, from angle a0 to a1 (degrees, 0 = 3 o'clock, clockwise on screen). */
function arcSeg(cy: number, rx: number, ry: number, a0: number, a1: number): string {
  const pt = (deg: number) => {
    const t = (deg * Math.PI) / 180;
    return [50 + rx * Math.cos(t), cy + ry * Math.sin(t)];
  };
  const [x0, y0] = pt(a0);
  const [x1, y1] = pt(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${rx} ${ry} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function CrownFieldArcs({ style }: { style?: CSSProperties }) {
  // rx / ry / cy per arc, then a stroke width and opacity. Angles are shared: one segment over each
  // shoulder, nothing across the top or the sides.
  const arcs = [
    { rx: 30, ry: 27.5, cy: 50, w: 0.9, o: 0.34 },
    { rx: 26.5, ry: 23.5, cy: 51.5, w: 0.8, o: 0.27 },
    { rx: 24, ry: 20.5, cy: 53, w: 0.7, o: 0.21 },
  ];
  // Lower-LEFT and lower-RIGHT of the crown, not its shoulders: that is where the reference shows
  // the field disturbed, and it is also where these can be seen at all — anything crossing the
  // crown itself is occluded. 0 degrees is 3 o'clock, increasing clockwise on screen.
  const SPANS: [number, number][] = [
    [118, 208], // sweeps from just under the crown's base-left, out and up the left side
    [332, 422], // mirror; wraps through 0, which arcSeg handles from the endpoints
  ];
  return (
    <span style={{ ...style, display: "block" }} aria-hidden>
      <svg viewBox="0 0 100 100" style={svgFill}>
        <defs>
          <linearGradient id="rrFieldStroke" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--brand-2)" />
            <stop offset="22%" stopColor="var(--amber)" />
            <stop offset="55%" stopColor="#E4BC63" />
            <stop offset="88%" stopColor="var(--amber)" />
            <stop offset="100%" stopColor="var(--brand-2)" />
          </linearGradient>
          {/* Radial, centred on the crown — never a vertical fade. It is what keeps these local to
              the crown, and it is also the only thing holding them off the wordmark: the lowest
              point of the outer arc sits 28.5 units below this centre, inside r=40, and lands
              ~23px clear of the wordmark's cap height at every supported size. */}
          <radialGradient id="rrFieldFalloff" cx="50" cy="49" r="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fff" stopOpacity="1" />
            <stop offset="58%" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id="rrFieldMask">
            <rect x="-40" y="-40" width="180" height="180" fill="url(#rrFieldFalloff)" />
          </mask>
        </defs>
        {/* BLURRED, and that is not a detail. Unblurred these read as scratches — drawn ink around
            the crown. 1.4px of blur on a sub-pixel stroke turns each into a soft filament, which is
            what light compressing looks like. It is the difference between the effect landing and
            looking like a mistake. */}
        <g mask="url(#rrFieldMask)" style={{ filter: "blur(1.4px)" }}>
          {arcs.map((a, i) =>
            SPANS.map(([s0, s1], j) => (
              <path
                key={`${i}-${j}`}
                d={arcSeg(a.cy, a.rx, a.ry, s0, s1)}
                fill="none"
                stroke="url(#rrFieldStroke)"
                strokeWidth={a.w}
                strokeOpacity={a.o}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))
          )}
        </g>
      </svg>
    </span>
  );
}

/** One corner's fan. `w` per stroke is the artwork's own peak alpha there — see the tracer. */
function ContourFan({
  block,
  style,
}: {
  block: { w: number; h: number; strokes: OrnamentStroke[] };
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox={`0 0 ${block.w} ${block.h}`}
      style={{ ...style, display: "block" }}
      preserveAspectRatio="none"
      aria-hidden
    >
      {block.strokes.map((s, i) => (
        <path
          key={i}
          d={s.d}
          fill="none"
          stroke={s.lav ? "var(--brand-2)" : "var(--amber)"}
          strokeWidth={0.9}
          // The tracer's peak alpha, floored so the faintest stroke still registers and scaled so
          // the strongest lands near the comp's line contrast rather than at full ink.
          strokeOpacity={Math.min(0.62, 0.18 + s.w * 0.5)}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export function ContourTopLeft({ style }: { style?: CSSProperties }) {
  return <ContourFan block={CONTOUR_TL} style={style} />;
}

export function ContourBottomRight({ style }: { style?: CSSProperties }) {
  return <ContourFan block={CONTOUR_BR} style={style} />;
}

const svgFill: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  display: "block",
  overflow: "visible",
};
