import type { CSSProperties } from "react";

/**
 * Skeleton loading placeholders: neutral pulsing blocks shaped like the content they stand in
 * for, so a loading screen keeps the page's layout instead of a bare "Loading…" line. Styling
 * lives in global.css (.rr-skeleton) and derives from theme tokens, so skeletons read correctly
 * on every theme; the pulse is opacity-only and drops under prefers-reduced-motion.
 *
 * Decorative by definition — always aria-hidden. Screens should pair a skeleton layout with an
 * aria-live status string if the loading state needs announcing.
 */
export function Skeleton({
  width = "100%",
  height = 16,
  radius = 10,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className="rr-skeleton"
      style={{ width, height, borderRadius: radius, flex: "none", ...style }}
    />
  );
}

/** A standard list-row skeleton: leading circle (avatar/icon) + two text lines. */
export function SkeletonRow({ style }: { style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, ...style }}>
      <Skeleton width={40} height={40} radius={999} />
      <div style={{ flex: 1, display: "grid", gap: 8 }}>
        <Skeleton width="55%" height={12} />
        <Skeleton width="30%" height={10} />
      </div>
      <Skeleton width={44} height={14} />
    </div>
  );
}
