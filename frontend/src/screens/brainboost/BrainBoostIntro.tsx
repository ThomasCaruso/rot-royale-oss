/**
 * First-open intro — the front door of the app. A brand-new (anonymous) user always lands here on
 * the default ivory Starter theme. Premium game onboarding: the "ROT ROYALE" kicker, a large elegant
 * serif "Daily Royale" headline, the ranked-daily payoff sub, the crown-on-podium hero, three quiet
 * reason pills, a three-column card of what today's run pays back, and one wide purple CTA.
 * "PLAY DAILY ROYALE" silently creates a guest account and drops straight into today's ranked Daily
 * Royale — no signup wall (the save-account moment comes after the run, at the Daily Royale finish).
 * Returning players use the small log-in link.
 *
 * Staged as a full-screen event reveal: one fixed 100dvh column where every block but the hero has
 * a fixed height, so all leftover space goes to the crown. See the styles block for how the type
 * scale is taken from the mockup and why the vertical rhythm deliberately isn't.
 */

import type { CSSProperties } from "react";
import {useEffect, useState} from "react";
import { useT } from "@/i18n/useT";
import { trackFunnel, trackFunnelOnce } from "@/lib/analytics";
import { useThemeArt } from "@/theme/useArtStyle";
import { Display } from "@/ui/Display";
import { ReturningUserRow } from "./ReturningUserRow";
import { CrownStage } from "@/ui/royal/CrownStage";
import { PageOrnament } from "@/ui/royal/PageOrnament";
import { FitText } from "@/ui/FitText";
import { BoltIcon } from "@/ui/icons";

