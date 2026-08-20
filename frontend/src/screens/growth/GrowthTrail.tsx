/**
 * GrowthTrail — a clean, restrained trend line. Ownable through proportion and line treatment, not
 * effects: a single violet stroke over a whisper-soft fill, a quiet origin dot and one solid current
 * dot. No area drama, no glow, no crowns, no plumb line. Drawn against an explicit plot region so
 * nothing clips: scores map into y∈[46,96] of a 244×142 viewBox, captions sit below. Pure; renders
 * cleanly with <2 points.
 */

import { SERIF } from "./styles";

export interface GrowthTrailProps {
  points: number[]; // oldest → newest
  reduced: boolean;
  startValue?: number;
  endValue?: number;
  startCaption?: string;
  endCaption?: string;
  /** Hero mode: suppress the trail's own end-value number (the big Brain Score sits above instead). */
  hideEndValue?: boolean;
}

type Pt = readonly [number, number];

const VW = 244;
const VH = 142;
const PLOT_X0 = 14;
const PLOT_X1 = 230;
const PLOT_Y_TOP = 46;
const PLOT_Y_BOTTOM = 96;
const BASELINE = 102;
const CAP_Y = 126;

function smooth(pts: readonly Pt[]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  const t = 0.26;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d += ` C${(p1[0] + (p2[0] - p0[0]) * t).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) * t).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) * t).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) * t).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export function GrowthTrail({ points, reduced, startValue, endValue, startCaption, endCaption, hideEndValue }: GrowthTrailProps) {
  void reduced;
  if (points.length === 0) {
    return <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="100%" aria-hidden style={{ display: "block" }} />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const single = points.length < 2;

  const px = (i: number) => (single ? PLOT_X1 : PLOT_X0 + (i / (points.length - 1)) * (PLOT_X1 - PLOT_X0));
  const py = (v: number) => PLOT_Y_BOTTOM - ((v - min) / range) * (PLOT_Y_BOTTOM - PLOT_Y_TOP);
  const pts: Pt[] = points.map((v, i) => [px(i), py(v)]);
  const line = smooth(pts);
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[pts.length - 1];
  const area = single ? "" : `${line} L${ex.toFixed(1)},${BASELINE} L${sx.toFixed(1)},${BASELINE} Z`;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
      role="img" aria-label="Brain Score trend" style={{ display: "block" }}>
      <defs>
        <linearGradient id="gr-line-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.13} />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
        </linearGradient>
      </defs>

      {!single && (
        <>
          <path d={area} fill="url(#gr-line-fill)" />
          <path d={line} fill="none" stroke="var(--brand)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={sx} cy={sy} r={3} fill="var(--panel)" stroke="var(--brand)" strokeWidth={1.8} />
        </>
      )}

      {!single && startValue !== undefined && (
        <text x={PLOT_X0} y={CAP_Y - 10} textAnchor="start" fontFamily={SERIF} fontSize={12.5} fontWeight={700} fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
          {startValue}
        </text>
      )}
      {!single && startCaption && (
        <text x={PLOT_X0} y={CAP_Y} textAnchor="start" fontSize={7.5} fontWeight={700} letterSpacing="0.07em" fill="var(--faint)">
          {startCaption.toUpperCase()}
        </text>
      )}

      {/* Current position — one solid dot, no halo. */}
      <circle cx={ex} cy={ey} r={5} fill="var(--brand)" stroke="var(--panel)" strokeWidth={2} />
      {endValue !== undefined && !hideEndValue && (
        <text x={PLOT_X1} y={Math.max(14, ey - 12)} textAnchor="end" fontFamily={SERIF} fontSize={14} fontWeight={700} fill="var(--text)" style={{ fontVariantNumeric: "tabular-nums" }}>
          {endValue}
        </text>
      )}
      {endCaption && (
        <text x={PLOT_X1} y={CAP_Y} textAnchor="end" fontSize={7.5} fontWeight={700} letterSpacing="0.07em" fill="var(--faint)">
          {endCaption.toUpperCase()}
        </text>
      )}
    </svg>
  );
}
