import { useState } from "react";
import { feedback } from "@/lib/haptics";
import { useArtStyle } from "@/theme/useArtStyle";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export type PillState = "default" | "selected" | "correct" | "wrong" | "dim";

/**
 * The hero answer interaction (DESIGN §4). Full-width pill with a left A/B/C/D letter badge, a big
 * tap target (>=58px), and satisfying press feedback (a quick GPU-cheap scale on pointer-down).
 * In-play uses default/selected only — the client can't know correctness (anti-cheat split), so
 * "selected" is a calm violet lock with no right/wrong signal. correct (green, gold ring sweep) /
 * wrong (red shake) / dim are used on the results reveal, where the server answer is known.
 * Long labels wrap gracefully (no clipping); reduced motion keeps every state visible but drops the
 * decorative press squish (the global media query collapses the transition).
 */
export function AnswerPill({
  index,
  label,
  state = "default",
  onClick,
  disabled,
}: {
  index: number;
  label: string;
  state?: PillState;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  const mono = useArtStyle() === "mono";

  // Mono ("Blank"): flat hairline pills — no 3D edge step, no violet tint, no glow. Selection is
  // a full-strength outline; correct/wrong stay flat functional fills.
  const monoStyles: Record<PillState, React.CSSProperties> = {
    default: {
      background: "var(--panel)",
      borderColor: "var(--line)",
      color: "var(--text)",
      boxShadow: "none",
    },
    selected: {
      background: "color-mix(in srgb, var(--text) 6%, var(--panel))",
      borderColor: "color-mix(in srgb, var(--text) 80%, transparent)",
      color: "var(--text)",
      boxShadow: "none",
    },
    correct: {
      background: "var(--lime)",
      borderColor: "var(--lime)",
      color: "#fff",
      boxShadow: "none",
    },
    wrong: {
      background: "var(--pink)",
      borderColor: "var(--pink)",
      color: "#fff",
    },
    dim: {
      background: "var(--panel)",
      borderColor: "var(--line)",
      color: "var(--muted)",
      opacity: 0.5,
    },
  };

  const arcadeStyles: Record<PillState, React.CSSProperties> = {
    default: {
      // Violet-tinted glass with a crisp top light and a solid bottom EDGE (the 3px shadow step) so
      // the pill reads as a physical key, not a flat form row.
      background: "linear-gradient(180deg, color-mix(in srgb, var(--panel2) 86%, var(--brand)), var(--panel))",
      borderColor: "color-mix(in srgb, var(--brand-2) 34%, var(--line))",
      color: "var(--text)",
      boxShadow:
        "0 3px 0 color-mix(in srgb, var(--panel) 45%, black), 0 8px 18px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.09)",
    },
    selected: {
      background:
        "linear-gradient(180deg, color-mix(in srgb, var(--brand) 40%, var(--panel2)), color-mix(in srgb, var(--brand) 18%, var(--panel)))",
      borderColor: "var(--brand-2)",
      color: "var(--text)",
      boxShadow:
        "0 3px 0 color-mix(in srgb, var(--brand) 35%, black), 0 10px 28px rgba(124,58,237,.5), inset 0 1px 0 rgba(255,255,255,.14)",
      transform: "translateY(-2px)",
    },
    correct: {
      background: "linear-gradient(180deg, color-mix(in srgb, var(--lime) 92%, white), var(--lime))",
      borderColor: "var(--lime)",
      color: "#06210f",
      boxShadow: "0 8px 26px rgba(47,212,94,.45)",
    },
    wrong: {
      background: "linear-gradient(180deg, color-mix(in srgb, var(--pink) 94%, white), var(--pink))",
      borderColor: "var(--pink)",
      color: "#fff",
    },
    dim: {
      background: "var(--panel)",
      borderColor: "var(--line)",
      color: "var(--muted)",
      opacity: 0.42,
    },
  };

  const styles = mono ? monoStyles : arcadeStyles;

  // Mono letter badges are outlined squares (line-art, like everything in that skin); arcade
  // keeps the filled brand-gradient discs. Letter color on the brand surface comes from the theme
  // (--brandText): white on every classic theme; ink on the dark Blank, whose brand is white.
  const badgeBg = mono
    ? state === "correct" || state === "wrong"
      ? "rgba(255,255,255,.18)"
      : "transparent"
    : state === "correct"
      ? "#fff"
      : state === "wrong"
        ? "rgba(255,255,255,.25)"
        : "radial-gradient(120% 120% at 35% 25%, color-mix(in srgb, var(--brand-2) 78%, white), var(--brand))";
  const badgeColor = mono
    ? state === "correct" || state === "wrong"
      ? "#fff"
      : state === "selected"
        ? "var(--text)"
        : "var(--muted)"
    : state === "correct"
      ? "var(--lime)"
      : "var(--brandText, #fff)";
  // The correct pill on reveal gets the expanding gold-ring sweep; wrong shakes (existing classes).
  const animClass =
    state === "correct" ? "rr-correct-ring" : state === "wrong" ? "rr-shake" : undefined;

  // Press scale only matters for the live, tappable states (default/selected). Never override the
  // reveal transforms (correct's pop / selected's lift) with a press squish.
  const interactive = !disabled && (state === "default" || state === "selected");
  const pressTransform = interactive && pressed ? "scale(0.97)" : undefined;

  const base = styles[state];
  const merged: React.CSSProperties = {
    ...base,
    transform: [base.transform, pressTransform].filter(Boolean).join(" ") || undefined,
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onPointerDown={() => {
        if (!interactive) return;
        setPressed(true);
        // On POINTER DOWN, not on click. The tick has to land with the finger — a haptic that
        // waits for the click event arrives after the decision and reads as lag. This is the
        // single biggest difference between an app that feels responsive and one that doesn't.
        feedback("selection");
      }}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className={animClass}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        width: "100%",
        minHeight: 60,
        padding: "12px 16px",
        borderRadius: "var(--radius-pill, 18px)",
        border: "1.5px solid",
        fontFamily: "inherit",
        fontWeight: 700,
        fontSize: 16,
        textAlign: "left",
        cursor: disabled ? "default" : "pointer",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        transition: "transform 120ms cubic-bezier(.2,.9,.3,1.2), box-shadow 160ms, background 160ms, border-color 160ms, opacity 160ms",
        ...merged,
      }}
    >
      <span
        className="display"
        style={{
          flexShrink: 0,
          width: 38,
          height: 38,
          borderRadius: 11,
          background: badgeBg,
          color: badgeColor,
          display: "grid",
          placeItems: "center",
          fontSize: 19,
          textShadow:
            !mono && (state === "default" || state === "selected")
              ? "0 1px 2px rgba(0,0,0,.4)"
              : undefined,
          border: mono
            ? state === "correct" || state === "wrong"
              ? "1px solid transparent"
              : state === "selected"
                ? "1px solid color-mix(in srgb, var(--text) 80%, transparent)"
                : "1px solid var(--line)"
            : state === "default" || state === "selected"
              ? "1px solid color-mix(in srgb, var(--brand-2) 65%, white)"
              : "none",
          boxShadow:
            !mono && (state === "default" || state === "selected")
              ? "0 2px 8px rgba(124,58,237,.4), inset 0 1px 0 rgba(255,255,255,.35)"
              : "none",
        }}
      >
        {LETTERS[index] ?? index + 1}
      </span>
      <span style={{ flex: 1, lineHeight: 1.25, wordBreak: "break-word" }}>{label}</span>
    </button>
  );
}
