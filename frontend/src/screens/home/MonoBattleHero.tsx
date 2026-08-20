import type { CSSProperties, ReactNode } from "react";
import { useT } from "@/i18n/useT";
import { getPreset } from "@/theme/identity";
import type { ThemeArt } from "@/theme/tokens";
import { useThemeArt } from "@/theme/useArtStyle";
import { FitText } from "@/ui/FitText";
import { GemIcon } from "@/ui/GemIcon";
import { TrophyIcon } from "@/ui/icons";

/**
 * The mono ("Blank") Battle Mode HERO — takes the Daily Royale's place at the top of Home once
 * today's attempt is used, so the primary action is always playable.
 *
 * On the Starter system (art present) it is a full HERO BANNER (min-height ~360, roomy padding):
 * status + big serif title top-left, a "head-to-head" subtitle + Best-of pill mid-left, a large
 * composed PLAYER-vs-PLAYER matchup on the right (two clean avatar discs over a soft crossed-
 * swords + crown backdrop, diamond VS between them), then a three feature-pill row (Ranked Play /
 * Win Gems / Streaks) above a full-width purple CTA anchored at the bottom. The art-less Blank pair
 * keeps its original pure-CSS card untouched.
 *
 * Copy honesty (DESIGN §7): no invented "N battling" concurrency counts, no fake matchmaking states.
 */
export function MonoBattleHero({ onDuel, myPreset }: { onDuel: () => void; myPreset?: string }) {
  const t = useT();
  const art = useThemeArt();

  const status = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span
          aria-hidden
          style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--brand)", flex: "none" }}
        />
        <span style={{ ...caps, color: "var(--brand)" }}>{t.home.openNow}</span>
      </span>
      {!art && <span style={caps}>{t.duel.cardBestOf}</span>}
    </div>
  );

  const cta = (
    <button
      type="button"
      className="rr-tap"
      onClick={onDuel}
      style={{
        position: "relative",
        width: "100%",
        marginTop: art ? 0 : 4,
        minHeight: art ? 58 : undefined,
        padding: art ? "16px 46px 16px 22px" : "15px 44px 15px 20px",
        borderRadius: art ? 18 : "var(--radius-ctl, 12px)",
        border: "none",
        background: art
          ? "linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,0) 46%), var(--cta)"
          : "var(--cta)",
        color: "var(--ctaText)",
        fontFamily: "inherit",
        fontSize: art ? 14.5 : 13,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        textAlign: "center",
        cursor: "pointer",
        boxShadow: art
          ? "0 12px 26px color-mix(in srgb, var(--brand) 30%, transparent), 0 2px 6px color-mix(in srgb, var(--brand) 22%, transparent), inset 0 2px 0 rgba(255,255,255,.30), inset 0 -4px 9px rgba(0,0,0,.18)"
          : undefined,
      }}
    >
      <FitText
        as="span"
        size={art ? 14.5 : 13}
        min={0.58}
        style={{ display: "block", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textAlign: "center" }}
      >
        {t.duel.cardCta}
      </FitText>
      <span
        aria-hidden
        style={{ position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)", fontSize: art ? 16 : 15, fontWeight: 600 }}
      >
        →
      </span>
    </button>
  );

  // ── Art-less Blank pair: the original pure-CSS card, untouched. ──
  if (!art) {
    return (
      <section className="rr-glass" style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        {status}
        <div className="display" style={{ fontSize: "clamp(30px, 9.2vw, 38px)", lineHeight: 1.06, color: "var(--text)" }}>
          {t.duel.cardTitle}
        </div>
        <div style={{ color: "var(--muted)", fontSize: 13.5, fontWeight: 500, lineHeight: 1.5, marginTop: -4 }}>
          {t.duel.cardSubtitle}
        </div>
        <div
          aria-hidden
          style={{
            height: 3,
            borderRadius: 999,
            background:
              "linear-gradient(90deg, var(--brand), color-mix(in srgb, var(--brand) 35%, transparent) 60%, transparent)",
          }}
        />
        {cta}
      </section>
    );
  }

  // ── Starter (art) HERO BANNER. ──
  const mine = getPreset(myPreset);
  // The rival face is the blonde `bishop` (or `crescent` when the player themselves wears bishop).
  const rival = mine.id === "bishop" ? getPreset("crescent") : getPreset("bishop");

  return (
    <section className="rr-glass" style={card}>
      {/* z1 — the large matchup art, hugging the right edge and spanning the title→pills band. */}
      <BattleScene art={art} mine={mine.portrait} rival={rival.portrait} />

      {/* z2 — status + title (top-left). */}
      <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column" }}>
        {status}
        <div className="display" style={title}>
          {t.duel.cardTitle}
        </div>
      </div>

      {/* z2 — subtitle + Best-of pill (mid-left), nudged toward the vertical middle. */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          marginTop: "clamp(14px, 5vw, 26px)",
          maxWidth: "48%",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ color: "var(--muted)", fontSize: 14.5, fontWeight: 500, lineHeight: 1.45 }}>
          {t.duel.cardSubtitle}
        </div>
        <span style={pill}>{t.duel.cardBestOf}</span>
      </div>

      {/* z2 — feature pills + full-width CTA, anchored to the bottom. */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          marginTop: "auto",
          paddingTop: "clamp(16px, 5vw, 22px)",
          display: "flex",
          flexDirection: "column",
          gap: "clamp(6px, 1.8vw, 9px)",
        }}
      >
        <div style={{ display: "flex", flexWrap: "nowrap", gap: "clamp(5px, 1.6vw, 10px)" }}>
          <FeaturePill icon={<TrophyIcon size={12} />} label={t.duel.pillRanked} />
          <FeaturePill icon={<GemIcon size={11} style={{ color: "var(--brand)" }} />} label={t.duel.pillGems} />
          <FeaturePill icon={<FlameGlyph size={12} />} label={t.duel.pillStreaks} />
        </div>
        {cta}
      </div>
    </section>
  );
}

