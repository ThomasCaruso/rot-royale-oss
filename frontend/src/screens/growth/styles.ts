/** Non-component shared bits for the "Your Growth" cards (kept out of ui.tsx so fast-refresh
 * only sees component exports there). Token-driven so every theme stays coherent. */

import type React from "react";

/** The two-font system: a display serif reserved for EXACTLY two elements — the page title and
 * the large Brain Score number. Everything else stays the app's normal sans (inherited). Playfair is
 * pulled in via the global.css Google-Fonts import; Georgia is the graceful fallback. */
export const SERIF = '"Playfair Display", "Cormorant Garamond", Georgia, serif';

export const growthCardStyle: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 26,
  padding: 24,
  boxShadow: "0 12px 30px rgba(20, 16, 8, 0.06)",
};

/** Warm light track for progress bars/sparklines — a whisper of the muted ink over the cream. */
export const TRACK = "color-mix(in srgb, var(--faint) 30%, transparent)";

/**
 * Strength buckets drive the ONE place colour is allowed to speak on this screen: a score reads
 * green only when it's genuinely strong, charcoal when it's mid, and muted grey when it's weak.
 * Same mapping powers the bar fill and the right-hand number so they always agree.
 *   strong (≥75) → green   ·   medium (≥45) → charcoal ink   ·   weak (<45) → muted grey
 */
export function strengthColor(score: number): string {
  if (score >= 75) return "var(--lime)";
  if (score >= 45) return "var(--text)";
  return "var(--muted)";
}

export type TierKey = "elite" | "master" | "adept" | "novice";

export interface Tier {
  key: TierKey;
  name: string;
  /** Token colour the tier speaks — node stroke, emblem fill, badge accent. */
  color: string;
}

/**
 * Mastery tiers for the Brain Profile skill tree + stat rows. A 0..100 domain score buckets into one
 * of four ranks that drive the node colour, the emblem, and the badge. Elite alone speaks GOLD
 * (prestige / the crown); Master & Adept ride the brand purples; Novice fades to the faint ink so a
 * weak domain reads as "next to unlock", not a failure. Pure — same score always maps to same tier.
 */
export function tier(score: number): Tier {
  if (score >= 85) return { key: "elite", name: "Elite", color: "var(--amber)" };
  if (score >= 70) return { key: "master", name: "Master", color: "var(--brand)" };
  if (score >= 50) return { key: "adept", name: "Adept", color: "var(--brand-2)" };
  return { key: "novice", name: "Novice", color: "var(--faint)" };
}

/** Short display labels so long category names never truncate mid-word. */
const SHORT_LABEL: Record<string, string> = {
  "Pop Culture & Entertainment": "Pop Culture",
};

export function shortCategory(name: string): string {
  return SHORT_LABEL[name] ?? name;
}

/** Vertex on a circle of radius r around (cx, cy) at angleDeg (0° = 3 o'clock, clockwise). Used by
 * the RadarChart to place axis vertices and labels. Pure. */
export function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/* --------------------------------------------------------------------------------------------------
 * Knowledge Profile viz helpers — shared by the compact orbit. Category identity (the emoji glyph is
 * the app's established category language, same as CategorySplash / CategorySelect) and a RESTRAINED
 * state colour derived from the score, so the orbit communicates strength without turning rainbow.
 * ------------------------------------------------------------------------------------------------ */

/** The app's canonical category glyph — matches the in-play splash + the category picker. */
const CATEGORY_EMOJI: Record<string, string> = {
  "Science & Nature": "🔬",
  History: "🏛️",
  Geography: "🌍",
  "Arts & Literature": "🎨",
  Sports: "⚽",
  "Pop Culture & Entertainment": "🎬",
  "Money & Business": "💰",
  "Street Smarts": "🧠",
};
export const categoryEmoji = (name: string): string => CATEGORY_EMOJI[name] ?? "❔";

/** Very short orbit labels so a node's name never crowds its neighbour on a 360px viewport. Keeps the
 * FULL canonical name for the node's accessible label (the caller passes that to aria). */
const ORBIT_SHORT: Record<string, string> = {
  "Science & Nature": "Science",
  "Arts & Literature": "Arts",
  "Money & Business": "Money",
  "Pop Culture & Entertainment": "Pop Culture",
  "Street Smarts": "Street Smarts",
};
export const orbitLabel = (name: string): string => ORBIT_SHORT[name] ?? name;

export type ToneKey = "strong" | "developing" | "weak" | "new";
export interface Tone {
  key: ToneKey;
  color: string;
}
/**
 * Restrained state colour for a category node. Strong reads GREEN (genuinely mastered), developing
 * rides the brand VIOLET (the default voice), weak is a warm AMBER "needs work", and a category with
 * no data yet fades to the faint ink ("still calibrating"). One accent per state — never a rainbow.
 *   strong (≥75) → green · developing (≥45) → violet · weak (<45) → amber · no data → faint
 */
export function categoryTone(score: number, total = 1): Tone {
  if (total <= 0) return { key: "new", color: "var(--faint)" };
  if (score >= 75) return { key: "strong", color: "var(--lime)" };
  if (score >= 45) return { key: "developing", color: "var(--brand)" };
  return { key: "weak", color: "var(--amber)" };
}
