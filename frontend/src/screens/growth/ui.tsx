/**
 * Shared primitives for the "Your Growth" screen — one refined card system.
 * Everything is driven by the theme tokens (the default Blank Light theme renders the soft
 * cream / lavender / green look the design targets), so the screen stays coherent on every theme.
 */

import type React from "react";

/** Section label — the app's single lavender accent moment: the AI/system identity marker above
 * every card (BRAIN PROFILE / ROT SCORE / AI INSIGHT / CONSISTENCY). Uppercase, letter-spaced. */
export function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--brand)",
      }}
    >
      {children}
    </div>
  );
}

export function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        width: 40,
        height: 40,
        borderRadius: 999,
        border: "1px solid var(--line)",
        background: "var(--panel)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: "var(--text)",
        boxShadow: "0 6px 18px rgba(20, 16, 10, 0.05)",
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M15 5l-7 7 7 7"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

type Pt = readonly [number, number];

/** Light Catmull-Rom → cubic-bezier smoothing so the trend reads as a gentle rising curve with
 * real movement, not a hard zig-zag or a sterile straight diagonal. Low tension keeps it calm. */
function smoothPath(pts: readonly Pt[]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  const t = 0.18;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

// A gentle synthetic rise for the empty state — the same upward shape the real trend takes, so an
// account with no history still reads as "your progress goes here", not a broken/blank card.
const PLACEHOLDER_TREND = [12, 16, 14, 20, 25, 23, 30, 34, 33, 40, 44, 50];

/**
 * The Brain Score sparkline — a super-minimal soft purple HAZE rising upward: a faint lavender area
 * wash under a thin lavender line and a small end dot. No axes, no grid, no labels, no inner card.
 * With fewer than two real points it still draws — a faint grey dashed rise as a placeholder, so
 * the card always shows the "up and to the right" shape. Values map left→right, min→bottom, max→top.
 */
export function Sparkline({
  values,
  width = 230,
  height = 120,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  const placeholder = values.length < 2;
  const data = placeholder ? PLACEHOLDER_TREND : values;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padX = 6;
  const padTop = 14;
  const padBottom = 12;
  const w = width - padX * 2;
  const h = height - padTop - padBottom;
  const pts: Pt[] = data.map((v, i) => {
    const x = padX + (i / (data.length - 1)) * w;
    const y = padTop + (1 - (v - min) / range) * h;
    return [x, y] as const;
  });
  const line = smoothPath(pts);
  const [ex, ey] = pts[pts.length - 1];
  const area = `${line} L${ex.toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;

  // Empty state: a faint grey outline of the rise with the softest grey wash — reads as a chart
  // waiting for data, not a broken card.
  if (placeholder) {
    return (
      <svg
        className="sparkline"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden
        style={{ display: "block", width: "100%", height: "auto" }}
      >
        <path d={area} fill="color-mix(in srgb, var(--muted) 8%, transparent)" />
        <path
          d={line}
          fill="none"
          stroke="color-mix(in srgb, var(--muted) 50%, transparent)"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="3 5"
        />
      </svg>
    );
  }

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      style={{ display: "block", width: "100%", height: "auto" }}
    >
      <defs>
        <linearGradient id="rrRotSpark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.38} />
          <stop offset="55%" stopColor="var(--brand)" stopOpacity={0.14} />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* The purple haze — the star of the chart — rising up and to the right. */}
      <path d={area} fill="url(#rrRotSpark)" />
      {/* The lavender progression line over the haze. */}
      <path
        d={line}
        fill="none"
        stroke="var(--brand)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End point — a soft halo behind a solid dot, a little life at the leading edge. */}
      <circle cx={ex} cy={ey} r={7.5} fill="color-mix(in srgb, var(--brand) 18%, transparent)" />
      <circle cx={ex} cy={ey} r={4} fill="var(--brand)" />
    </svg>
  );
}
