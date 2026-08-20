import { useEffect, useState } from "react";
import { api, ApiError, type ChallengePublic } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { getTheme } from "@/theme/tokens";
import { FitText } from "@/ui/FitText";

/**
 * Paint the page in the SHARER's equipped theme for as long as the landing is mounted.
 *
 * The visitor is anonymous, so `App` has applied the default skin. A share link should look like
 * the app the sender actually plays — that's the whole pitch of the card — so the landing
 * overrides the root vars, then puts back exactly what it found on unmount. Restoring matters:
 * `App`'s own theme effect is keyed on the viewer's equipped theme and will NOT re-run when this
 * unmounts, so without the snapshot the sender's colours would leak into the visitor's session.
 */
function useSharerTheme(themeId: string | undefined): string | null {
  const [style, setStyle] = useState<string | null>(null);

  useEffect(() => {
    if (!themeId) return;
    const theme = getTheme(themeId);
    const root = document.documentElement;
    const previous = new Map<string, string>();
    for (const [key, value] of Object.entries(theme.vars)) {
      previous.set(key, root.style.getPropertyValue(key));
      root.style.setProperty(key, value);
    }
    setStyle(theme.style);
    return () => {
      for (const [key, value] of previous) {
        if (value) root.style.setProperty(key, value);
        else root.style.removeProperty(key);
      }
    };
  }, [themeId]);

  return style;
}

/**
 * The public share LANDING — where a `…/c/<id>` link drops an anonymous visitor. It shows the
 * sharer's spoiler-free result ("Tommy · 742 · Top 3% today") as the hook, then a single prominent
 * CTA that starts them playing TODAY's Daily Royale immediately — no download, no signup (App wires
 * the CTA to `startGuest()` + the Contest flow). It never shows a question or answer; it's a display
 * snapshot fetched from the public `GET /api/challenges/{id}`.
 *
 * This is the Daily-Royale share loop — NOT a 1v1 friend duel (that lives on the Friends screen).
 */
export function ChallengeLanding({
  challengeId,
  onPlay,
  onSkip,
}: {
  challengeId: string;
  /** Start today's Daily Royale for this visitor (App: guest session if needed → Contest). */
  onPlay: (windowId: string) => void | Promise<void>;
  /** Dismiss the landing into the normal app (link with no open window / visitor taps away). */
  onSkip: () => void;
}) {
  const t = useT();
  const [data, setData] = useState<ChallengePublic | null>(null);
  const [error, setError] = useState(false);
  const [starting, setStarting] = useState(false);
  // Paints the page in the sharer's equipped skin once the snapshot lands, and hands the art-style
  // class back so the shape/typography tokens (`s-mono`, `s-arcade`, …) match too.
  const artStyle = useSharerTheme(data?.theme);

  useEffect(() => {
    let alive = true;
    api
      .getChallenge(challengeId)
      .then((c) => alive && setData(c))
      .catch((e) => alive && setError(!(e instanceof ApiError) || e.status !== 0));
    return () => {
      alive = false;
    };
  }, [challengeId]);

  async function play() {
    if (!data?.playable_window_id || starting) return;
    setStarting(true);
    try {
      await onPlay(data.playable_window_id);
    } catch {
      setStarting(false); // let them retry; App keeps them on the landing on failure
    }
  }

  if (error) {
    return (
      <main style={wrap}>
        <div style={card}>
          <div style={brand}>{t.challenge.brand}</div>
          <div style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.5 }}>
            {t.challenge.notFound}
          </div>
          <button type="button" style={cta} onClick={onSkip}>
            <FitText as="span" size={16.5} min={0.6} style={ctaLabel}>
              {t.challenge.openApp}
            </FitText>
          </button>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main style={wrap}>
        <div style={{ ...card, color: "var(--muted)" }}>{t.challenge.brand}…</div>
      </main>
    );
  }

  const pct = data.percentile;
  return (
    <main className={artStyle ? `rr-root s-${artStyle}` : undefined} style={wrap}>
      {/* The result sits on a real panel — the same elevated card the Starter hub uses — rather
          than floating on the page, so the sharer's skin reads as a designed surface. */}
      <div style={card}>
        <div style={panel}>
          <div style={brand}>{fmt(t.challenge.contestNo, { no: data.contest_no })}</div>

          {/* The hook: the sharer's result, spoiler-free. */}
          <FitText as="div" className="display" size={30} min={0.55} style={name}>
            {data.username}
          </FitText>
          <div className="display" style={score}>
            {data.score}
          </div>

          <StarDivider />

          {pct != null ? (
            <div style={topPct}>{fmt(t.challenge.topPct, { pct })}</div>
          ) : (
            <div style={topPct}>{fmt(t.challenge.contestNo, { no: data.contest_no })}</div>
          )}
        </div>

        <div style={beatMe}>{t.challenge.beatMe}</div>

        {data.playable_window_id ? (
          <button type="button" style={cta} onClick={play} disabled={starting}>
            <FitText as="span" size={16.5} min={0.6} style={ctaLabel}>
              {starting ? t.challenge.starting : t.challenge.play}
            </FitText>
          </button>
        ) : (
          <>
            <div style={{ color: "var(--muted)", fontSize: 14, textAlign: "center" }}>
              {t.challenge.notOpen}
            </div>
            <button type="button" style={cta} onClick={onSkip}>
              <FitText as="span" size={16.5} min={0.6} style={ctaLabel}>
                {t.challenge.openApp}
              </FitText>
            </button>
          </>
        )}
        <div style={{ color: "var(--faint)", fontSize: 12.5, textAlign: "center" }}>
          {t.challenge.freeNoSignup}
        </div>
      </div>
    </main>
  );
}

