import { type CSSProperties, useState } from "react";
import {
  AUTH_BUTTON_FONT,
  AUTH_BUTTON_HEIGHT,
  AUTH_BUTTON_RADIUS,
  SocialButton,
} from "@/ui/SocialButton";
import { GoogleSignInButton } from "@/ui/GoogleSignInButton";
import { EmailAuthForm } from "@/screens/EmailAuthForm";
import { CrownStage } from "@/ui/royal/CrownStage";
import { PageOrnament } from "@/ui/royal/PageOrnament";
import { Display } from "@/ui/Display";
import { MailIcon } from "@/ui/icons";
import { useThemeArt } from "@/theme/useArtStyle";
import { useT } from "@/i18n/useT";
import { useSocialSignIn } from "@/lib/useSocialSignIn";

/**
 * STEP 1 of the sign-in flow — the front door for a returning player, reached from the Daily Royale
 * intro's "Already playing? Log in".
 *
 * It is a CHOICE screen and nothing else: crown, wordmark, tagline, then Apple / Google / Email as
 * three buttons of equal weight. The email form used to sit underneath the provider buttons on this
 * same screen, which made email look like the default and the providers like a fallback; it now
 * lives one tap away in `EmailAuthForm`. The auth logic did not move — Apple and Google still run
 * the handlers below, email still runs `login` / `registerAndLogin`.
 *
 * WHAT THIS SCREEN OWNS: the provider list, the Apple and Google handlers, and the step. The email
 * form owns its own fields and submit. Nothing about the Daily Royale intro (BrainBoostIntro)
 * changed — it still calls `onLogin` and lands here.
 *
 * The ornament — a halo behind the crown, two contour sweeps off opposite corners, and the light
 * that ties them together — is entirely in the style block below. See the layer table there.
 */
