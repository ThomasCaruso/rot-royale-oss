// Pure helpers for the Royale Results reveal — placement tiers, field-relative metrics, and the
// one-line insight. Kept out of components so the derivation is testable without rendering.
//
// HONESTY (DESIGN §7): `fieldSize` and the leaderboard rows are REAL entries only — the cold-start
// bots that once padded a thin field are gone — so the copy names them as people ("#3 of 12
// players", "Top 9% of players"). Every count here is derived from real data; none is invented. No
// money/cash/prize/bet language anywhere.

import { ordinalPlace, slotTitle } from "@/lib/home";
import { activeTag } from "@/i18n/format";

export type PlacementTier = "winner" | "podium" | "normal";

/** 1 = winner (gold), 2–3 = podium (premium), everything else = normal (violet/silver). */
export function getPlacementTier(rank: number): PlacementTier {
  if (rank === 1) return "winner";
  if (rank <= 3) return "podium";
  return "normal";
}

/** Short ordinal, uppercased: 1 → "1ST", 23 → "23RD". */
export function formatPlacement(rank: number): string {
  return ordinalPlace(rank).toUpperCase();
}

/**
 * The huge placement headline. Returns a translation key + params instead of English so the component
 * renders it via `t.results.<key>`: podium → `placePodium` with the ordinal ("1ST"), else `placeNum`
 * with the rank. The ordinal/number formatting stays here (language-neutral); the " PLACE" wording
 * lives in the dictionary.
 */
export type PlacementLabel =
  | { key: "placePodium"; ord: string }
  | { key: "placeNum"; rank: number };

export function placementLabel(rank: number): PlacementLabel {
  return rank <= 3 ? { key: "placePodium", ord: formatPlacement(rank) } : { key: "placeNum", rank };
}

/**
 * Slot → big game title for non-dictionary contexts (share text). Legacy-aware via `slotTitle`:
 * "royale" → "Daily Royale", legacy slots → "Legacy * Game", unknown → "Past Ranked Game". NEVER
 * relabels a legacy slot as Daily Royale (locked correction #1). The MODAL renders the LOCALIZED
 * title via `t.home[royaleTitleKey(slot)]`; this English form is for the pure share-text helper.
 */
export function gameTitle(slot: string): string {
  return slotTitle(slot);
}

/** How many real entrants finished below the player. */
export function computeAhead(rank: number, fieldSize: number): number {
  return Math.max(0, fieldSize - rank);
}

/** Top percentile of the field (1 = best). rank 1 of 12 → 9 → "Top 9%". */
export function computeTopPercent(rank: number, fieldSize: number): number {
  if (fieldSize <= 1) return 100;
  return Math.max(1, Math.ceil((rank / fieldSize) * 100));
}

