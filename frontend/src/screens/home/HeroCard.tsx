import { fmt, useT } from "@/i18n/useT";
import { useArtStyle } from "@/theme/useArtStyle";
import { CrownIcon } from "@/ui/CrownIcon";
import { SparkIcon } from "@/ui/icons";
import { useReducedMotion } from "@/ui/useReducedMotion";
import { DailyBadge } from "./hero/DailyBadge";
import { MonoDailyCard } from "./hero/MonoDailyCard";
import { DailyCountdownPill } from "./hero/DailyCountdownPill";
import { DailyCrownScene } from "./hero/DailyCrownScene";
import { DailyCTAButton } from "./hero/DailyCTAButton";
import { DailyEventMeter } from "./hero/DailyEventMeter";
import { DailyStatusPill } from "./hero/DailyStatusPill";
import { DailyTitleBlock } from "./hero/DailyTitleBlock";
import { type DailyTone, isAttentionTone } from "./hero/tone";

/**
 * The Daily Royale hero — the marquee of the Home screen and the app's main daily tournament gate:
 * a premium deep-royal-purple event panel with a gold-rimmed bevel, a top status row (OPEN NOW +
 * countdown), the big DAILY / ROYALE wordmark, RANKED + 8 QUESTIONS badges, a crown-trophy scene on
 * the right (the gold crown staged over the circular trivia-arena backdrop), a field + gold
 * event meter, and the gold ENTER DAILY ROYALE CTA.
 *
 * It stays a small state machine (A–F) driven by the royale window's state + settle_at + the user's
 * entry/result — the state→content mapping lives in {@link resolve}; the layout is componentised
 * ({@link DailyStatusPill}, {@link DailyTitleBlock}, {@link DailyBadge}, {@link DailyCrownScene},
 * {@link DailyEventMeter}, {@link DailyCTAButton}). Token-driven (re-skins per theme) and fluid via
 * container units (cqw) so it scales with the CARD — not the viewport — inside the max-width column.
 * Idle motion + hover collapse under `prefers-reduced-motion`.
 *
 *  A `before`    no open window; a scheduled royale exists      → "unlocks at {time}" + open countdown
 *  B `live`      royale OPEN, not entered                       → "Enter Daily Royale" CTA + field + close countdown
 *  C `locked`    royale OPEN, entered/submitted                 → "Score Locked" + score + provisional rank
 *  D `settling`  royale CLOSED, before settle_at                → "Field closed / Results settling" + settle countdown
 *  E `ready`     royale SETTLED, unseen result                  → "Results Ready" + "Reveal Your Standing" CTA
 *  F `viewed`    settled, result seen                           → summary rank + "tomorrow unlocks at {time}"
 */
export type HeroState =
  | { kind: "loading" }
  | { kind: "before"; opensText: string; countdown: string | null }
  | {
      kind: "live";
      oneShotText: string;
      fieldText: string | null;
      countdown: string;
      progress: number;
      onPlay: () => void;
    }
  | {
      kind: "locked";
      scoreText: string;
      fieldText: string | null;
      countdown: string;
      progress: number;
    }
  | { kind: "settling"; settleText: string; countdown: string; progress: number }
  | { kind: "ready"; onReveal: () => void }
  | { kind: "viewed"; rank: number | null; opensText: string; countdown: string | null };

export interface HeroCardProps {
  state: HeroState;
}