export function AuthScreen({
  onBack,
  initialStep = "choose",
}: {
  onBack?: () => void;
  /**
   * Which step to open on. The front door's compact "Email" tile routes straight here with
   * `"email"`, so a returning player who has already chosen their provider does not land on a
   * choice screen and have to choose again.
   */
  initialStep?: "choose" | "email";
} = {}) {
  const t = useT();
  const art = useThemeArt();
  const [step, setStep] = useState<"choose" | "email">(initialStep);

  // Providers and both handlers come from the shared hook — the Daily Royale front door offers the
  // same three routes in a compact row, and one copy of this logic is the only way those two cannot
  // drift. See `lib/useSocialSignIn`.
  const {
    resolved,
    showApple,
    showGoogle,
    appleClientId,
    appleRedirectUri,
    googleClientId,
    socialBusy,
    error,
    notice,
    onApple,
    onGoogleCredential,
    dropGoogle,
  } = useSocialSignIn(t);

  // The email step is DERIVED, not just a click target, so the screen degrades on its own. A
  // deployment with no providers configured, an offline visitor whose `/auth/providers` call
  // failed, and a player whose ad blocker kills Google's script all end up on the email form
  // without a dead "choose how to sign in" screen offering nothing to choose. Because it is
  // derived, GIS failing AFTER the choice screen has painted (which is when it fails — the script
  // load is what gets blocked) drops through too.
  const anySocial = showApple || showGoogle;
  const showEmailStep = step === "email" || (resolved && !anySocial);

  if (showEmailStep) {
    // Back goes one step, not all the way out — but only if there IS a step behind this one. Two
    // cases where there is not, and both must exit the screen entirely: no provider is usable, so
    // the choice screen was never rendered; and the visitor arrived straight here from the front
    // door's Email tile (`initialStep === "email"`), where they already made the choice and have
    // never seen this screen's version of it. Sending them "back" to a choice they did not make
    // reads as the app losing its place.
    const hasStepBehind = anySocial && initialStep === "choose";
    return <EmailAuthForm onBack={hasStepBehind ? () => setStep("choose") : onBack} />;
  }

  return (
    <main style={shell}>
      {/* Ambient light, film grain and the two corner contour sweeps — shared verbatim with the
          Daily Royale front door so the two screens cannot drift apart. All viewport-fixed,
          `aria-hidden`, `pointer-events: none`. */}
      <PageOrnament />

      {/* Top navigation rail. Back sits opposite the app's floating language chip (i18n/
          LanguageSelector, `variant="floating"`) and copies its geometry exactly — fixed, the same
          `safe-area-inset-top + 10px`, the same 36px height, the same 12px inset from its edge, the
          same z-index — so the two read as one row rather than two unrelated affordances. Fixed,
          not absolute: the chip is positioned against the VIEWPORT, and an absolute Back inside
          this 400px-wide column would drift away from it on anything wider. Deliberately bare
          where the chip is a filled pill; this is the way out of a screen, not a control on it. */}
      {onBack && (
        <button type="button" onClick={onBack} style={backNav}>
          <span aria-hidden style={{ fontSize: 15, lineHeight: 1, marginTop: -1 }}>
            ‹
          </span>
          {t.common.back}
        </button>
      )}

      {/* ONE composition — crown through buttons — offset from the top as a single block rather
          than a header and a stack pushed apart by a spacer. See COMPOSITION_TOP for the offset. */}
      <div style={composition}>
        <header style={{ position: "relative", textAlign: "center" }}>
          {/* Atmosphere, not decoration: a wide lavender bloom centred on the crown with a smaller,
              warmer gold core inside it, blurred past the point of having an edge and sitting at a
              low enough alpha to die out well before the wordmark. It exists so the crown is lit by
              the page instead of pasted onto it — which is also why the crown's own drop-shadow is
              gone (a shadow says "object above surface"; this says "part of the room"). */}
          {/* Crown, halo, light field and grounding — one primitive, every dimension derived
              from the crown's box, so the whole stage rescales together. See `ui/royal/CrownStage`. */}
          {art && <CrownStage size={CROWN_SIZE} src={art.crownBare} />}

          <Display as="h1" style={wordmark}>
            Rot Royale
          </Display>

          <p style={tagline}>{t.auth.tagline}</p>

          {/* The one piece of ornament on the screen: a hairline that fades out at both ends with a
              single small gold lozenge at its centre. It closes the branding and opens the buttons,
              which is why it is barely there — anything heavier turns a quiet page into a decorated
              one, and anything more separated turns one composition back into two. */}
          <div style={rule} aria-hidden>
            <span style={ruleLine("right")} />
            <span style={gem} />
            <span style={ruleLine("left")} />
          </div>
        </header>

        <div style={stack}>
          {showApple && appleClientId && (
            <SocialButton
              provider="apple"
              label={t.auth.continueWithApple}
              busy={socialBusy === "apple"}
              disabled={socialBusy !== null && socialBusy !== "apple"}
              onClick={() => void onApple(appleClientId, appleRedirectUri)}
            />
          )}

          {/* Google supplies its own button (see ui/GoogleSignInButton): a custom one can only
              reach an ID token through One Tap, which Google suppresses for a real share of
              players. It is scaled to the stack's height there so the three read as one set. */}
          {showGoogle && googleClientId && (
            <GoogleSignInButton
              clientId={googleClientId}
              onCredential={(idToken) => void onGoogleCredential(idToken)}
              onUnavailable={dropGoogle}
            />
          )}

          <button
            type="button"
            onClick={() => setStep("email")}
            disabled={socialBusy !== null}
            style={emailButton(socialBusy !== null)}
            onPointerDown={(e) => {
              if (socialBusy === null) e.currentTarget.style.transform = "scale(0.985)";
            }}
            onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            <span style={{ display: "flex", alignItems: "center" }} aria-hidden>
              <MailIcon size={20} />
            </span>
            <span>{t.auth.continueWithEmail}</span>
            {/* Sits on the right edge rather than in the centred group, so the label of all three
                buttons stays optically centred as a set. */}
            <span style={chevron} aria-hidden>
              <ChevronRightGlyph size={16} />
            </span>
          </button>
        </div>

        {error && (
          <div role="alert" style={message("var(--pink)")}>
            {error}
          </div>
        )}

        {/* Not an error: the account was linked and its old password no longer applies. `status`
            rather than `alert` — it is information, and an assertive announcement would talk over
            the sign-in that just succeeded. */}
        {notice && (
          <div role="status" style={message("var(--muted)")}>
            {notice}
          </div>
        )}
      </div>
    </main>
  );
}

