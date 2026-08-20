import { ClockIcon } from "@/ui/icons";

/**
 * The top-right countdown pill — a dark glass pill with a gold clock, the gold time number, and a
 * muted "REMAINING" label. `showRemaining` is only true while an OPEN window is running (so pre-open
 * countdowns to a future open read as a plain timer, not "remaining"). Decorative icon → aria-hidden.
 */
export function DailyCountdownPill({ countdown, showRemaining, remainingLabel }: { countdown: string; showRemaining: boolean; remainingLabel: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "clamp(4px, 1.4cqw, 6px) clamp(9px, 2.6cqw, 12px)",
        borderRadius: 999,
        border: "1px solid color-mix(in srgb, var(--brand-2) 50%, transparent)",
        background: "color-mix(in srgb, var(--panel) 46%, black)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.08), inset 0 -3px 8px rgba(0,0,0,.5), 0 4px 12px rgba(0,0,0,.4)",
        whiteSpace: "nowrap",
      }}
    >
      <ClockIcon size={13} style={{ color: "var(--amber)", flex: "none" }} />
      <span className="display" style={{ fontSize: "clamp(12.5px, 3.6cqw, 16px)", color: "#FFD24A", lineHeight: 1, textShadow: "0 1px 0 #7a4a00, 0 0 10px rgba(255,201,30,.4)" }}>{countdown}</span>
      {showRemaining && (
        <span style={{ fontSize: "clamp(8px, 2.2cqw, 9.5px)", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>
          {remainingLabel}
        </span>
      )}
    </span>
  );
}