/** Hairline rule with a small gold diamond — the Starter hero's divider, matched here. */
function StarDivider() {
  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        maxWidth: 210,
        // The display serif's descenders hang below the score's line box; without this the rule
        // runs straight under them and the whole block reads as crowded.
        margin: "6px 0 2px",
      }}
    >
      <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, var(--line))" }} />
      <span
        style={{
          flex: "none",
          width: 7,
          height: 7,
          transform: "rotate(45deg)",
          borderRadius: 1.5,
          background: "linear-gradient(135deg, color-mix(in srgb, var(--amber) 62%, white), var(--amber))",
          boxShadow: "0 0 0 3px color-mix(in srgb, var(--amber) 12%, transparent)",
        }}
      />
      <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg, var(--line), transparent)" }} />
    </div>
  );
}

const wrap: React.CSSProperties = {
  minHeight: "100dvh",
  display: "grid",
  placeItems: "center",
  padding: "calc(24px + env(safe-area-inset-top)) 22px calc(28px + env(safe-area-inset-bottom))",
};

const card: React.CSSProperties = {
  width: "100%",
  maxWidth: 380,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 18,
  textAlign: "center",
};

/** The elevated result surface — Starter's panel treatment (hairline + sheen, not a flat box). */
const panel: React.CSSProperties = {
  width: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 12,
  padding: "26px 22px 24px",
  borderRadius: 26,
  background: "var(--panel)",
  border: "1px solid color-mix(in srgb, var(--line) 75%, transparent)",
  boxShadow: "inset 0 1px 0 var(--sheen), 0 18px 42px rgba(17,17,17,.10), 0 4px 14px rgba(17,17,17,.05)",
};

const brand: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: "var(--brand)",
};

/** FitText owns the size: a long handle shrinks instead of wrapping and breaking the card. */
const name: React.CSSProperties = {
  width: "100%",
  fontWeight: 700,
  lineHeight: 1.1,
  color: "var(--text)",
  whiteSpace: "nowrap",
};

const score: React.CSSProperties = {
  fontSize: "clamp(64px, 22vw, 96px)",
  lineHeight: 1,
  fontWeight: 700,
  color: "var(--text)",
  // The display serif's descenders sit outside a 1.0 line box; no clipping here (see StarterHero).
  letterSpacing: "-0.02em",
};

const topPct: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--amber)",
};

const beatMe: React.CSSProperties = {
  color: "var(--text)",
  fontSize: 17,
  fontWeight: 600,
  lineHeight: 1.35,
  textAlign: "center",
};

const cta: React.CSSProperties = {
  width: "100%",
  padding: "16px 22px",
  borderRadius: 14,
  border: "none",
  background: "var(--cta)",
  color: "var(--ctaText)",
  fontFamily: "var(--font-display)",
  fontSize: 16.5,
  fontWeight: 700,
  letterSpacing: "0.01em",
  cursor: "pointer",
};

/** The CTA label holds one line: a longer localized label shrinks to fit the full-width button
 *  (FitText owns the font-size) rather than wrapping to a second line. */
const ctaLabel: React.CSSProperties = {
  display: "block",
  width: "100%",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textAlign: "center",
};