/** The email button's trailing mark. Local, like the Daily Royale intro's glyphs — one path. */
function ChevronRightGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ display: "block" }}>
      <path
        d="M9 5 L16 12 L9 19"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Quiet luxury: the app's ivory `--bg` untouched, one serif wordmark, one hairline of gold, and
 * three buttons. No card, no panel, no container of its own — the buttons are the only filled
 * shapes on the page, which is what makes three of them read as a set rather than as a list.
 * Every colour is a theme token except the provider colourways (see ui/SocialButton).
 *
 * SIX LAYERS, and nothing crosses between them:
 *
 *   0  `--bg`                the ivory room, untouched — this screen adds light, never repaints
 *   0  `atmosphere`          four radial washes; the transitions between everything above
 *   0  `grain`               1.5% noise, dithering those washes so they cannot band
 *   0  contourTopLeft/BR     the ornamental frame, fixed to the viewport corners
 *   0  `aura` + `halo`       inside the header, behind the crown
 *   1  `composition`         crown → wordmark → tagline → rule → buttons
 *  50  the top rail          Back, and the app's language chip
 *
 * Everything at z 0 is `aria-hidden` AND `pointer-events: none`. That pairing is the contract:
 * decoration must be invisible to assistive tech and to hit-testing alike, or a full-bleed
 * ornament silently eats a tap on the button underneath it.
 *
 * THE LAYOUT IS ONE BLOCK, NOT TWO. Crown → wordmark → tagline → rule → buttons live in a single
 * `composition` div offset from the top; there is no flex spacer between the branding and the
 * stack, because a spacer is exactly what made them read as separate sections. The whole block is
 * placed by ONE number, and everything below it is the ornament's, not empty.
 * ─────────────────────────────────────────────────────────────────────────────────────────────── */

/* ── Ornament ───────────────────────────────────────────────────────────────────────────────────
 *
 * VECTORS, not bitmaps — see `auth/LoginOrnaments.tsx` for why (short version: the comp's lines are
 * hairlines, and a hairline survives neither a downscale nor a browser upscale, so the PNGs read as
 * soft bands no matter how they were tuned). The paths are traced out of the same two glow-on-black
 * renders by `scripts/trace_login_ornaments.py` and live in the generated `auth/ornamentPaths.ts`.
 *
 * NOT part of `ThemeArt` either way. This screen is pre-auth, so it only ever renders on the
 * default Starter palette — putting the ornament in the art set would oblige all eleven themes to
 * define one none of them can ever show. It is page furniture, like the grain. */
/* ── Sizes, measured off the reference comp ─────────────────────────────────────────────────────
 *
 * The reference comp (named in CLAUDE.md §8a; not here, because a source filename discloses the
 * artwork's provenance and this file is published) is 853×1844 — an 0.4626 aspect, i.e. a 390×844 phone
 * at 2.19×. Everything below is that image's pixels divided by the scale, not a guess, and the
 * fractions are what carry across viewport sizes:
 *
 *   crown        x 275–574 (35.2% of width), y 460–775 (24.9%–42.0% of height)
 *   wordmark     x 138–727 (69.2% of width), cap-top→descender y 818–935
 *   tagline      y 940–1000            divider  y 1052–1075, 231px wide (27.1%)
 *   Apple        y 1134–1252, x 73–778 (82.8% of width, so a 33px gutter at 390)
 *   Google       y 1293–1409           Email    y 1447–1568  → last button bottom at 85.0%
 *   halo ring    centre (419, 623) — the CROWN's centre — diameter 676 (79.2% of width)
 *
 * The two big corrections this made to the first pass: the crown was **half the size it should be**
 * (92px against a measured 174), and the block stopped at 65% of the viewport where the comp runs
 * to 85%. Everything else followed from those.
 *
 * The crown's box is a named constant because the halo is sized and centred FROM it — see `halo`. */