export function HeroCard({ state }: HeroCardProps) {
  const t = useT();
  const reduced = useReducedMotion();
  const artStyle = useArtStyle();
  const v = resolve(state, t);
  const isLoading = state.kind === "loading";
  const attention = isAttentionTone(v.tone);

  // The mono ("Blank") skins get a ground-up pure-CSS hero — typography, hairlines and space; no
  // crown art, no badges, no glow. Same resolved state copy, entirely different physique.
  if (artStyle === "mono") return <MonoDailyCard v={v} />;

  return (
    <div style={{ containerType: "inline-size", width: "100%" }}>
      <section className="rr-daily" style={cardStyle}>
        {/* Depth layers (decorative, non-interactive): a warm glow behind the crown, faint texture,
            vignette, glowing gold bottom rim. Absolute + pointer-none; none affect layout flow. */}
        <span aria-hidden style={{ ...crownGlow, opacity: attention ? 1 : 0.72 }} />
        <span aria-hidden style={texture} />
        <span aria-hidden style={vignette} />
        <span aria-hidden className={reduced ? undefined : "rr-card-shine"} style={cardShine} />
        <span aria-hidden style={goldBottomRim} />

        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: "clamp(15px, 4.4cqw, 24px)" }}>
          {/* Status row: OPEN NOW pill (left) + countdown pill (right). */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <DailyStatusPill tone={v.tone} text={v.pillText} reduced={reduced} />
            {v.countdown && <DailyCountdownPill countdown={v.countdown} showRemaining={v.progress != null} remainingLabel={t.home.remaining} />}
          </div>

          {/* Main row — the dominant zone: the giant title block (+ subtitle + badges) on the left, the
              large crown-trophy STAGE on the right, vertically centred against the whole left column.
              The stage is a self-bounded composition (see DailyCrownScene) whose arena halo fades to
              fully transparent before its own bitmap edge — so the stage can tuck into the card's
              padding (negative margins ≈ the padding, never past it) and the glow melts into the card
              background without the solid dome ever nearing the border or the overflow:hidden crop.
              The title column sits above the stage (zIndex) so the wordmark stays readable where the
              halo slips underneath it on narrow widths. */}
          <div style={{ display: "flex", alignItems: "center", gap: "clamp(4px, 1.5cqw, 12px)" }}>
            <div style={{ flex: "1 1 auto", minWidth: 0, position: "relative", zIndex: 2 }}>
              <DailyTitleBlock title={v.title} subtitle={v.subtitle} goldTail={state.kind === "live"} />
              {!isLoading && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: "clamp(10px, 2.8cqw, 14px)" }}>
                  <DailyBadge icon={<CrownIcon size={9} style={{ filter: "none" }} />} label={t.home.royaleRanked} />
                  <DailyBadge icon={<SparkIcon size={8} style={{ color: "var(--brand-2)" }} />} label={t.home.royaleFormat} />
                </div>
              )}
            </div>
            <div style={{ flex: "none", position: "relative", zIndex: 1, alignSelf: "center", marginRight: "clamp(-24px, -5.2cqw, -16px)", marginTop: "clamp(-10px, -2.5cqw, -6px)", marginBottom: "clamp(-14px, -3.5cqw, -8px)" }}>
              <DailyCrownScene size="clamp(168px, 56cqw, 230px)" reduced={reduced} />
            </div>
          </div>

          {/* Settle-time / secondary line (state D). */}
          {v.metaLine && <span style={{ color: "var(--muted)", fontSize: "clamp(11px, 3cqw, 13px)", fontWeight: 600 }}>{v.metaLine}</span>}

          {/* Event meta: field count + gold event meter (meter only when an open window is running).
              The countdown is intentionally NOT repeated here — it lives in the top-right status pill. */}
          {(v.fieldText || v.progress != null) && <DailyEventMeter fieldText={v.fieldText} progress={v.progress} />}

          {/* Primary CTA. */}
          {v.cta && <DailyCTAButton label={v.cta.label} onClick={v.cta.onClick} />}
        </div>
      </section>
    </div>
  );
}

interface Visual {
  tone: DailyTone;
  pillText: string;
  title: string;
  /** The line directly under the title (tagline / status line, per state). */
  subtitle: string | null;
  /** The field line ("N in the field" / "field still moving · N in the field"). */
  fieldText: string | null;
  /** A plain secondary line (e.g. the settle-time line) — no field icon. */
  metaLine: string | null;
  countdown: string | null;
  /** Elapsed-fraction of an OPEN window (0..1). `null` in pre-open states (A/F/E) → no meter. */
  progress: number | null;
  cta: { label: string; onClick: () => void } | null;
}

function resolve(state: HeroState, t: ReturnType<typeof useT>): Visual {
  const base: Visual = {
    tone: "muted",
    pillText: "",
    title: t.home.royaleTitle,
    subtitle: null,
    fieldText: null,
    metaLine: null,
    countdown: null,
    progress: null,
    cta: null,
  };

  switch (state.kind) {
    case "loading":
      return { ...base, pillText: t.common.oneSec, subtitle: t.home.loadingTitle };

    case "before":
      // Pre-open: counting DOWN to a future open. No window running → no meter.
      return { ...base, tone: "muted", pillText: t.home.nextGame, subtitle: state.opensText, countdown: state.countdown };

    case "live":
      return {
        ...base,
        tone: "live",
        pillText: t.home.openNow,
        // `oneShotText` carries the brand tagline; the Results time lives in the schedule rows.
        subtitle: state.oneShotText,
        fieldText: state.fieldText,
        countdown: state.countdown,
        progress: state.progress,
        cta: { label: t.home.enterRoyale, onClick: state.onPlay },
      };

    case "locked":
      // Same card, new chips: the SCORE LOCKED pill + banked score + "field still moving" reassure
      // that standings aren't final until close — no rank, no alternate layout (placement lives in
      // the results reveal and the leaderboard). The field count rides the moving line when known.
      return {
        ...base,
        tone: "muted",
        pillText: t.home.scoreLocked,
        subtitle: state.scoreText,
        fieldText: state.fieldText ? `${t.home.fieldMoving} · ${state.fieldText}` : t.home.fieldMoving,
        countdown: state.countdown,
        progress: state.progress,
      };

    case "settling":
      return { ...base, tone: "muted", pillText: t.home.fieldClosed, subtitle: t.home.resultsSettling, metaLine: state.settleText, countdown: state.countdown, progress: state.progress };

    case "ready":
      return { ...base, tone: "ready", pillText: t.home.resultsReady, subtitle: t.home.resultsReadyLine, cta: { label: t.home.revealStanding, onClick: state.onReveal } };

    case "viewed":
      // Post-reveal summary, counting DOWN to tomorrow's open — countdown only, no meter. The final
      // placement rides the subtitle as calm copy (the card's layout never changes).
      return {
        ...base,
        tone: state.rank === 1 ? "leading" : "muted",
        pillText: t.home.nextGame,
        subtitle:
          state.rank != null
            ? `${fmt(t.home.finishedPlace, { n: state.rank })} · ${state.opensText}`
            : state.opensText,
        countdown: state.countdown,
      };
  }
}

