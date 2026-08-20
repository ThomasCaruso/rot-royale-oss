import { CrownIcon } from "@/ui/CrownIcon";
import { SparkIcon } from "@/ui/icons";
import { type DailyTone, toneStyles } from "./tone";

/**
 * The Daily Royale status pill (top-left) — "OPEN NOW" in the live state (red, pulsing dot), and the
 * adapted status for the other states (Next game / Score locked / Field closed / Results ready…),
 * coloured by tone. The live dot pulse collapses under reduced motion.
 */
export function DailyStatusPill({ tone, text, reduced }: { tone: DailyTone; text: string; reduced: boolean }) {
  const s = toneStyles(tone);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "clamp(4px, 1.4cqw, 6px) clamp(10px, 3cqw, 13px)",
        borderRadius: 999,
        border: `1px solid ${s.border}`,
        background: s.bg,
        boxShadow:
          s.mark === "live"
            ? "0 5px 16px color-mix(in srgb, var(--pink) 48%, transparent), inset 0 1px 0 rgba(255,255,255,.4)"
            : "0 3px 10px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.08)",
        fontSize: "clamp(9.5px, 2.7cqw, 11px)",
        letterSpacing: "0.14em",
        fontWeight: 800,
        textTransform: "uppercase",
        color: s.color,
        whiteSpace: "nowrap",
      }}
    >
      {s.mark === "live" ? (
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 0 8px rgba(255,255,255,.9)",
            animation: reduced ? "none" : "rr-live-pulse 1.1s ease-in-out infinite",
          }}
        />
      ) : s.mark === "crown" ? (
        <CrownIcon size={13} style={{ filter: "none" }} />
      ) : s.mark === "spark" ? (
        <SparkIcon size={12} style={{ color: s.color }} />
      ) : (
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", opacity: 0.8 }} />
      )}
      {text}
    </span>
  );
}
