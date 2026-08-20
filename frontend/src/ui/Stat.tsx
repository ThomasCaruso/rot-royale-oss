import { GlassCard } from "@/ui/GlassCard";

/** A profile stat card: a prominent value, a label, and an optional smaller context line (`sub`). */
export function Stat({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: string | number;
  accent?: string;
  sub?: string;
}) {
  return (
    <GlassCard style={{ padding: "14px 16px", borderRadius: 16 }}>
      <div
        style={{
          fontSize: 23,
          fontWeight: 800,
          letterSpacing: "0.03em",
          textTransform: "uppercase",
          color: accent ?? "var(--text)",
        }}
      >
        {value}
      </div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2, fontWeight: 700 }}>
        {label}
        {sub ? <span style={{ color: "var(--faint)" }}> · {sub}</span> : null}
      </div>
    </GlassCard>
  );
}