/* ---- Card shell + depth layers (token-driven so the whole card re-skins per theme) ---- */

const cardStyle: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  // This is the app's MAIN EVENT banner — it stages tall. The live state grows from its own content
  // (huge title + trophy stage + meter + big CTA); minHeight floors the sparse resting states so they
  // read as a premium hero, not a compact module — but stays low enough not to leave a void under the
  // crown in the sparse states (verified in the preview harness).
  minHeight: "clamp(236px, 64cqw, 312px)",
  padding: "clamp(20px, 5.6cqw, 30px)",
  borderRadius: "clamp(26px, 7cqw, 36px)",
  // Layered lighting (not a single flat gradient): a strong focal royal glow behind the crown stage, a
  // soft support glow behind the title, over a DEEP near-black-violet base that sinks to almost black
  // in the lower corners so the edges recede hard and the lit foreground pops. Token-driven (re-skins).
  background:
    "radial-gradient(82% 76% at 78% 26%, color-mix(in srgb, var(--brand) 60%, transparent) 0%, transparent 55%)," +
    " radial-gradient(64% 60% at 8% 30%, color-mix(in srgb, var(--brand-2) 26%, transparent) 0%, transparent 62%)," +
    " linear-gradient(160deg, color-mix(in srgb, var(--panel) 50%, black) 0%, color-mix(in srgb, var(--panel2) 32%, black) 44%, #06030f 100%)",
  // Confident gold rim; a visible inner purple stroke + inner bottom-gold glow + top highlight complete
  // the bevel and give the frame real dimension.
  border: "1.5px solid color-mix(in srgb, var(--amber) 56%, transparent)",
  boxShadow:
    "inset 0 0 0 1.5px color-mix(in srgb, var(--brand-2) 40%, transparent)," +
    " inset 0 -44px 78px rgba(0,0,0,.64)," +
    " inset 0 -14px 46px color-mix(in srgb, var(--amber) 14%, transparent)," +
    " inset 0 2px 0 rgba(255,255,255,.14)," +
    " 0 38px 84px rgba(0,0,0,.7), 0 0 58px color-mix(in srgb, var(--brand) 32%, transparent)",
};

/** Warm gold/violet glow behind the crown (upper-right) — the trophy stage's focal light source. */
const crownGlow: React.CSSProperties = {
  position: "absolute",
  right: "3%",
  top: "40%",
  width: "60%",
  height: "84%",
  transform: "translateY(-50%)",
  borderRadius: "50%",
  background:
    "radial-gradient(circle, color-mix(in srgb, var(--amber) 42%, transparent) 0%, color-mix(in srgb, var(--brand) 36%, transparent) 42%, transparent 72%)",
  filter: "blur(14px)",
  pointerEvents: "none",
};

/** A slow, wide diagonal light sweep across the whole card every few seconds — a controlled premium
 * "glint" (115deg → never the 90deg progress-fill the test keys off; a span → not counted either). */
const cardShine: React.CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  left: "-30%",
  width: "55%",
  background: "linear-gradient(115deg, transparent 40%, rgba(255,255,255,.12) 50%, transparent 60%)",
  pointerEvents: "none",
};

/** Faint speckle texture for depth — kept low so it never reads as noise. */
const texture: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  opacity: 0.5,
  pointerEvents: "none",
  backgroundImage:
    "radial-gradient(1.3px 1.3px at 16% 22%, rgba(255,255,255,.5), transparent)," +
    "radial-gradient(1px 1px at 40% 70%, rgba(255,255,255,.32), transparent)," +
    "radial-gradient(1.4px 1.4px at 70% 20%, rgba(255,201,30,.3), transparent)," +
    "radial-gradient(1px 1px at 88% 60%, rgba(199,180,255,.3), transparent)," +
    "radial-gradient(1.2px 1.2px at 30% 88%, rgba(255,255,255,.28), transparent)",
};

/** Corner vignette — a deep darkening so the edges/corners recede hard and the lit crown stage pops. */
const vignette: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  borderRadius: "inherit",
  pointerEvents: "none",
  background:
    "radial-gradient(122% 118% at 54% 34%, transparent 40%, rgba(6,3,16,.44) 72%, rgba(3,1,10,.8) 100%)",
};

/** Glowing gold bottom rim — the brightest edge of the bevel. */
const goldBottomRim: React.CSSProperties = {
  position: "absolute",
  left: "6%",
  right: "6%",
  bottom: 0,
  height: 2.5,
  borderRadius: 999,
  background: "linear-gradient(115deg, transparent, color-mix(in srgb, var(--amber) 88%, transparent), transparent)",
  pointerEvents: "none",
};
