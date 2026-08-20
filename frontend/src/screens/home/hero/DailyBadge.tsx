/**
 * A single Daily Royale info badge (dark violet glass, thin brand border, icon + uppercase label) —
 * used for RANKED and 8 QUESTIONS. Kept tiny and reusable so the badge row never drifts in style.
 */
export function DailyBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "clamp(2px, 0.7cqw, 3px) clamp(6px, 1.8cqw, 8px)",
        borderRadius: 999,
        background: "color-mix(in srgb, var(--brand) 26%, rgba(8,4,20,.5))",
        border: "1px solid color-mix(in srgb, var(--brand-2) 40%, transparent)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.1)",
        fontSize: "clamp(8px, 2.2cqw, 9.5px)",
        fontWeight: 800,
        letterSpacing: ".07em",
        textTransform: "uppercase",
        color: "color-mix(in srgb, var(--text) 88%, var(--muted))",
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ display: "flex" }}>{icon}</span>
      {label}
    </span>
  );
}
