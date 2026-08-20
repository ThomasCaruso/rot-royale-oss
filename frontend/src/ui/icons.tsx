import type { CSSProperties, ReactNode } from "react";

/**
 * Flat premium-vector game icon set — the crafted replacement for the placeholder emoji that used to
 * stand in for Home's art (🌍 🚩 🔥 🛡️ ⚔️ 🥷 🤖 ⚡ and the nav glyphs). Emoji render differently on
 * every platform and read as cheap/AI placeholder; these are deterministic 2-tone SVGs with a single
 * restrained highlight for subtle depth (Duolingo-flat, not glossy), tuned to the dark-violet + gold
 * arcade theme and driven by the same theme tokens as CoinIcon / CrownIcon so they re-skin per theme.
 *
 * Two families:
 *  - Colourful card icons (Shield, Flame, Banner, Globe, Chest, Sword, Bolt, Mask, Bot) carry their
 *    own themed palette.
 *  - Monochrome UI/nav icons (Home, Map, Trophy, Bag, Spark, Clock, Users) paint in `currentColor`
 *    so they inherit each surface's state colour (e.g. the bottom nav's amber-active / muted-idle).
 *
 * All are decorative → aria-hidden; the surrounding control/text carries the accessible name.
 */

type IconProps = { size?: number | string; style?: CSSProperties; className?: string };

function Icon({
  size = 24,
  style,
  className,
  vb = "0 0 24 24",
  children,
}: IconProps & { vb?: string; children: ReactNode }) {
  return (
    <svg
      viewBox={vb}
      role="img"
      aria-hidden
      className={className}
      style={{ width: size, height: size, display: "block", ...style }}
    >
      {children}
    </svg>
  );
}

// Shared shade ramps (kept off the theme tokens so the depth tone reads on every skin).
const GOLD = "var(--amber)";
const GOLD_D = "#B97900";
const GOLD_DD = "#8A5A00";
const GOLD_L = "#FFE9A8";
const VIO = "var(--brand)";
const VIO2 = "var(--brand-2)";
const VIO_D = "#1c0f3a";
const STEEL = "#d7def0";
const STEEL_D = "#9aa3b8";

/* ----------------------------- Colourful card icons ----------------------------- */

/** League crest — a gold shield with a star and a darker right plane for depth. */
export function ShieldIcon({ size = 22, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <path
        d="M12 2.4 L19.6 5.2 V11 C19.6 16.3 16.3 19.8 12 21.7 C7.7 19.8 4.4 16.3 4.4 11 V5.2 Z"
        fill={GOLD}
        stroke={GOLD_DD}
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      <path d="M12 2.4 L19.6 5.2 V11 C19.6 16.3 16.3 19.8 12 21.7 V2.4 Z" fill={GOLD_D} opacity={0.5} />
      <path
        d="M12 7 L13.15 10.2 L16.5 10.3 L13.8 12.4 L14.75 15.7 L12 13.7 L9.25 15.7 L10.2 12.4 L7.5 10.3 L10.85 10.2 Z"
        fill={GOLD_L}
      />
      <path d="M12 2.4 L6.6 4.4 V11 C6.6 12.4 6.9 13.6 7.4 14.6" fill="none" stroke="#fff" strokeOpacity={0.25} strokeWidth={1} strokeLinecap="round" />
    </Icon>
  );
}

/** Day-streak flame — pink outer, amber core. */
export function FlameIcon({ size = 22, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <path
        d="M12.6 2 C13.1 6 17 7.6 17 12.6 A5 5 0 0 1 7 12.6 C7 9.9 8.6 8.4 9.4 6.9 C9.7 8.5 10.7 8.9 11.3 8 C12 7 12.1 4.4 12.6 2 Z"
        fill="var(--pink)"
      />
      <path
        d="M12 9.4 C12.3 11.6 14 12 14 14.1 A2.2 2.2 0 0 1 9.6 14.1 C9.6 12.7 10.6 12 10.95 10.8 C11.25 11.7 11.8 11.5 12 9.4 Z"
        fill={GOLD}
      />
    </Icon>
  );
}

/** Campaign quest banner — a hanging pennant on a gold rod with a star. */
export function BannerIcon({ size = 22, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <rect x="4.5" y="2.2" width="15" height="2.2" rx="1.1" fill={GOLD} />
      <path d="M6 4 H18 V18.6 L12 15 L6 18.6 Z" fill={VIO2} />
      <path d="M12 4 H18 V18.6 L12 15 Z" fill={VIO_D} opacity={0.45} />
      <path d="M12 6.6 L12.9 8.7 L15.1 8.8 L13.4 10.2 L13.95 12.3 L12 11.1 L10.05 12.3 L10.6 10.2 L8.9 8.8 L11.1 8.7 Z" fill={GOLD} />
    </Icon>
  );
}

