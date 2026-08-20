/**
 * The BEST-OF-7 pip row beneath the versus scene — a small uppercase label over a row of pips joined
 * by a faint rail. The active pip is gold with a gentle glow (rr-aura, opacity only); the rest are
 * hollow violet. Purely a visual motif for the best-of-7 format (not live match state). Count is a
 * prop so it stays reusable if the format ever changes. Decorative → aria-hidden.
 */
export function BestOfSevenPips({
  label,
  total = 7,
  activeIndex = 0,
  reduced,
}: {
  label: string;
  total?: number;
  activeIndex?: number;
  reduced: boolean;
}) {
  return (
    <div aria-hidden style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "clamp(3px, 1cqw, 5px)" }}>
      <span style={{ fontSize: "clamp(8.5px, 2.4cqw, 10px)", fontWeight: 900, letterSpacing: ".16em", textTransform: "uppercase", color: "color-mix(in srgb, var(--text) 58%, var(--muted))" }}>
        {label}
      </span>
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "clamp(4px, 1.5cqw, 6px)" }}>
        {/* Faint rail connecting the pips. */}
        <span
          style={{
            position: "absolute",
            left: "4%",
            right: "4%",
            top: "50%",
            height: 1,
            transform: "translateY(-50%)",
            background: "color-mix(in srgb, var(--brand-2) 30%, transparent)",
            pointerEvents: "none",
          }}
        />
        {Array.from({ length: total }, (_, i) => {
          const active = i === activeIndex;
          return (
            <span
              key={i}
              className={active && !reduced ? "rr-aura" : undefined}
              style={{
                position: "relative",
                width: "clamp(5px, 1.6cqw, 7px)",
                height: "clamp(5px, 1.6cqw, 7px)",
                borderRadius: "50%",
                background: active ? "var(--amber)" : "color-mix(in srgb, var(--panel) 70%, black)",
                boxShadow: active
                  ? "0 0 7px color-mix(in srgb, var(--amber) 85%, transparent)"
                  : "inset 0 0 0 1px color-mix(in srgb, var(--brand-2) 55%, transparent)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
