import { fmt, useT } from "@/i18n/useT";
import { FitText } from "@/ui/FitText";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** A flat region-gate plate the road passes through between chapters. State-tinted: done (gold),
 * current (accent, lit), locked (dim but legible). Intentionally flat — a thin banner with a soft
 * accent underglow, not a chunky ribbon, so it reads as a milestone on the route. */
export function ChapterDivider({
  index,
  name,
  state,
  accent,
}: {
  index: number; // 0-based arc index
  name: string;
  state: "done" | "current" | "locked";
  accent: string;
}) {
  const t = useT();
  const lit = state === "done" ? "var(--amber)" : state === "current" ? accent : "color-mix(in srgb, var(--brand-2) 50%, transparent)";
  const labelColor = state === "locked" ? "var(--faint)" : "var(--text)";

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "0 6%", pointerEvents: "none" }}>
      {/* faint underglow tying the gate into the world */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 190,
          height: 40,
          transform: "translate(-50%,-50%)",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${state === "locked" ? "color-mix(in srgb, var(--brand) 12%, transparent)" : lit + "22"}, transparent 70%)`,
          filter: "blur(6px)",
        }}
      />
      {/* full-width checkpoint hairline running out from the plate to the world's edges */}
      <span aria-hidden style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${lit}55)` }} />
      <div
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          maxWidth: 200,
          padding: "4px 13px",
          borderRadius: 999,
          background: "color-mix(in srgb, var(--panel) 72%, transparent)",
          border: `1px solid ${lit}66`,
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
        }}
      >
        <span style={{ flex: "none", fontSize: 9, letterSpacing: 1.5, fontWeight: 900, textTransform: "uppercase", color: lit }}>
          {fmt(t.campaign.chapter, { roman: ROMAN[index] ?? index + 1 })}
        </span>
        <FitText
          as="span"
          className="display"
          size={11.5}
          min={0.66}
          axis="x"
          style={{
            fontWeight: 800,
            color: labelColor,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {name}
        </FitText>
      </div>
      <span aria-hidden style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${lit}55, transparent)` }} />
    </div>
  );
}