/** Signed delta for display: 32 → "+32", -8 → "−8" (real minus sign). Callers special-case 0. */
export function formatSignedDelta(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toLocaleString(activeTag())}`;
}

export function formatCoins(value: number): string {
  return value.toLocaleString(activeTag());
}

export interface FieldRow {
  username: string;
  score: number;
  isMe?: boolean;
  /** Identity (optional with safe defaults — ninja, frameless, no honors) so fallback rows stay
   * valid. Badges/title ride along from FieldEntry; the MiniLeaderboard deliberately does not
   * render badges at its 28px row size, but the data stays threaded for any larger surface. */
  avatar_preset?: string;
  equipped_frame?: string | null;
  equipped_badges?: string[];
  equipped_title?: string | null;
}

/**
 * One sharp, true insight from real data. Prefers a points-gap (needs the field's scores); falls
 * back to a field-percentile line. A solo run gets banked-result copy (no "you beat 0" / no
 * implying absent humans).
 *
 * Returns a translation key + pre-formatted params (NOT English) — the component renders it via
 * `t.results.<key>` + `fmt`. Numeric params are pre-`toLocaleString()`'d here because `fmt` does a
 * plain `String()` with no thousands grouping; passing the formatted string preserves "1,000".
 */
export type ResultInsight =
  | { key: "soloBanked" }
  | { key: "wonBy"; points: string }
  | { key: "behindFirst"; points: string }
  | { key: "topPct"; pct: number };

export function buildResultInsight(
  rank: number,
  fieldSize: number,
  myScore: number,
  field: FieldRow[] | null,
): ResultInsight {
  if (fieldSize <= 1) return { key: "soloBanked" };

  if (field && field.length >= 2) {
    const sorted = [...field].sort((a, b) => b.score - a.score);
    if (rank === 1) {
      const gap = myScore - (sorted[1]?.score ?? 0);
      if (gap > 0) return { key: "wonBy", points: gap.toLocaleString(activeTag()) };
    } else {
      const gap = (sorted[0]?.score ?? myScore) - myScore;
      if (gap > 0) return { key: "behindFirst", points: gap.toLocaleString(activeTag()) };
    }
  }
  return { key: "topPct", pct: computeTopPercent(rank, fieldSize) };
}

/**
 * A truthful "near-miss" line — how many points the player was short of a higher bracket — but ONLY
 * when the real field data supports computing it. Returns null otherwise (no fabrication): we need
 * the field's scores and a player who finished just OUTSIDE a meaningful threshold (the top 3, or
 * one rank up when already inside the top 3 — e.g. 2nd → "X points from Top 1"). The gap is the
 * difference to the score at that target rank; non-positive gaps (already at/above it) → null.
 *
 * Returns a translation key + pre-formatted params so the component renders via `t.results.nearMiss`.
 * The copy frames the threshold ("Top {n}").
 */
export type NearMiss = { key: "nearMiss"; points: string; topN: number } | null;

export function buildNearMiss(
  rank: number,
  fieldSize: number,
  myScore: number,
  field: FieldRow[] | null,
): NearMiss {
  if (fieldSize <= 1 || rank <= 1) return null;
  if (!field || field.length < 2) return null;
  const sorted = [...field].sort((a, b) => b.score - a.score);
  // Target the top-3 cutoff when the player is outside it; otherwise the next rank up (2nd/3rd).
  const topN = rank > 3 ? 3 : rank - 1;
  const target = sorted[topN - 1]; // score at the topN-th place (0-indexed)
  if (!target) return null;
  const gap = target.score - myScore;
  if (gap <= 0) return null;
  return { key: "nearMiss", points: gap.toLocaleString(activeTag()), topN };
}

/**
 * Which result (if any) should AUTO-open the Royale Results reveal. Items come most-recent-first.
 * Only the single most-recent SETTLED result with a placement qualifies — and only if unseen. If the
 * most-recent settled result was already seen we return null (older unseen results stay manually
 * accessible from the result card / history; we never chain popups or resurface old reveals).
 */
export function pickAutoRevealResult<T extends { state: string; place: number | null; window_id: string }>(
  items: T[],
  hasSeen: (windowId: string) => boolean,
): T | null {
  const mostRecentSettled = items.find((i) => i.state === "SETTLED" && i.place != null);
  if (!mostRecentSettled) return null;
  return hasSeen(mostRecentSettled.window_id) ? null : mostRecentSettled;
}

/**
 * Text-only share string. Field framing ("#1 of 12"), crown flourish, zero money/prize language.
 *
 * Returns a translation key + params (NOT English); the component renders via `t.results.<key>` +
 * `fmt`. `title` is the localized game title (resolved by the component) — passed through so the
 * sentence stays one translatable template per case.
 */
export type ShareText =
  | { key: "shareBanked" }
  | { key: "shareTopped" }
  | { key: "sharePlaced"; rank: number; fieldSize: number };

export function buildShareText(rank: number | null, fieldSize: number): ShareText {
  if (rank == null) return { key: "shareBanked" };
  if (fieldSize <= 1) return { key: "shareTopped" };
  return { key: "sharePlaced", rank, fieldSize };
}
