import { useId } from "react";
import { useArtStyle } from "@/theme/useArtStyle";

/**
 * Circular gold countdown ring (DESIGN §4) — the primary timer, built like a watch face:
 *  - a dark violet TRACK with a glass inner face behind the number (depth, not a flat line);
 *  - the progress arc strokes a GOLD GRADIENT (highlight → amber → deep gold) with a bright comet
 *    dot riding its head, so the depletion reads as a lit fuse;
 *  - the bold seconds number glows in the display face.
 * Under 30% remaining the arc/number flip to the theme's red and the ring pulses; in the final ~3s
 * the pulse tightens and a soft red halo breathes behind it (transform/box-shadow only — GPU-cheap,
 * and the global reduced-motion media query collapses the animations to a static red state).
 * Pure SVG; the dasharray does the depletion (cheap). The red ramp is only ever emitted while low,
 * so a fresh round's markup carries no red/green (the in-play anti-cheat render stays calm).
 */
export function CountdownRing({
  remainingMs,
  totalMs,
  size = 68,
}: {
  remainingMs: number;
  totalMs: number;
  size?: number;
}) {
  const gid = useId();
  const mono = useArtStyle() === "mono";
  const frac = Math.max(0, Math.min(1, remainingMs / totalMs));
  const low = frac < 0.3;
  const seconds = Math.ceil(remainingMs / 1000);
  // "urgent" is the last few seconds — drives a tighter pulse + the breathing red halo.
  const urgent = remainingMs <= 3000 && remainingMs > 0;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = low ? "var(--pink)" : "var(--amber)";

  // Mono ("Blank"): a thin instrument dial — hairline track, a solid ink arc (red only when low,
  // the one functional color), a plain number. No gradient fuse, no glow, no comet, no pulse.
  if (mono) {
    const mStroke = 3.5;
    const mr = (size - mStroke) / 2;
    const mc = 2 * Math.PI * mr;
    const mColor = low ? "var(--pink)" : "var(--text)";
    return (
      <div style={{ width: size, height: size, flexShrink: 0, position: "relative" }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={mr} fill="none" stroke="var(--line)" strokeWidth={mStroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={mr}
            fill="none"
            stroke={mColor}
            strokeWidth={mStroke}
            strokeLinecap="round"
            strokeDasharray={mc}
            strokeDashoffset={mc * (1 - frac)}
            style={{ transition: "stroke-dashoffset 80ms linear" }}
          />
        </svg>
        <span
          className="display"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            fontSize: size * 0.38,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            color: mColor,
          }}
        >
          {seconds}
        </span>
      </div>
    );
  }
  // The comet at the arc's head (the svg is rotated -90°, so angle 0 = 12 o'clock, clockwise).
  const head = 2 * Math.PI * frac;
  const hx = size / 2 + r * Math.cos(head);
  const hy = size / 2 + r * Math.sin(head);

  // Outer wrapper carries the breathing red halo in the final seconds; inner scales with the pulse so
  // the halo position stays steady while the dial throbs.
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        animation: urgent ? "rr-ring-glow 0.66s ease-in-out infinite" : "none",
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          position: "relative",
          animation: urgent
            ? "rr-ring-urgent 0.66s ease-in-out infinite"
            : low
              ? "rr-ring-pulse 0.7s ease-in-out infinite"
              : "none",
        }}
      >
        {/* overflow:visible — the arc's glow + the comet's halo extend past the viewBox edge (the
            stroke runs right at the svg boundary), and the default hidden overflow was slicing them. */}
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)", overflow: "visible" }}>
          <defs>
            {/* One gradient, ramped for the CURRENT state only (the red stops never exist in a calm
                round's markup). */}
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              {low ? (
                <>
                  <stop offset="0%" stopColor="color-mix(in srgb, var(--pink) 60%, white)" />
                  <stop offset="100%" stopColor="var(--pink)" />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor="#FFE9A8" />
                  <stop offset="55%" stopColor="var(--amber)" />
                  <stop offset="100%" stopColor="#D98E00" />
                </>
              )}
            </linearGradient>
          </defs>
          {/* Glass inner face behind the number. */}
          <circle cx={size / 2} cy={size / 2} r={Math.max(0, r - stroke / 2 - 1)} fill="rgba(10,5,24,.55)" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={Math.max(0, r - stroke / 2 - 1)}
            fill="none"
            stroke="rgba(255,255,255,.06)"
            strokeWidth={1}
          />
          {/* Track — dark violet, an unlit fuse rather than a flat grey line. */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="color-mix(in srgb, var(--brand-2) 20%, #140c28)"
            strokeWidth={stroke}
          />
          {/* Progress arc — the lit gradient fuse. */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#${gid})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - frac)}
            style={{
              transition: "stroke-dashoffset 80ms linear",
              filter: low
                ? "drop-shadow(0 0 5px var(--pink))"
                : "drop-shadow(0 0 4px color-mix(in srgb, var(--amber) 80%, transparent))",
            }}
          />
          {/* Comet dot riding the head of the arc. */}
          {frac > 0.015 && (
            <circle
              cx={hx}
              cy={hy}
              r={2.7}
              fill="#fff"
              style={{ filter: `drop-shadow(0 0 4px ${low ? "var(--pink)" : "var(--amber)"})` }}
            />
          )}
        </svg>
        <span
          className="display"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            fontSize: size * 0.44,
            lineHeight: 1,
            color,
            textShadow: `0 2px 4px rgba(0,0,0,.55), 0 0 12px color-mix(in srgb, ${low ? "var(--pink)" : "var(--amber)"} 45%, transparent)`,
          }}
        >
          {seconds}
        </span>
      </div>
    </div>
  );
}