/** One feature chip — a brand-tinted glyph + an uppercase label, three across above the CTA. */
function FeaturePill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span style={featurePill}>
      <span aria-hidden style={{ display: "inline-flex", color: "var(--brand)", flex: "none" }}>
        {icon}
      </span>
      <FitText as="span" size="clamp(8px, 2.3vw, 9.5px)" min={0.66} style={{ minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
        {label}
      </FitText>
    </span>
  );
}

/** Monochrome day-streak flame (currentColor) so the pill glyphs share one brand tint. */
function FlameGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden style={{ width: size, height: size, display: "block" }}>
      <path
        d="M12.6 2 C13.1 6 17 7.6 17 12.6 A5 5 0 0 1 7 12.6 C7 9.9 8.6 8.4 9.4 6.9 C9.7 8.5 10.7 8.9 11.3 8 C12 7 12.1 4.4 12.6 2 Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** The right-side head-to-head cluster — composed FOREGROUND-first so it reads as PLAYER vs PLAYER.
 * Two equal player medallions share one horizontal centreline; the VS badge sits centred between
 * them, overlapping the gap. The crossed-swords + crown emblem is a soft, edge-faded backdrop.
 * Layer order: z1 swords backdrop → z3 avatar discs → z5 VS badge. */
function BattleScene({ art, mine, rival }: { art: ThemeArt; mine?: string; rival?: string }) {
  return (
    <span aria-hidden style={sceneStage}>
      {/* z1 — crossed swords + crown, radially masked so the blade tips / crown fade at the edges. */}
      <img src={art.battleScene} alt="" draggable={false} style={sceneBg} />
      {/* z3 — the two players, equal size, on a shared centreline, flanking the centre. The left
          portrait's crop is nudged up a touch so both faces read on the same visual line. */}
      <span style={{ ...medPos, left: "23%" }}>
        <Medallion portrait={mine} objectPosition="center 31%" />
      </span>
      <span style={{ ...medPos, left: "77%" }}>
        <Medallion portrait={rival} />
      </span>
      {/* z5 — the VS badge, centred between the players and overlapping the gap between them. */}
      <img src={art.vsBadge} alt="" draggable={false} style={vsBadge} />
    </span>
  );
}

/** One player portrait — a clean circular avatar disc over the swords backdrop (no ornamental frame
 * ring). A soft disc fill + hairline + drop-shadow keep it reading as a coin against the busy art. */
function Medallion({
  portrait,
  objectPosition = "center 26%",
}: {
  portrait?: string;
  /** Per-side crop tuning so both faces sit on the same visual line. */
  objectPosition?: string;
}) {
  return (
    <span style={medallion}>
      {portrait && (
        <img
          src={portrait}
          alt=""
          draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition, display: "block" }}
        />
      )}
    </span>
  );
}

// The hero-banner shell: taller than a list card, roomy padding, warm ivory-glass wash pooling
// toward the art corner. rr-glass supplies the border + premium shadow; we override size/bg here.
const card: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  minHeight: "clamp(300px, 80vw, 336px)",
  padding: "clamp(20px, 5.6vw, 26px) clamp(20px, 5.4vw, 26px) clamp(16px, 4.4vw, 20px)",
  borderRadius: 30,
  display: "flex",
  flexDirection: "column",
  background:
    "radial-gradient(120% 90% at 100% 30%, color-mix(in srgb, var(--brand) 9%, transparent) 0%, transparent 58%), linear-gradient(180deg, color-mix(in srgb, var(--panel) 94%, transparent), color-mix(in srgb, var(--panel) 78%, transparent))",
};