const CROWN_SIZE = "clamp(126px, 20.6vh, 190px)";


/* Where the composition starts.
 *
 * Derived from a target rather than picked: the third button's BOTTOM edge should land at **85%**
 * of the viewport, which is where the comp puts it. Summing the block from the clamps below gives
 * 483px at 375×667, 537px at 390×844 and 564px at 430×932, so the offsets hitting 0.85h are
 * 84 / 181 / 229px. Those three points are linear in viewport height to within a pixel — slope
 * 0.5445, intercept −279 — which is where `54.4vh − 279px` comes from. Re-derive it if any gap in
 * the block changes; it is a fit to them, not an independent number.
 *
 * (The first pass targeted 64% and left the bottom third dead. 85% is the comp, and it is also
 * what stops the ornament from being the only thing in the lower half of the screen.)
 *
 * The lower bound is not a fudge: it is the top rail's floor. The language chip runs from
 * `safe-area-inset-top + 10px` to +46px, so `inset + 56px` is the first pixel that clears it with
 * a little air. It binds only below ~620px tall, so a notch never pushes the composition down on
 * the phones that have one. Upper bound stops a tablet or a desktop window from stranding it. */
const COMPOSITION_TOP =
  "clamp(calc(env(safe-area-inset-top, 0px) + 56px), calc(54.4vh - 279px), 300px)";

const shell: CSSProperties = {
  position: "relative",
  minHeight: "100dvh",
  maxWidth: 400,
  margin: "0 auto",
  // Flex ONLY to establish a formatting context, not to lay anything out. With top padding at 0,
  // the composition's `margin-top` would otherwise collapse THROUGH this element: the offset still
  // looks right, but it moves `<main>` itself down instead of the block inside it, and the page
  // ends up 100dvh + the offset tall and scrolls on a screen that visibly has room to spare.
  // Flex items don't collapse margins, so the offset stays inside the box.
  display: "flex",
  flexDirection: "column",
  // No top padding — the composition owns its own offset (COMPOSITION_TOP). The bottom padding is
  // only a floor for the case where a very short viewport makes the block scroll.
  //
  // The side gutter is measured, not chosen: the comp's buttons are 82.8% of the viewport wide, so
  // the gutter is 8.6% of it — 33px at 390, 37px at 430. It replaces a flat 24, which made the
  // buttons read wider and flatter than the comp's.
  padding: "0 clamp(24px, 8.5vw, 38px) calc(env(safe-area-inset-bottom) + 24px)",
};

/* Mirrors the language chip on the other side of the same rail — see the JSX for why it is fixed
 * rather than absolute. Bare text, `--muted`: understated by design. */
