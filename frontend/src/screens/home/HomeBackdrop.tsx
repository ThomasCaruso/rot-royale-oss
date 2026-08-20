import { CrownIcon } from "@/ui/CrownIcon";
import { useReducedMotion } from "@/ui/useReducedMotion";

/**
 * The Home lobby ambiance — a fixed, pointer-transparent layer behind the Home content (above the
 * app-wide Starfield). It builds depth with *light*, not props: large soft aurora colour fields, a
 * few out-of-focus bokeh orbs, and one barely-there gold crown watermark for brand. No emoji, no
 * confetti — premium and calm.
 *
 * Motion is deliberately slow and subtle (the aurora breathes over ~30s); reduced motion freezes
 * everything to a clean static glow (the depth is in the light, so nothing is lost).
 */
export function HomeBackdrop() {
  const reduced = useReducedMotion();

  return (
    // rr-lobby-glow: the mono ("Blank") skin hides the aurora/bokeh layer via CSS — paper, not space.
    <div aria-hidden className="rr-lobby-glow" style={layer}>
      {AURORA.map((a, i) => (
        <span
          key={i}
          style={{
            ...auroraBase,
            ...a.pos,
            width: a.size,
            height: a.size,
            background: `radial-gradient(closest-side, color-mix(in srgb, ${a.color} 64%, transparent), transparent)`,
            opacity: a.opacity,
            animation: reduced ? "none" : a.anim,
            willChange: "transform",
          }}
        />
      ))}

      {BOKEH.map((b, i) => (
        <span
          key={`b${i}`}
          style={{
            position: "absolute",
            ...b.pos,
            width: b.size,
            height: b.size,
            borderRadius: "50%",
            background: `radial-gradient(circle at 38% 34%, color-mix(in srgb, ${b.color} 72%, transparent), transparent 70%)`,
            opacity: b.opacity,
            filter: "blur(1px)",
          }}
        />
      ))}

      {/* Faint brand crown watermark — sits low and dim behind the hero, never competing with text. */}
      <CrownIcon
        size={260}
        style={{ position: "absolute", top: "2%", left: "50%", transform: "translateX(-50%)", opacity: 0.05, filter: "none" }}
      />
    </div>
  );
}

const layer: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 0,
  pointerEvents: "none",
  overflow: "hidden",
};

const auroraBase: React.CSSProperties = {
  position: "absolute",
  borderRadius: "50%",
  pointerEvents: "none",
};

/** Large soft colour fields — the "lit room" behind the lobby. */
const AURORA: Array<{
  pos: React.CSSProperties;
  size: number;
  color: string;
  opacity: number;
  anim: string;
}> = [
  { pos: { top: "-16%", left: "calc(50% - 280px)" }, size: 560, color: "var(--brand)", opacity: 0.34, anim: "rr-bg-float-1 28s ease-in-out infinite" },
  { pos: { top: "-12%", left: "-18%" }, size: 460, color: "var(--brand-2)", opacity: 0.26, anim: "rr-bg-float-2 26s ease-in-out infinite" },
  { pos: { top: "22%", right: "-22%" }, size: 440, color: "var(--brand)", opacity: 0.24, anim: "rr-bg-float-1 30s ease-in-out infinite" },
  { pos: { bottom: "-10%", left: "6%" }, size: 420, color: "var(--amber)", opacity: 0.12, anim: "rr-bg-float-2 34s ease-in-out infinite" },
];

/** A few soft out-of-focus orbs for layered depth. */
const BOKEH: Array<{ pos: React.CSSProperties; size: number; color: string; opacity: number }> = [
  { pos: { top: "16%", left: "12%" }, size: 72, color: "var(--brand-2)", opacity: 0.14 },
  { pos: { top: "44%", right: "14%" }, size: 52, color: "var(--amber)", opacity: 0.12 },
  { pos: { bottom: "16%", left: "20%" }, size: 64, color: "var(--brand)", opacity: 0.12 },
  { pos: { top: "62%", left: "58%" }, size: 40, color: "var(--pink)", opacity: 0.1 },
];