/** Campaign world — a planet with green continents, meridians and a planted quest flag. */
export function GlobeIcon({ size = 22, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      {/* ocean sphere */}
      <circle cx="11" cy="13" r="8" fill={VIO} />
      {/* continents (bold green so they read on every theme) */}
      <path d="M5.4 10.6 C7 9.4 8.5 10.2 9.9 9.5 C11.2 8.9 12.6 9.6 12.9 10.9 C12.4 12 11.1 12 10 12.6 C8.6 13.4 7.6 12.4 6.4 12.6 C5.4 12.8 4.8 11.9 5.4 10.6 Z" fill={"var(--lime)"} />
      <path d="M8.6 15.4 C10 14.9 11 16.1 12.6 15.8 C13.8 15.6 14.7 16.4 14.4 17.5 C12.8 18.4 11 17.7 9.4 18 C8.4 18.2 7.8 17.2 8.6 15.4 Z" fill={"var(--lime)"} />
      {/* meridians + equator */}
      <circle cx="11" cy="13" r="8" fill="none" stroke="#fff" strokeOpacity={0.28} strokeWidth={0.9} />
      <path d="M11 5 C13.4 8 13.4 18 11 21" fill="none" stroke="#fff" strokeOpacity={0.2} strokeWidth={0.7} />
      <path d="M3.2 13 H18.8" stroke="#fff" strokeOpacity={0.2} strokeWidth={0.7} />
      {/* ocean glint */}
      <ellipse cx="7.8" cy="9.6" rx="2.4" ry="1.5" fill="#fff" opacity={0.14} />
      {/* planted quest flag */}
      <path d="M17.6 2.4 V9.2" stroke={GOLD_DD} strokeWidth={1.4} strokeLinecap="round" />
      <path d="M17.6 2.7 L22 4.4 L17.6 6.1 Z" fill={GOLD} />
    </Icon>
  );
}

/** Vault chest — a violet chest with gold bands, corners and a lock. */
export function ChestIcon({ size = 22, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <path d="M3.6 11 C3.6 7.4 6.2 5.4 12 5.4 C17.8 5.4 20.4 7.4 20.4 11 V11.6 H3.6 Z" fill={VIO2} />
      <rect x="3.6" y="11" width="16.8" height="8.2" rx="1.6" fill={VIO} />
      <rect x="3.6" y="11.1" width="16.8" height="1.9" fill={GOLD} />
      <rect x="3.2" y="10.4" width="2.5" height="8.8" rx="1" fill={GOLD} opacity={0.92} />
      <rect x="18.3" y="10.4" width="2.5" height="8.8" rx="1" fill={GOLD} opacity={0.92} />
      <rect x="10.6" y="11.7" width="2.8" height="3.4" rx="0.9" fill={GOLD_L} />
      <circle cx="12" cy="13.2" r="0.7" fill={GOLD_DD} />
      <path d="M5.6 7.6 C7.8 6.6 16.2 6.6 18.4 7.6" fill="none" stroke="#fff" strokeOpacity={0.22} strokeWidth={0.9} strokeLinecap="round" />
    </Icon>
  );
}

/** Battle sword — steel blade, gold guard + pommel (upright, reads at small sizes). */
export function SwordIcon({ size = 16, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <path d="M12 2 L13.5 4.2 V13 H10.5 V4.2 Z" fill={STEEL} stroke={STEEL_D} strokeWidth={0.5} strokeLinejoin="round" />
      <path d="M12 2 L12 13 H10.5 V4.2 Z" fill="#fff" opacity={0.5} />
      <rect x="7.8" y="12.8" width="8.4" height="2" rx="1" fill={GOLD} />
      <rect x="11.2" y="14.6" width="1.6" height="4.4" fill={GOLD_DD} />
      <circle cx="12" cy="19.8" r="1.4" fill={GOLD} />
    </Icon>
  );
}

/** Lightning bolt for the VS clash. */
export function BoltIcon({ size = 20, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <path d="M13 2 L5 13.2 H10.6 L9 22 L19 8.6 H12.2 Z" fill={GOLD} stroke={GOLD_DD} strokeWidth={0.6} strokeLinejoin="round" />
      <path d="M13 2 L5 13.2 H8.4 L13 6 Z" fill={GOLD_L} opacity={0.55} />
    </Icon>
  );
}

