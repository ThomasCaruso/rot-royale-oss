import { useReducedMotion } from "@/ui/useReducedMotion";

/**
 * The countdown that sits between the headline and the grid.
 *
 * ONE timer component for both phases, on purpose. During the watch phase it counts down to the
 * moment recall opens; during recall it counts down the answer window. Two differently-styled
 * timers for the same job would make the player re-learn the screen halfway through a 90-second
 * round.
 *
 * Both numbers are REAL. The watch countdown is the remaining sequence playback, derived from the
 * same timeline that drives the flashes — it is not a fabricated pressure device, and nothing bad
 * happens when it reaches zero; it just tells you when your turn starts.
 */
export function MemoryTimer({
  leftMs,
  totalMs,
  tone,
}: {
  leftMs: number;
  totalMs: number;
  /** "watch" is the calm green lead-in; "recall" is the one with something at stake. */
  tone: "watch" | "recall";
}) {
  const reduced = useReducedMotion();
  const frac = totalMs > 0 ? Math.max(0, Math.min(1, leftMs / totalMs)) : 0;
  // Urgency arrives in the last fifth, and ONLY as a small pulse on the readout. A red flash would
  // fight the pastel language the rest of the app is written in, and panic is not the feeling this
  // round is going for.
  const urgent = tone === "recall" && frac <= 0.2 && leftMs > 0;
  const accent = tone === "watch" ? "var(--lime)" : "var(--brand-2)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 999,
        background: `color-mix(in srgb, ${accent} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
        marginBottom: "clamp(10px, 2.4vw, 16px)",
      }}
    >
      <span
        aria-hidden
        className={urgent && !reduced ? "rr-pop" : undefined}
        style={{
          fontVariantNumeric: "tabular-nums",
          fontSize: 13,
          fontWeight: 800,
          color: accent,
          minWidth: 46,
          // The pulse repeats while urgent rather than firing once, so the last second feels
          // different from the first without anything actually changing colour.
          animationIterationCount: urgent ? "infinite" : undefined,
          animationDuration: urgent ? "0.9s" : undefined,
        }}
      >
        {(leftMs / 1000).toFixed(1)}s
      </span>
      <div
        aria-hidden
        style={{
          flex: 1,
          height: 6,
          borderRadius: 999,
          background: "color-mix(in srgb, var(--text) 8%, transparent)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${frac * 100}%`,
            borderRadius: 999,
            background: accent,
            // Eased rather than linear so the bar glides between the 50ms samples instead of
            // stepping — the drain has to look continuous or the whole thing reads as cheap.
            transition: reduced ? "none" : "width 120ms linear",
          }}
        />
      </div>
    </div>
  );
}