const title: CSSProperties = {
  fontSize: "clamp(30px, 9vw, 40px)",
  lineHeight: 1.0,
  color: "var(--text)",
  marginTop: "clamp(8px, 3vw, 12px)",
  maxWidth: "62%",
};

// The art cluster's own coordinate space — absolutely placed on the right, spanning the title→pills
// band. Large enough to carry two prominent medallions + the VS with the swords behind.
const sceneStage: CSSProperties = {
  position: "absolute",
  zIndex: 1,
  top: "clamp(48px, 13vw, 64px)",
  right: "clamp(-10px, -2.6vw, -4px)",
  width: "clamp(188px, 50vw, 224px)",
  height: "clamp(160px, 43vw, 192px)",
  pointerEvents: "none",
};

// The swords are the backdrop: centred, softened, and radially masked so the crown (top-centre,
// above the VS) reads as part of the emblem while the blade tips dissolve toward the edges.
const sceneBg: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "48%",
  transform: "translate(-50%, -50%)",
  width: "112%",
  height: "auto",
  opacity: 0.6,
  objectFit: "contain",
  filter: "saturate(0.96)",
  WebkitMaskImage: "radial-gradient(closest-side, #000 64%, transparent 100%)",
  maskImage: "radial-gradient(closest-side, #000 64%, transparent 100%)",
  zIndex: 1,
  pointerEvents: "none",
};

// Both players share ONE horizontal centreline, lifted above dead-centre (top 40%) so they sit
// squarely inside the swords' upper glow pockets just under the crown — filling that gap instead of
// floating low over the handles. Each is centred on its own x anchor (left: 23% / 77%).
const medPos: CSSProperties = {
  position: "absolute",
  top: "40%",
  transform: "translate(-50%, -50%)",
  zIndex: 3,
};

// The clean avatar disc: no frame ring — just the circular-clipped portrait on a soft disc fill,
// with a hairline + shadow so it separates cleanly from the swords behind.
const medallion: CSSProperties = {
  display: "block",
  flex: "none",
  width: "clamp(56px, 15vw, 68px)",
  height: "clamp(56px, 15vw, 68px)",
  borderRadius: "50%",
  overflow: "hidden",
  background: "color-mix(in srgb, var(--brand) 12%, var(--panel2))",
  border: "2px solid var(--panel)",
  boxShadow:
    "0 0 0 1px color-mix(in srgb, var(--brand) 20%, var(--line)), 0 5px 12px color-mix(in srgb, var(--brand) 26%, transparent)",
};

// The VS badge is positioned by the PLAYERS (dead centre, same centreline), not the swords, and
// sits above them so it overlaps the gap. Its box is also mostly padding → ~108px box ≈ ~42px badge.
const vsBadge: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "40%",
  transform: "translate(-50%, -50%)",
  zIndex: 5,
  width: "clamp(92px, 25vw, 108px)",
  height: "auto",
  filter: "drop-shadow(0 3px 6px color-mix(in srgb, var(--brand) 28%, transparent))",
  pointerEvents: "none",
};

const pill: CSSProperties = {
  display: "inline-flex",
  alignSelf: "flex-start",
  alignItems: "center",
  gap: 6,
  height: 32,
  padding: "0 14px",
  borderRadius: 999,
  border: "1px solid var(--line)",
  background: "color-mix(in srgb, var(--panel) 55%, transparent)",
  color: "var(--text)",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

// Feature chip — content-sized (like the mockup: the wider Ranked-Play pill + trailing space), so
// the full labels always read; tuned to still fit three-across without wrapping down to 320px.
const featurePill: CSSProperties = {
  // `0 1 auto` + `minWidth: 0` (below) lets a longer localized label shrink-to-fit its pill in the
  // no-wrap three-across row instead of overflowing it; English fits, so no pill shrinks.
  flex: "0 1 auto",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  height: "clamp(29px, 8vw, 33px)",
  padding: "0 clamp(6px, 2vw, 10px)",
  borderRadius: 999,
  border: "1px solid var(--line)",
  background: "color-mix(in srgb, var(--panel) 55%, transparent)",
  color: "var(--text)",
  fontSize: "clamp(8px, 2.3vw, 9.5px)",
  fontWeight: 700,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const caps: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--muted)",
};