/** Hooded rival — a masked head with glowing violet eyes (the duel challenger). */
export function MaskIcon({ size = 26, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <path d="M12 3 C7.6 3 5 6.6 5 11.2 C5 16.2 8 20.2 12 21.2 C16 20.2 19 16.2 19 11.2 C19 6.6 16.4 3 12 3 Z" fill={VIO} />
      <path d="M5.5 13.4 C6.8 17.3 9.1 20.3 12 21.2 C14.9 20.3 17.2 17.3 18.5 13.4 Z" fill={VIO_D} opacity={0.5} />
      <path d="M5.7 9.4 C8.1 8.4 15.9 8.4 18.3 9.4 L17.8 12.2 C15.4 11.1 8.6 11.1 6.2 12.2 Z" fill="#140826" />
      <path d="M8 10.6 L11 10.2 L10.55 11.7 L8.25 11.8 Z" fill={VIO2} />
      <path d="M16 10.6 L13 10.2 L13.45 11.7 L15.75 11.8 Z" fill={VIO2} />
    </Icon>
  );
}

/** Rival bot — a steel robot head with a dark visor and pink eyes (distinct from the violet rival). */
export function BotIcon({ size = 26, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <path d="M12 2.4 V5" stroke="#6d79a3" strokeWidth={1.3} strokeLinecap="round" />
      <circle cx="12" cy="2.2" r="1.3" fill="var(--pink)" />
      <rect x="3" y="9.4" width="1.9" height="4.2" rx="0.95" fill="#7a86ab" />
      <rect x="19.1" y="9.4" width="1.9" height="4.2" rx="0.95" fill="#7a86ab" />
      <rect x="4.6" y="5" width="14.8" height="13" rx="3.6" fill="#9aa9d2" />
      <path d="M4.6 12 H19.4 V14.4 C19.4 16.4 17.8 18 15.8 18 H8.2 C6.2 18 4.6 16.4 4.6 14.4 Z" fill="#3a456b" opacity={0.5} />
      <rect x="6.6" y="8" width="10.8" height="5.2" rx="2.6" fill="#16203a" />
      <circle cx="9.6" cy="10.6" r="1.35" fill="var(--pink)" />
      <circle cx="14.4" cy="10.6" r="1.35" fill="var(--pink)" />
    </Icon>
  );
}

/* ----------------------------- Monochrome UI / nav icons ----------------------------- */

/** Home / house. */
export function HomeIcon({ size = 22, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <path
        d="M3.5 11.4 L12 3.8 L20.5 11.4 a1 1 0 0 1 -1.34 1.49 L19 12.74 V19.5 a1.5 1.5 0 0 1 -1.5 1.5 H14.5 V15.5 a2.5 2.5 0 0 0 -5 0 V21 H6.5 A1.5 1.5 0 0 1 5 19.5 V12.74 l-0.16 0.15 A1 1 0 0 1 3.5 11.4 Z"
        fill="currentColor"
      />
    </Icon>
  );
}

/** Folded map (campaign nav) — three panels with subtle fold shading. */
export function MapIcon({ size = 22, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <g fill="currentColor">
        <path d="M3.5 6.2 L9 4.2 V18 L3.5 20 Z" />
        <path d="M9 4.2 L15 6.2 V20 L9 18 Z" opacity={0.62} />
        <path d="M15 6.2 L20.5 4.2 V18 L15 20 Z" />
      </g>
    </Icon>
  );
}

/** Trophy (leaderboard). */
export function TrophyIcon({ size = 22, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <path d="M6.8 4 H17.2 V8.4 A5.2 5.2 0 0 1 6.8 8.4 Z" fill="currentColor" />
      <path d="M6.8 5.2 H4.4 C4 5.2 3.8 5.4 3.8 5.8 C3.8 8.1 5.3 9.7 7.4 9.9" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      <path d="M17.2 5.2 H19.6 C20 5.2 20.2 5.4 20.2 5.8 C20.2 8.1 18.7 9.7 16.6 9.9" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      <rect x="11" y="12.4" width="2" height="3.2" fill="currentColor" />
      <rect x="8.2" y="15.4" width="7.6" height="1.9" rx="0.6" fill="currentColor" />
      <rect x="7" y="17.6" width="10" height="2.6" rx="0.9" fill="currentColor" />
    </Icon>
  );
}

/** Shopping bag (Vault / store). */
export function BagIcon({ size = 22, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <path d="M8.4 9 V7.2 A3.6 3.6 0 0 1 15.6 7.2 V9" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
      <path d="M5.6 8 H18.4 L19.5 19.8 A1.4 1.4 0 0 1 18.1 21.3 H5.9 A1.4 1.4 0 0 1 4.5 19.8 Z" fill="currentColor" />
      <circle cx="9" cy="12.2" r="1" fill="var(--panel)" />
      <circle cx="15" cy="12.2" r="1" fill="var(--panel)" />
    </Icon>
  );
}

/** Four-point sparkle (hero "results ready" mark / accents). */
export function SparkIcon({ size = 14, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <path d="M12 2 C12.6 7.6 16.4 11.4 22 12 C16.4 12.6 12.6 16.4 12 22 C11.4 16.4 7.6 12.6 2 12 C7.6 11.4 11.4 7.6 12 2 Z" fill="currentColor" />
    </Icon>
  );
}

