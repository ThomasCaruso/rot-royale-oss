import type React from "react";
import type { Theme } from "@/theme/tokens";

/**
 * Live theme preview — a miniature mock of the game UI rendered with THAT theme's own CSS vars
 * (inline from tokens.ts, deliberately NOT the app's root vars), so the player sees each theme
 * alive before buying: a tiny HUD bar with a coin chip, a question-card sliver with a highlighted
 * keyword line, a default answer pill with its letter badge, a "correct" pill, and the gold CTA
 * dot. Pure divs + gradients (no text, no canvas, no images) so it's GPU-cheap and static —
 * nothing here animates except the optional one-shot unlock shine. Decorative → aria-hidden.
 */
export function ThemePreview({
  theme,
  height = 104,
  shine = false,
}: {
  theme: Theme;
  height?: number;
  /** One-shot light sweep (rr-shine) for the just-unlocked moment. */
  shine?: boolean;
}) {
  const v = theme.vars;
  const bar = (
    w: string | number,
    color: string,
    opacity = 1,
    h = 5,
  ): React.CSSProperties => ({
    width: w,
    height: h,
    borderRadius: 999,
    background: color,
    opacity,
  });

  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        height,
        borderRadius: 14,
        overflow: "hidden",
        // Mirror the app's matte depth: the theme's own --bg under a faint top bloom + edge
        // vignette, so the mini-UI previews the richer surface the player will actually get.
        background: `radial-gradient(120% 70% at 50% -10%, rgba(255,255,255,.10), transparent 55%), radial-gradient(130% 80% at 50% 120%, rgba(0,0,0,.18), transparent 60%), ${v["--bg"]}`,
        border: `1px solid ${v["--line"]}`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.08)",
        padding: "9px 10px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 6,
      }}
    >
      {/* HUD strip: app title bar + gold coin chip */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={bar(42, v["--text"], 0.85, 6)} />
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 7px",
            borderRadius: 999,
            background: v["--panel"],
            border: `1px solid ${v["--line"]}`,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: v["--amber"],
              boxShadow: `0 0 6px ${v["--amber"]}`,
            }}
          />
          <span style={bar(14, v["--amber"], 1, 4)} />
        </span>
      </div>

      {/* Question-card sliver: prompt line + brand-highlighted keyword */}
      <div
        style={{
          borderRadius: 9,
          padding: "7px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 5,
          background: `radial-gradient(120% 80% at 50% -10%, rgba(255,255,255,.08), transparent 60%), linear-gradient(180deg, ${v["--panel2"]}, ${v["--panel"]})`,
          border: `1px solid ${v["--line"]}`,
          // Preview each theme's ambient glow (--glow) on the mini question card, exactly as GlassCard
          // does in-app, so the buyer sees the theme's signature bloom (neon violet / hot magenta /
          // candy pink / soft daylight) before equipping.
          boxShadow: `inset 0 1px 0 rgba(255,255,255,.10), 0 2px 6px rgba(0,0,0,.18), 0 0 16px ${v["--glow"]}`,
        }}
      >
        <span style={bar("72%", v["--text"], 0.8)} />
        <span style={bar("42%", v["--brand-2"])} />
      </div>

      {/* Answer row: default pill (letter badge), correct pill (green), gold CTA dot */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span
          style={{
            flex: 1.2,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 5,
            borderRadius: 8,
            padding: "4px 6px",
            background: v["--panel2"],
            border: `1px solid ${v["--line"]}`,
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 3, background: v["--brand"], flexShrink: 0 }} />
          <span style={{ ...bar("100%", v["--text"], 0.55, 4), flex: 1 }} />
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 5,
            borderRadius: 8,
            padding: "4px 6px",
            background: v["--lime"],
            boxShadow: `0 2px 10px ${v["--lime"]}55`,
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 3, background: "rgba(255,255,255,.9)", flexShrink: 0 }} />
          <span style={{ ...bar("100%", "rgba(255,255,255,.8)", 1, 4), flex: 1 }} />
        </span>
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            flexShrink: 0,
            background: `linear-gradient(180deg, #FFD24A, ${v["--amber"]})`,
            boxShadow: `0 0 10px ${v["--amber"]}`,
          }}
        />
      </div>

      {shine && (
        <span
          className="rr-shine"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: "45%",
            background: "linear-gradient(105deg, transparent, rgba(255,255,255,.5), transparent)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
