// Pure helpers for the home/dashboard screen — kept out of the components so the small bits of
// derivation (countdown, ordinals, window progress) are testable without rendering.

/** Remaining time as a compact countdown: "4h 03m", "12m", or "now" once elapsed. */
export function formatDuration(msRemaining: number): string {
  if (msRemaining <= 0) return "now";
  const totalMinutes = Math.floor(msRemaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

/** Placement as an ordinal string: 1 → "1st", 23 → "23rd", 11 → "11th". */
export function ordinalPlace(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * The i18n key (under the `home` namespace) for a slot's display title. The new `royale` slot is the
 * Daily Royale; the historical morning/midday/night slots are shown TRUTHFULLY as legacy games (never
 * relabelled as Daily Royale — locked correction #1); any other/unknown slot → "Past Ranked Game".
 * Components resolve this with `t.home[royaleTitleKey(slot)]` so titles stay localized.
 */
export type RoyaleTitleKey =
  | "royaleTitle"
  | "legacyMorning"
  | "legacyMidday"
  | "legacyNight"
  | "pastRanked";

export function royaleTitleKey(slot: string): RoyaleTitleKey {
  switch (slot) {
    case "royale":
      return "royaleTitle";
    case "morning":
      return "legacyMorning";
    case "midday":
      return "legacyMidday";
    case "night":
      return "legacyNight";
    default:
      return "pastRanked";
  }
}

/**
 * Non-i18n English fallback title for a slot — used where a dictionary isn't available (e.g. pure
 * tests, share-text). Mirrors `royaleTitleKey`: royale → "Daily Royale", legacy slots → "Legacy *
 * Game", unknown → "Past Ranked Game". NEVER relabels a legacy slot as Daily Royale.
 */
export function slotTitle(slot: string): string {
  switch (slot) {
    case "royale":
      return "Daily Royale";
    case "morning":
      return "Legacy Morning Game";
    case "midday":
      return "Legacy Midday Game";
    case "night":
      return "Legacy Night Game";
    default:
      return "Past Ranked Game";
  }
}

/** Fraction (0..1) of the window that has elapsed at `nowMs`, clamped to the window bounds. */
export function windowProgress(openIso: string, closeIso: string, nowMs: number): number {
  const open = Date.parse(openIso);
  const close = Date.parse(closeIso);
  if (!(close > open)) return 0;
  return Math.min(1, Math.max(0, (nowMs - open) / (close - open)));
}

/** A real top-3 finish — gates the celebratory reward treatment (DESIGN §7: no fake dopamine). */
export function isPodium(place: number | null): boolean {
  return place != null && place >= 1 && place <= 3;
}

// --- Daily Royale Home state machine (A–F) --------------------------------------------------------
// One ranked royale per ET day. The Home hero phase is a pure function of the relevant royale
// window's state + settle_at + the user's entry/result/seen flags + now. The component formats copy
// and wires callbacks around this; keeping the phase decision here makes it unit-testable.

/** The minimal window shape the phase resolver needs (a subset of the API `WindowOut`). */
export interface RoyaleWindowLike {
  id: string;
  slot: string;
  state: string; // SCHEDULED | OPEN | CLOSED | SETTLED
  open_at: string;
  close_at: string;
  settle_at: string;
}

export type HeroPhase =
  | "loading"
  | "before" // A: no open window; a scheduled royale exists (today/next)
  | "live" // B: royale OPEN, not entered
  | "locked" // C: royale OPEN, entered/submitted
  | "settling" // D: royale CLOSED, before settle_at
  | "ready" // E: settled, the user has an unseen result
  | "viewed"; // F: settled, result seen (or no result to reveal)

export interface HeroInput {
  loading: boolean;
  /** The royale window in play right now (OPEN or CLOSED today), if any. */
  activeRoyale: RoyaleWindowLike | null;
  /** Whether the user has an entry in `activeRoyale`. */
  entered: boolean;
  /** A settled royale result for the user exists (drives E/F vs A). */
  hasResult: boolean;
  /** The settled result is unseen → it should be revealed (E); else it has been viewed (F). */
  resultSeen: boolean;
  nowMs: number;
}

/**
 * Resolve the Home hero phase (A–F). Order matters: an OPEN royale dominates (B live / C locked); a
 * CLOSED royale is settling (D) until settle_at, then yields to the result reveal (E ready when the
 * result is unseen, F viewed once seen). With no active royale we're in the pre/post-open lull: an
 * unrevealed result → E; a viewed result → F (summary + next open); nothing yet → A (before).
 */
export function deriveHeroPhase(input: HeroInput): HeroPhase {
  if (input.loading) return "loading";
  const w = input.activeRoyale;
  if (w) {
    if (w.state === "OPEN") return input.entered ? "locked" : "live";
    if (w.state === "CLOSED" && input.nowMs < Date.parse(w.settle_at)) return "settling";
    // CLOSED past settle_at, or SETTLED → reveal-or-summary, driven by whether the result is seen.
    if (input.hasResult) return input.resultSeen ? "viewed" : "ready";
    return "settling"; // settled but the user's result hasn't landed in history yet — keep settling.
  }
  // No active royale window — the lull before today's open or after tonight's reveal.
  if (input.hasResult) return input.resultSeen ? "viewed" : "ready";
  return "before";
}