/** Clock (schedule rows). */
export function ClockIcon({ size = 14, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth={2} />
      <path d="M12 6.8 V12 L15.6 14.1" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  );
}

/** Crossed swords (Battle row feature icon) — two thin blades with small guards. */
export function SwordsIcon({ size = 20, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <g fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.6 4.6 L15.4 15.4" />
        <path d="M4.6 4.6 L8 5 L7.4 5.6" />
        <path d="M13.6 17.2 L17.2 13.6" />
        <path d="M16.2 18.6 L18.6 16.2" />
        <path d="M19.4 4.6 L8.6 15.4" />
        <path d="M19.4 4.6 L16 5 L16.6 5.6" />
        <path d="M10.4 17.2 L6.8 13.6" />
        <path d="M7.8 18.6 L5.4 16.2" />
      </g>
    </Icon>
  );
}

/** Brain (Brain Boost row feature icon) — two rounded lobes with a centre fold. */
export function BrainIcon({ size = 20, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <g fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5.2 C11.2 3.6 8.8 3.4 7.8 4.8 C6 4.8 4.8 6.4 5.3 8 C3.8 8.8 3.7 11 5 12 C4.2 13.6 5.2 15.5 7 15.7 C7.3 17.5 9.4 18.4 10.9 17.4 C11.3 17.9 12 18.2 12 18.2 V5.2 Z" />
        <path d="M12 5.2 C12.8 3.6 15.2 3.4 16.2 4.8 C18 4.8 19.2 6.4 18.7 8 C20.2 8.8 20.3 11 19 12 C19.8 13.6 18.8 15.5 17 15.7 C16.7 17.5 14.6 18.4 13.1 17.4 C12.7 17.9 12 18.2 12 18.2" />
        <path d="M12 18.2 V20.6" />
      </g>
    </Icon>
  );
}

/** Rising trend line with arrow (Your Growth row feature icon). */
export function TrendIcon({ size = 20, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 17 L9.4 11.4 L13 14.6 L20 7" />
        <path d="M15.6 7 H20 V11.4" />
      </g>
    </Icon>
  );
}

/** Single person (username field). */
export function UserIcon({ size = 18, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8.2" r="3.6" />
        <path d="M4.8 19.4 A7.2 7.2 0 0 1 19.2 19.4 Z" />
      </g>
    </Icon>
  );
}

/** Envelope (email field). Monochrome line — inherits `currentColor` like the other UI icons. */
export function MailIcon({ size = 18, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.2" y="5.4" width="17.6" height="13.2" rx="2.6" />
        <path d="M4 7 L12 12.4 L20 7" />
      </g>
    </Icon>
  );
}

/** Padlock (password field). */
export function LockIcon({ size = 18, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="4.6" y="10.4" width="14.8" height="9.4" rx="2.4" />
        <path d="M7.8 10.4 V7.8 A4.2 4.2 0 0 1 16.2 7.8 V10.4" />
        <path d="M12 14 V16.2" />
      </g>
    </Icon>
  );
}

/** Eye (reveal password). */
export function EyeIcon({ size = 18, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.6 12 C4.7 7.9 8.1 5.8 12 5.8 C15.9 5.8 19.3 7.9 21.4 12 C19.3 16.1 15.9 18.2 12 18.2 C8.1 18.2 4.7 16.1 2.6 12 Z" />
        <circle cx="12" cy="12" r="3.1" />
      </g>
    </Icon>
  );
}

/** Eye with a slash (hide password). */
export function EyeOffIcon({ size = 18, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.9 5.9 A9 9 0 0 1 12 5.8 C15.9 5.8 19.3 7.9 21.4 12 A13 13 0 0 1 19.2 15" />
        <path d="M6.3 7.9 C4.6 9 3.4 10.4 2.6 12 C4.7 16.1 8.1 18.2 12 18.2 A9.4 9.4 0 0 0 15.4 17.5" />
        <path d="M9.8 9.9 A3.1 3.1 0 0 0 14.1 14.2" />
        <path d="M4 4 L20 20" />
      </g>
    </Icon>
  );
}

/** Two-people group (the live field count). */
export function UsersIcon({ size = 14, style, className }: IconProps) {
  return (
    <Icon size={size} style={style} className={className}>
      <circle cx="16.4" cy="9.2" r="2.7" fill="currentColor" opacity={0.7} />
      <path d="M13.6 19.4 A4.8 4.8 0 0 1 21.4 15.8 L21.4 19.4 Z" fill="currentColor" opacity={0.7} />
      <circle cx="9" cy="8.4" r="3.3" fill="currentColor" />
      <path d="M3.3 19.4 A5.7 5.7 0 0 1 14.7 19.4 Z" fill="currentColor" />
    </Icon>
  );
}