const backNav: CSSProperties = {
  position: "fixed",
  top: "calc(env(safe-area-inset-top, 0px) + 10px)",
  left: 12,
  zIndex: 50,
  height: 36,
  padding: "0 10px",
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  background: "none",
  border: "none",
  borderRadius: 999,
  color: "var(--muted)",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

const composition: CSSProperties = {
  position: "relative",
  zIndex: 1, // above the atmosphere layers, below the fixed top rail (z 50)
  marginTop: COMPOSITION_TOP,
};

/* Everything that paints the ornament — ambient light, grain, the corner contours, the halo, the
 * crown's light field and its grounding — moved to `ui/royal/PageOrnament` and `ui/royal/CrownStage`
 * when the Daily Royale front door adopted the same treatment. The reasoning behind every value
 * lives there. What stays here is only this screen's own composition: where the block sits, and the
 * type, divider and buttons inside it. */


const wordmark: CSSProperties = {
  position: "relative",
  zIndex: 1,
  marginTop: "clamp(12px, 2.4vh, 22px)",
  // Measured: the comp's "Rot Royale" is 69.2% of the viewport wide, which back-solves to ~58px at
  // 390 — a third bigger than the 46px it was. It is now the same size as the intro's "Daily
  // Royale" rather than a step below it, and that is right: with the crown at full size these two
  // are one lockup, and a wordmark that reads smaller than the mark above it breaks the pair.
  fontSize: "clamp(46px, 14.9vw, 62px)",
  lineHeight: 1.02,
  letterSpacing: "-0.02em",
  color: "var(--text)",
};

const tagline: CSSProperties = {
  position: "relative",
  zIndex: 1,
  margin: "12px auto 0",
  // 320, not 300: the comp keeps the tagline on one line and the gutter grew to 33px, so the cap
  // has to clear the string's natural 286px at every supported width.
  maxWidth: 320,
  color: "var(--muted)",
  fontWeight: 500,
  // 14, measured: the comp's tagline runs ascender 970 to descender 1000 at 1844, i.e. ~30px of
  // ink, which back-solves to a 14px face at 844.
  fontSize: 14,
  lineHeight: 1.45,
};

const rule: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  // Height-aware on both sides so the block compresses on a short phone instead of overflowing:
  // the rule pulls up toward the tagline and the buttons pull up toward the rule.
  // Both measured off the comp, from the rule's CENTRE (its box is only as tall as the lozenge):
  // tagline descender → rule centre is 28px at 844, rule centre → Apple top is 32px.
  marginTop: "clamp(16px, 2.6vh, 24px)",
  marginBottom: "clamp(20px, 3.4vh, 32px)",
};

function ruleLine(fadeTo: "left" | "right"): CSSProperties {
  const stops =
    fadeTo === "right"
      ? "transparent, color-mix(in srgb, var(--amber) 50%, transparent)"
      : "color-mix(in srgb, var(--amber) 50%, transparent), transparent";
  // 40px arms + 12px gaps + the 5px lozenge = 109, against the comp's measured 106 at 390.
  return { width: 40, height: 1, background: `linear-gradient(90deg, ${stops})` };
}

const gem: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: 1,
  transform: "rotate(45deg)",
  background: "var(--amber)",
  opacity: 0.6,
};

const stack: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "flex",
  flexDirection: "column",
  // The comp's two inter-button gaps measure 41px and 38px at 1844, i.e. ~18 at 844. It was 13,
  // which packed the three into a slab; 18 lets them read as three choices.
  gap: 18,
};

/** The third choice, in the app's own colours rather than a provider's: the palest wash of `--brand`
 *  over the panel, a hairline of the same purple, and the wordmark's navy-purple ink. It shares the
 *  height, width, radius and type scale of the two above it — only the skin differs. */
function emailButton(off: boolean): CSSProperties {
  return {
    width: "100%",
    height: AUTH_BUTTON_HEIGHT,
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: AUTH_BUTTON_RADIUS,
    border: "1px solid color-mix(in srgb, var(--brand) 20%, transparent)",
    background: "color-mix(in srgb, var(--brand) 7%, var(--panel))",
    color: "var(--brand)",
    fontFamily: "inherit",
    fontSize: AUTH_BUTTON_FONT,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    cursor: off ? "default" : "pointer",
    opacity: off ? 0.6 : 1,
    transition: "opacity 140ms, transform 90ms",
    WebkitTapHighlightColor: "transparent",
  };
}

const chevron: CSSProperties = {
  position: "absolute",
  right: 20,
  display: "flex",
  color: "color-mix(in srgb, var(--brand) 55%, transparent)",
};

function message(color: string): CSSProperties {
  return {
    marginTop: 14,
    textAlign: "center",
    color,
    fontSize: 13.5,
    fontWeight: 600,
    lineHeight: 1.4,
  };
}
