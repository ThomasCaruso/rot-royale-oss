/**
 * Daily Royale status tones (shared by the card + the status pill). The tone is derived from the
 * hero state machine (A–F) and drives the pill colour/mark and the card's ambient aura. Kept in one
 * place so the pill and the card can't drift.
 */
export type DailyTone = "leading" | "live" | "ready" | "muted";
export type PillMark = "crown" | "live" | "spark" | "dot";

export function toneStyles(tone: DailyTone): { color: string; bg: string; border: string; mark: PillMark } {
  if (tone === "leading")
    return {
      color: "var(--amber)",
      bg: "color-mix(in srgb, var(--amber) 18%, var(--panel))",
      border: "rgba(255,201,30,.5)",
      mark: "crown",
    };
  if (tone === "live")
    // The mock's red "LIVE" badge — honoured as a hot red OPEN pill (DESIGN §7: open, never
    // broadcast-"live"). Pulsing dot + uppercase pill text reads as the same urgent marquee.
    return {
      color: "#fff",
      bg: "linear-gradient(180deg, color-mix(in srgb, var(--pink) 88%, white), var(--pink))",
      border: "color-mix(in srgb, var(--pink) 60%, transparent)",
      mark: "live",
    };
  if (tone === "ready")
    return {
      color: "var(--amber)",
      bg: "color-mix(in srgb, var(--amber) 18%, var(--panel))",
      border: "rgba(255,201,30,.5)",
      mark: "spark",
    };
  return { color: "var(--muted)", bg: "color-mix(in srgb, var(--panel) 60%, transparent)", border: "var(--line)", mark: "dot" };
}

/** The "play today" states get the warmer gold ambient; the quieter ones stay calm violet. */
export const isAttentionTone = (tone: DailyTone) => tone === "live" || tone === "ready" || tone === "leading";
