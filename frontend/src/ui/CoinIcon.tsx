import { useId } from "react";

/**
 * Gold coin — pure SVG, the currency mark for coins (replaces the old ◆ diamond glyph). A raised
 * rim ring + top-left highlight + a small star emblem read unmistakably as a game coin, and being
 * SVG it renders identically on iOS Safari / Android / desktop (no emoji-font variance). The face
 * gold is driven from `currentColor` (set to var(--amber)) so it re-skins per theme; highlight and
 * shade stops mirror the gold ramp in global.css. Decorative → aria-hidden.
 */
export function CoinIcon({
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
      style={{ width: size, height: size, display: "block", color: "var(--amber)", ...style }}
    >
      <defs>
        <radialGradient id={gid} cx="36%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#FFE9A8" />
          <stop offset="55%" stopColor="currentColor" />
          <stop offset="100%" stopColor="#9A6B00" />
        </radialGradient>
      </defs>
      {/* Coin face + outer edge. */}
      <circle cx="12" cy="12" r="11" fill={`url(#${gid})`} stroke="#8A5A00" strokeWidth={0.8} />
      {/* Raised rim ring. */}
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="#B97900" strokeWidth={1.3} />
      {/* Star emblem. */}
      <path
        d="M12 7.4 L13.15 10.85 L16.6 11 L13.85 13.15 L14.8 16.5 L12 14.5 L9.2 16.5 L10.15 13.15 L7.4 11 L10.85 10.85 Z"
        fill="#8A5A00"
        opacity={0.9}
      />
      {/* Top-left highlight. */}
      <ellipse cx="8.4" cy="7.4" rx="3" ry="2" fill="#FFFFFF" opacity={0.4} />
    </svg>
  );
}
