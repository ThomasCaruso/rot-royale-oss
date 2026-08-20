import { useId } from "react";

/**
 * Brand skull-with-crown mark (pure SVG) for the Home wordmark lockup — a bone-white skull with a
 * gold crown perched on top, echoing the mock's logo. Decorative → aria-hidden; the wordmark text
 * carries the accessible name. Gold ramp mirrors CrownIcon / the .display gold so it re-skins per
 * theme via --amber; the skull is a fixed bone white so it reads on the dark violet world.
 */
export function SkullCrownIcon({
  size = 40,
  style,
}: {
  size?: number | string;
  style?: React.CSSProperties;
}) {
  const gid = useId();
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-hidden
      style={{
        width: size,
        height: size,
        display: "block",
        filter: "drop-shadow(0 3px 6px rgba(0,0,0,.55))",
        ...style,
      }}
    >
      <defs>
        <linearGradient id={`${gid}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFE9A8" />
          <stop offset="52%" stopColor="var(--amber)" />
          <stop offset="100%" stopColor="#B97900" />
        </linearGradient>
        <linearGradient id={`${gid}-bone`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#cdc6dd" />
        </linearGradient>
      </defs>

      {/* Crown on top — three peaks over a band. */}
      <g>
        <path
          d="M13 12 L17.5 16 L24 9 L30.5 16 L35 12 L33.5 21 L14.5 21 Z"
          fill={`url(#${gid}-gold)`}
          stroke="#8A5A00"
          strokeWidth={0.7}
          strokeLinejoin="round"
        />
        <circle cx="24" cy="10.4" r="1.5" fill="var(--brand-2)" stroke="#FFE9A8" strokeWidth={0.5} />
      </g>

      {/* Skull cranium + jaw. */}
      <path
        d="M24 19 C15.7 19 11 24.3 11 31 C11 35 13 37.4 15.4 38.6 L15.4 42.2 C15.4 43.2 16.2 44 17.2 44 L30.8 44 C31.8 44 32.6 43.2 32.6 42.2 L32.6 38.6 C35 37.4 37 35 37 31 C37 24.3 32.3 19 24 19 Z"
        fill={`url(#${gid}-bone)`}
        stroke="#9d95b3"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      {/* Eye sockets (glowing violet) + nose. */}
      <ellipse cx="18.6" cy="30.4" rx="3.2" ry="3.6" fill="#1A0F33" />
      <ellipse cx="29.4" cy="30.4" rx="3.2" ry="3.6" fill="#1A0F33" />
      <circle cx="18.6" cy="30.4" r="1.4" fill="var(--brand-2)" opacity={0.95} />
      <circle cx="29.4" cy="30.4" r="1.4" fill="var(--brand-2)" opacity={0.95} />
      <path d="M24 33 l-1.7 3.1 h3.4 Z" fill="#1A0F33" />
      {/* Teeth gaps. */}
      <path d="M19.5 40.4 V43.6 M24 40.4 V44 M28.5 40.4 V43.6" stroke="#9d95b3" strokeWidth={0.9} strokeLinecap="round" />
    </svg>
  );
}