export function BrainBoostIntro({
  onStart,
  onEmailLogin,
}: {
  onStart: () => Promise<void>;
  /** Opens the dedicated sign-in screen on its email step (the Apple/Google tiles sign in here). */
  onEmailLogin: () => void;
}) {
  const t = useT();
  const art = useThemeArt();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    trackFunnelOnce("intro_viewed");
  }, []);

  async function start() {
    trackFunnel("start_check_clicked");
    setBusy(true);
    setError(false);
    try {
      await onStart();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  // Three reason pills, paired with a restrained monochrome glyph each.
  return (
    <main style={shell}>
      {/* Page ornament — ambient light, grain and the corner contour sweeps, identical to the
          sign-in screen's. Replaces the painted lavender plate this screen used to stand on: the
          front door and the front door's login step now share one background, so moving between
          them is continuous rather than a change of world. */}
      <PageOrnament />

      {/* One line, always — the fixed 100dvh layout budgets this kicker at a single line; a longer
          localized kicker shrinks to fit the column rather than wrapping and stealing crown space. */}
      <FitText as="div" size={13} min={0.66} style={kicker}>
        {t.brainBoost.introKicker}
      </FitText>

      <Display as="h1" style={headline}>
        {t.brainBoost.introHeadline}
      </Display>

      {/* The crown, standing in light rather than on a podium. Every layer of the stage — halo,
          light field, refracted arcs, base flare and contact shadow — is derived from the crown's
          box, so the whole thing rescales with `HERO_CROWN` and stays registered to the crown at
          any viewport. See `ui/royal/CrownStage`. */}
      {art && (
        <div style={heroStage}>
          <CrownStage size={HERO_CROWN} src={art.crownBare} animate />
        </div>
      )}

      {/* The one line of copy on this screen. Everything that used to sit here — three pills and a
          three-column "what you earn" card — was removed: a brand-new user had to process six
          separate claims before reaching the button they came for. */}
      <p style={subtitle}>{t.brainBoost.introSubtitle}</p>

      {/* The entrance rides the WRAPPER, not the button. `.rr-root.s-mono button { animation: none
          !important }` in global.css strips animations from buttons on the mono skin — which
          Starter is — so a class on the <button> is silently swallowed (the shine survives only
          because it is a <span> inside it). Animating the wrapper also lets the button and its
          reassurance line rise together, which is what they should do. */}
      <div style={ctaWrap} className="rr-cta-in">
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy}
          className="rr-grow rr-grow-cta"
          // Scale, not a nudge: the press should feel like the button gives under the finger. Fired
          // on POINTER DOWN so it lands with the touch rather than after the click resolves (§7b1).
          // Sets the --rr-press VARIABLE rather than `transform` — .rr-grow multiplies press by
          // hover, and an inline transform here would win the cascade and kill hover permanently.
          onPointerDown={(e) => !busy && e.currentTarget.style.setProperty("--rr-press", "0.97")}
          onPointerUp={(e) => e.currentTarget.style.removeProperty("--rr-press")}
          onPointerLeave={(e) => e.currentTarget.style.removeProperty("--rr-press")}
          style={cta(busy)}
        >
          <span style={ctaShine} className="rr-cta-shine" aria-hidden />
          {/* One line: a longer localized CTA shrinks to fit the fixed-height button instead of
              wrapping. FitText owns the font-size; the button's letter-spacing / text-indent /
              uppercase are inherited properties, so the English rendering is unchanged. */}
          <FitText
            as="span"
            size={15.5}
            min={0.6}
            style={{ display: "block", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textAlign: "center" }}
          >
            {busy ? t.brainBoost.starting : t.brainBoost.introPlay}
          </FitText>
        </button>
        {error && <div style={errorText}>{t.auth.somethingWentWrong}</div>}

        {/* The single objection worth answering before the first tap, and the only reason it earns
            a line: "do I have to sign up?" is what stops a stranger playing. Not a pill — a pill
            would make it a fourth thing to read rather than a footnote to the button. */}
        <span style={reassure}>
          {/* Gold, not the text colour: it is the one warm note down here and ties the line back
              to the crown. Near-full opacity so it does not read as a detached grey mark. */}
          <BoltIcon size={13} style={{ color: "var(--amber)", opacity: 0.92 }} />
          {t.brainBoost.introNoSignup}
        </span>
      </div>

      {/* NO spacer above the returning-user row. The gap to it is a fixed 48px (see `returningRow`)
          and every remaining pixel of the column falls BELOW the row instead.
          Three versions of this: all the slack above (178px void — the row read as stranded on the
          bottom padding), split 2:1 (118px — better, still two separate screen sections), and now a
          fixed 48. The reassurance and the login prompt are related, so the whitespace belongs
          after them, not between them. */}

      {/* Returning players only. Small, quiet and last — see `ReturningUserRow` for why it is built
          to lose to the CTA above it. */}
      <ReturningUserRow onEmail={onEmailLogin} style={returningRow} />

      <div style={{ flex: "1 1 0", minHeight: 0 }} aria-hidden />
    </main>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Staged like a full-screen event reveal, not an onboarding form. The page is one fixed 100dvh
 * column; the HERO is the only elastic block, so every pixel the fixed blocks don't spend goes to
 * the crown. Text sizes come from the mockup measured by WIDTH (the reliable metric — its headline
 * spans 86.8% of the content column, its sub line 79.3%), and the vertical rhythm is a deliberate
 * cadence rather than the mockup's raw gaps, because a 1:2.1 phone has room the mockup's 2:3 frame
 * doesn't. Fixed blocks total ~560px, so the layout holds on one screen down to a very short
 * viewport before the hero has given up all its room.
 * ─────────────────────────────────────────────────────────────────────────────────────────────── */

const shell: CSSProperties = {
  position: "relative",
  height: "100dvh",
  overflow: "hidden",
  // NO background of its own: the root's `--bg` shows through, so this screen is pixel-identical to
  // Home rather than a near-miss cream. The art was re-graded to that same white point instead, so
  // the dissolve still has nothing to reveal.
  display: "flex",
  flexDirection: "column",
  gap: 0,
  // 20px gutters (was 24): the extra width goes to the headline, which needs it to hold one line.
  padding:
    "calc(26px + env(safe-area-inset-top)) 20px calc(26px + env(safe-area-inset-bottom))",
  maxWidth: 430,
  margin: "0 auto",
  textAlign: "center",
};

/* The backdrop art sits at the hero's own z-layer, so everything outside the hero is lifted one
 * step above it. */
const overArt: CSSProperties = { position: "relative", zIndex: 1 };

const kicker: CSSProperties = {
  ...overArt,
  letterSpacing: "0.42em",
  // The tracking is added to the right of the last glyph too, so the word reads off-centre without
  // paying it back.
  textIndent: "0.42em",
  textTransform: "uppercase",
  fontWeight: 800,
  lineHeight: 1.2,
  color: "var(--brand)",
  // FitText owns the font-size (13px ceiling). nowrap + overflow keep it single-line so a longer
  // localized kicker shrinks instead of wrapping into the crown's vertical budget.
  whiteSpace: "nowrap",
  overflow: "hidden",
};

/* The dominant element on the page. Sized by MEASURED WIDTH, not by eye: at 63px "Daily Royale"
 * spans 86.4% of the 390px column, matching the mockup's 86.8%. The vw term keeps it on one line
 * all the way down to 360. */
const headline: CSSProperties = {
  ...overArt,
  marginTop: 18,
  fontSize: "clamp(44px, 14.7vw, 63px)",
  // 0.96 makes the line box SHORTER than the face needs, which shears the descenders off the two
  // y's in "Daily Royale" (and the Q in "Royale Quotidien"). The tight leading is deliberate — it
  // keeps the two-line wrap stacked — so rather than loosening it, the box is extended below the
  // last line. In em so it tracks the clamp()ed font size at every viewport width.
  lineHeight: 0.96,
  paddingBottom: "0.18em",
  letterSpacing: "-0.018em",
  color: "var(--text)",
  whiteSpace: "pre-line",
};

/* The hero takes every pixel the fixed blocks leave. It bleeds through the shell's gutters so the
 * composition spans the full column edge to edge. */
/* The crown's box, and the halo follows it at 1.795x.
 *
 * WIDTH-led, because the halo is what runs out of room first: 46vw puts the ring at 83% of the
 * viewport — "most of the usable width" without either edge being lost. The `min(…, 24vh)` only
 * bites on short screens, where the column has to hold the whole composition in 667px.
 *
 * (This used to be solved against the headline via a flex-band centre. It no longer needs to be:
 * the hero is content-sized now, so the clearance is a margin we set directly — see `heroStage`.) */
const HERO_CROWN = "clamp(132px, min(46vw, 24vh), 205px)";

/* The hero band. `flex: 1 1 auto` so it absorbs whatever the fixed-height column has left after the
 * kicker, headline, pills, card and CTA have taken theirs — the crown sits in the slack rather than
 * dictating the layout. Nothing is clipped here: the stage's halo and glow are absolutely
 * positioned and deliberately overflow this box in every direction. */
const heroStage: CSSProperties = {
  ...overArt,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  // NOT `flex: 1 1 auto` any more. Greedy, it swallowed the column's slack and pushed the subtitle
  // 88-102px below the crown and the CTA down to 72% of the screen — the eye had to travel past a
  // lot of nothing to reach the button. The slack now sits BELOW the action instead, and this band
  // is exactly as tall as the crown.
  //
  // The margin is the halo's clearance, derived rather than guessed: the ring's top sits
  // 0.3325 crowns above the crown's box (halo box = 1.795x the crown, seated 0.065 low), so this
  // leaves a constant 14px between the headline and the ring at every viewport.
  marginTop: `calc(${HERO_CROWN} * 0.3325 + 14px)`,
};

/* The single line of copy. Restrained on purpose — it is a caption for the crown, not a pitch, and
 * it has to lose to the button standing under it. */
const subtitle: CSSProperties = {
  ...overArt,
  margin: "clamp(14px, 2.4vh, 22px) auto 0",
  maxWidth: 300,
  textAlign: "center",
  color: "var(--muted)",
  fontWeight: 500,
  fontSize: "clamp(14px, 3.7vw, 15.5px)",
  lineHeight: 1.45,
};

/* The reassurance under the button. Deliberately NOT a pill: a pill is a component, and a component
 * is another object to read. This is a footnote — icon, one line, muted, no container. */
const reassure: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  // 4.5, not 6: the bolt has to belong to the sentence. At 6 it read as an icon placed beside a
  // line of text rather than as one unit.
  gap: 4.5,
  // 8 here + ctaWrap's 10 = 18px box gap. Measured 22 before and it read as ~25, because the icon
  // sets the line box and leaves ~3.5px of leading above the ink.
  marginTop: 8,
  color: "var(--muted)",
  fontSize: 12.5,
  fontWeight: 600,
  letterSpacing: "0.01em",
};

const ctaWrap: CSSProperties = {
  ...overArt,
  marginTop: 24,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

function cta(busy: boolean): CSSProperties {
  return {
    width: "100%",
    height: 62,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,.10)",
    background: "var(--cta)",
    color: "var(--ctaText)",
    fontSize: 15.5,
    fontWeight: 700,
    letterSpacing: "0.2em",
    textIndent: "0.2em",
    textTransform: "uppercase",
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.75 : 1,
    // Both needed by the idle sweep: `relative` to anchor it, `hidden` to clip it to the pill.
    position: "relative",
    overflow: "hidden",
    // Tactile, not glossy: one tucked directional shadow for lift, a close contact shadow to seat
    // it, and a single fine specular edge. No highlight sweep.
    // Three tiers, which is what reads as weight rather than as a blurry halo: a wide ambient cast
    // for lift off the page, a mid shadow for the body, and a tight dark contact line directly under
    // the pill so it looks pressed onto the surface instead of floating above it.
    // Trimmed ~18% on offset, blur and alpha. The three tiers still read as weight rather than a
    // blurry halo, but the cast no longer reaches so far down the page — a tighter shadow under a
    // strong pill reads as more expensive, not less.
    boxShadow:
      "0 21px 40px -14px rgba(92,54,172,.43), 0 8px 17px -6px rgba(92,54,172,.30)," +
      " 0 2px 4px -1px rgba(52,28,104,.26), inset 0 1px 0 rgba(255,255,255,.22)",
    // No `transition` here at all: .rr-grow owns transform/box-shadow/opacity together, because an
    // inline transition shorthand REPLACES the class's rather than merging, which would drop the
    // transform tween and make the hover grow snap (see global.css).
  };
}

/* The idle sweep. A skewed band of white at low alpha, crossing the pill once every four seconds
 * (see `.rr-cta-shine`). Not a glow and not a pulse — the button is completely still for three of
 * those four seconds, which is what keeps it feeling expensive rather than needy. */
const ctaShine: CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  left: 0,
  width: "45%",
  pointerEvents: "none",
  background:
    "linear-gradient(100deg, transparent, rgba(255,255,255,.30) 45%, rgba(255,255,255,.42) 55%, transparent)",
};

const errorText: CSSProperties = {
  fontSize: 13,
  color: "var(--pink)",
  fontWeight: 700,
};

/* Clearly secondary and clearly detached — it reads as a separate choice, not the button's tail. */
const returningRow: CSSProperties = {
  ...overArt,
  marginTop: 48,
  paddingBottom: 2,
};
