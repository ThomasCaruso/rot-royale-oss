// Pure helpers for the campaign quest-trail rendering (kept out of scenery.tsx so that file only
// exports components — react-refresh requirement).

/** Sparkle-speckle field in the world's spark colour. */
export function specklesOf(spark: string): React.CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    backgroundImage:
      `radial-gradient(1.4px 1.4px at 72% 18%, ${spark}, transparent),` +
      `radial-gradient(1.2px 1.2px at 88% 56%, rgba(255,255,255,.5), transparent),` +
      `radial-gradient(1.5px 1.5px at 24% 82%, ${spark}, transparent),` +
      `radial-gradient(1.2px 1.2px at 10% 30%, rgba(255,255,255,.4), transparent)`,
    opacity: 0.6,
  };
}

export interface Pt {
  x: number;
  y: number;
}

/**
 * Per-stop placement for the perspective quest map. Stops are passed NEAR→FAR (index 0 = bottom of
 * screen / first level, last = the far summit). Geometry is keyed to each stop's distance AHEAD of
 * the current mission so the road swings wide and tall in the foreground and converges + compresses
 * toward a vanishing point near the top — "into the distance".
 */
export interface PerspectiveStop {
  xFrac: number; // horizontal centre as a fraction of width [0..1]
  gapAbove: number; // px gap to the next (upper) stop; 0 for the topmost
  depth: number; // 0 = nearest (bottom) .. 1 = farthest (top)
  distAhead: number; // index − currentIndex (negative = already behind/cleared)
  recedeScale: number; // 1.0 near .. ~0.82 far-ahead — apply only to receding future nodes
}

const LAYOUT = {
  gapNear: 150, // vertical centre-to-centre spacing in the foreground
  gapFar: 116, //   …compressing with distance
  amp: 0.24, // max horizontal swing as a fraction of width (keeps labels off both edges)
  freq: 1.2, // radians of serpentine per stop
  phase: 0.6, // start the first stop off-centre
  converge: 0.88, // how strongly the swing collapses toward centre at the summit
  recede: 0.15, // how much far nodes shrink (1 − recede at the summit)
} as const;

/** Pure placement model for the quest map (unit-tested). `count` stops, current mission at
 * `currentIndex` (clamped). Returns one entry per stop in the same NEAR→FAR order. */
export function perspectiveLayout(count: number, currentIndex: number): PerspectiveStop[] {
  if (count <= 0) return [];
  const cur = Math.min(Math.max(currentIndex, 0), count - 1);
  const stepsToTop = Math.max(1, count - 1 - cur);
  const out: PerspectiveStop[] = [];
  for (let i = 0; i < count; i++) {
    const depth = count > 1 ? i / (count - 1) : 0;
    const distAhead = i - cur;
    const aheadFactor = Math.min(1, Math.max(0, distAhead) / stepsToTop); // 0 at/below current → 1 at top
    const amp = LAYOUT.amp * (1 - LAYOUT.converge * aheadFactor);
    const xFrac = 0.5 + amp * Math.sin(i * LAYOUT.freq + LAYOUT.phase);
    const recedeScale = 1 - LAYOUT.recede * aheadFactor;
    const gapAbove = i === count - 1 ? 0 : LAYOUT.gapNear + (LAYOUT.gapFar - LAYOUT.gapNear) * depth;
    out.push({ xFrac, gapAbove, depth, distAhead, recedeScale });
  }
  return out;
}

/** Smooth Catmull-Rom → cubic-bezier path through measured points (the board-game trail). */
export function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  const d: string[] = [`M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d.push(
      `C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
    );
  }
  return d.join(" ");
}
