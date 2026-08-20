import { useId } from "react";

/**
 * Gem — pure SVG, the currency mark for Gems (the duel/skill currency, distinct from gold coins).
 * A faceted diamond with a bright crown, table highlight, and darker pavilion facets reads
 * unmistakably as a precious, non-coin currency, and being SVG it renders identically on iOS
 * Safari / Android / desktop (no emoji-font variance). The face color is driven from
 * `currentColor` (set to var(--brand-2), the violet/brand token) so it re-skins per theme;
 * highlight and shade stops mirror the brand/cyan ramp. Decorative → aria-hidden.
 */
export function GemIcon({
  size = 18,
  style,
}: {
  size?: number | string;
  style?: React.CSSProperties;
}) {
  const gid = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-hidden
      style={{ width: size, height: size, display: "block", color: "var(--brand-2)", ...style }}
    >
      <defs>
        <linearGradient id={gid} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="var(--cyan)" />
          <stop offset="45%" stopColor="currentColor" />
          <stop offset="100%" stopColor="#3b1d6e" />
        </linearGradient>
      </defs>
      {/* Gem silhouette: flat crown table on top, tapering to a point. */}
      <path
        d="M5 4 H19 L22 9 L12 21 L2 9 Z"
        fill={`url(#${gid})`}
        stroke="#2a1455"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      {/* Crown facet edges: girdle line + the two table-to-girdle diagonals. */}
      <path
        d="M2 9 H22 M5 4 L8.5 9 L12 21 M19 4 L15.5 9 L12 21 M8.5 9 H15.5"
        fill="none"
        stroke="#1a0e38"
        strokeWidth={0.7}
        opacity={0.7}
      />
      {/* Bright table highlight (top-left). */}
      <path d="M5.4 4.5 L8.4 8.6 L11.6 8.6 L9 4.5 Z" fill="#FFFFFF" opacity={0.45} />
    </svg>
  );
}
