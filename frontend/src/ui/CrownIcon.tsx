import { useId } from "react";

/**
 * Gold crown brand mark — pure SVG, not the 👑 emoji. The emoji renders inconsistently across
 * platforms (Apple/Segoe/Noto each draw a different crown) and on iOS Safari it interacts badly
 * with the header drop-shadow, so the brand mark uses a deterministic SVG instead. The mid gold is
 * driven from `currentColor` (set to var(--amber)) so it re-skins per theme; the highlight/shade
 * stops mirror the gold ramp in global.css. A softer separate band gradient + a top sheen + pearl
 * jewels (brand violet) keep it reading as a refined, jeweled crown even at 12px. Decorative →
 * aria-hidden.
 */
export function CrownIcon({
  size = 32,
  style,
}: {
  size?: number | string;
  style?: React.CSSProperties;
}) {
  const gid = useId();
  const bandId = `${gid}-b`;
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-hidden
      style={{
        width: size,
        height: size,
        display: "block",
        color: "var(--amber)",
        filter: "drop-shadow(0 2px 4px rgba(74,48,0,.35))",
        ...style,
      }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF3CF" />
          <stop offset="46%" stopColor="currentColor" />
          <stop offset="100%" stopColor="#A96E00" />
        </linearGradient>
        <linearGradient id={bandId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" />
          <stop offset="100%" stopColor="#8F5E00" />
        </linearGradient>
      </defs>
      {/* Crown body: three peaks with softly rounded tips over a straight base. */}
      <path
        d="M4.6 15 L3.6 7.65 C3.55 7.2 4.02 6.95 4.38 7.22 L8 9.95 L11.2 4.5 C11.55 3.85 12.45 3.85 12.8 4.5 L16 9.95 L19.62 7.22 C19.98 6.95 20.45 7.2 20.4 7.65 L19.4 15 Z"
        fill={`url(#${gid})`}
        stroke="#7E5200"
        strokeWidth={0.5}
        strokeLinejoin="round"
      />
      {/* Soft upper-left sheen — a refined light-catch, not a hard highlight. */}
      <path d="M4.9 8.4 L8.1 10.7 L11.4 5.4 L11.4 13.4 L5.4 13.4 Z" fill="#FFFFFF" opacity={0.13} />
      {/* Jeweled base band (slightly deeper gold for depth). */}
      <rect x="4.35" y="15" width="15.3" height="4" rx="1.7" fill={`url(#${bandId})`} stroke="#7E5200" strokeWidth={0.5} />
      <path d="M6 16.9 H18" stroke="#FFF3CF" strokeOpacity={0.5} strokeWidth={0.7} strokeLinecap="round" />
      {/* Pearls at the peaks + a centre gem on the band (brand violet against the gold). */}
      <circle cx="12" cy="4.35" r="1.55" fill="var(--brand-2)" stroke="#FFF3CF" strokeWidth={0.5} />
      <circle cx="3.75" cy="7.35" r="1.15" fill="var(--brand-2)" stroke="#FFF3CF" strokeWidth={0.4} />
      <circle cx="20.25" cy="7.35" r="1.15" fill="var(--brand-2)" stroke="#FFF3CF" strokeWidth={0.4} />
      <circle cx="12" cy="17" r="1.15" fill="var(--brand-2)" stroke="#FFF3CF" strokeWidth={0.45} />
    </svg>
  );
}
