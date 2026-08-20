import type { CSSProperties } from "react";
import type { Theme } from "@/theme/tokens";

/**
 * A miniature of the app's ACTUAL home screen, painted in one theme's own tokens — so a Vault tile
 * shows what equipping really looks like rather than an abstract swatch.
 *
 * It mirrors the real composition element for element: the header lockup with its coin pill and
 * avatar, the Daily Royale hero card (status dot, serif title, copy, meter, brand CTA), and two
 * feature rows beneath. No text — every glyph is a bar — so it stays legible at 90px, costs nothing
 * to render, and needs no translation.
 *
 * The theme's vars are applied as REAL custom properties on the root, and everything inside
 * references `var(--…)`. That is load-bearing, not stylistic: several themes define
 * `--cta: var(--amber)`, so reading `theme.vars["--cta"]` and using the string directly would
 * resolve `--amber` against whatever theme the APP is currently wearing — every preview would
 * quietly borrow the equipped theme's gold. Scoping the properties here makes each preview
 * self-contained.
 *
 * Decorative → aria-hidden.
 */
export function ThemeAppPreview({
  theme,
  height = 150,
  shine = false,
}: {
  theme: Theme;
  height?: number;
  /** One-shot light sweep for the just-unlocked moment. */
  shine?: boolean;
}) {
  // Everything is expressed in `u`, a fraction of the design height, so one component serves the
  // 150px featured panel and the 92px grid tile without a second set of numbers.
  const u = height / 150;
  const px = (n: number) => Math.max(1, Math.round(n * u));

  const bar = (w: string | number, color: string, h = 4, opacity = 1): CSSProperties => ({
    width: w,
    height: px(h),
    borderRadius: 999,
    background: color,
    opacity,
    flex: "none",
  });

  const cardRadius = px(12);

  return (
    <div aria-hidden style={{ ...(theme.vars as CSSProperties), ...root(height) }}>
      {/* ── header lockup: crest + wordmark, coin pill, avatar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: px(4) }}>
        <span
          style={{
            width: px(11),
            height: px(11),
            borderRadius: px(3),
            background: "var(--brand)",
            flex: "none",
          }}
        />
        <span style={bar(px(30), "var(--text)", 5, 0.9)} />
        <span style={{ flex: 1 }} />
        <span style={pill(px)}>
          <span
            style={{
              width: px(6),
              height: px(6),
              borderRadius: "50%",
              background: "var(--amber)",
              flex: "none",
            }}
          />
          <span style={bar(px(10), "var(--amber)", 3)} />
        </span>
        <span
          style={{
            width: px(13),
            height: px(13),
            borderRadius: "50%",
            background: "var(--brand-2)",
            border: "1px solid var(--line)",
            flex: "none",
          }}
        />
      </div>

      {/* ── the Daily Royale hero card ── */}
      <div style={{ ...surface(cardRadius), padding: px(8), display: "flex", flexDirection: "column", gap: px(5) }}>
        <div style={{ display: "flex", alignItems: "center", gap: px(4) }}>
          <span
            style={{
              width: px(5),
              height: px(5),
              borderRadius: "50%",
              background: "var(--lime)",
              flex: "none",
            }}
          />
          <span style={bar(px(22), "var(--lime)", 3, 0.9)} />
          <span style={{ flex: 1 }} />
          <span style={bar(px(16), "var(--muted)", 3, 0.7)} />
        </div>
        {/* the big serif title */}
        <span style={bar("62%", "var(--text)", 9, 0.92)} />
        <span style={bar("48%", "var(--muted)", 3.5, 0.75)} />
        {/* field meter */}
        <div style={{ ...bar("100%", "var(--line)", 3.5), overflow: "hidden" }}>
          <span style={{ display: "block", width: "58%", height: "100%", borderRadius: 999, background: "var(--brand)" }} />
        </div>
        {/* the brand CTA */}
        <div
          style={{
            marginTop: px(2),
            height: px(15),
            borderRadius: px(7),
            background: "var(--cta)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={bar(px(34), "var(--ctaText)", 3.5, 0.92)} />
        </div>
      </div>

      {/* ── two feature rows ── */}
      <div style={{ ...surface(cardRadius), padding: px(6), display: "flex", flexDirection: "column", gap: px(5) }}>
        {[0.72, 0.5].map((w, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: px(5) }}>
            <span
              style={{
                width: px(12),
                height: px(12),
                borderRadius: "50%",
                background: "color-mix(in srgb, var(--brand) 22%, transparent)",
                flex: "none",
              }}
            />
            <span style={{ display: "flex", flexDirection: "column", gap: px(2.5), flex: 1, minWidth: 0 }}>
              <span style={bar(`${w * 100}%`, "var(--text)", 3.5, 0.82)} />
              <span style={bar(`${w * 68}%`, "var(--muted)", 2.5, 0.7)} />
            </span>
            <span style={bar(px(4), "var(--muted)", 4, 0.5)} />
          </div>
        ))}
      </div>

      {shine && (
        <span
          className="rr-shine"
          style={{
            position: "absolute",
            inset: 0,
            width: "45%",
            background: "linear-gradient(105deg, transparent, rgba(255,255,255,.5), transparent)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

/** The page itself — the theme's own `--bg`, which is what the player actually stares at. */
const root = (height: number): CSSProperties => ({
  position: "relative",
  height,
  overflow: "hidden",
  background: "var(--bg)",
  padding: `${Math.round(height * 0.055)}px ${Math.round(height * 0.06)}px`,
  display: "flex",
  flexDirection: "column",
  gap: Math.round(height * 0.045),
  justifyContent: "flex-start",
});

/** A card, using the theme's own panel gradient + hairline — the app's `.rr-glass` in miniature. */
const surface = (radius: number): CSSProperties => ({
  borderRadius: radius,
  background: "linear-gradient(180deg, var(--panel2), var(--panel))",
  border: "1px solid var(--line)",
  boxShadow: "inset 0 1px 0 var(--sheen, rgba(255,255,255,.10))",
});

const pill = (px: (n: number) => number): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: px(3),
  padding: `${px(2)}px ${px(5)}px`,
  borderRadius: 999,
  background: "var(--panel)",
  border: "1px solid var(--line)",
  flex: "none",
});
