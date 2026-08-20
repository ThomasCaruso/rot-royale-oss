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

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n/useT";
import { trackFunnel, trackFunnelOnce } from "@/lib/analytics";
import { useThemeArt } from "@/theme/useArtStyle";
import { Display } from "@/ui/Display";
import { FitText } from "@/ui/FitText";
import { ClockIcon, SparkIcon, UsersIcon } from "@/ui/icons";

export function BrainBoostIntro({
  onStart,
  onLogin,
}: {
  onStart: () => Promise<void>;
  onLogin: () => void;
}) {
  const t = useT();
  const art = useThemeArt();
  const fx = useMemo(() => compositeLayers(art), [art]);
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
  const pills: { icon: ReactNode; label: string }[] = [
    { icon: <ClockIcon size={15} />, label: t.brainBoost.introChip1 },
    { icon: <CheckGlyph size={15} />, label: t.brainBoost.introChip2 },
    { icon: <SparkIcon size={14} />, label: t.brainBoost.introChip3 },
  ];

  // What one run pays back — score, placement, and the field comparison.
  const earns: { icon: ReactNode; label: string; sub: string }[] = [
    { icon: <BarsGlyph size={18} />, label: t.brainBoost.earnScore, sub: t.brainBoost.earnScoreSub },
    { icon: <CrownGlyph size={19} />, label: t.brainBoost.earnRank, sub: t.brainBoost.earnRankSub },
    { icon: <UsersIcon size={19} />, label: t.brainBoost.earnCompare, sub: t.brainBoost.earnCompareSub },
  ];

  return (
    <main style={shell}>
      {/* Backdrop art — anchored to the PAGE, starting flush at the top edge and sized to cover the
          viewport whatever its shape. Because both the art's ring and the hero's centre track the
          page height, the halo still lands around the crown without being pinned to it. */}
      {art && <img src={art.background} alt="" style={pageArt} draggable={false} aria-hidden />}

      {/* Shared grain. The single most effective unifier: one identical noise field laid over both
          the painted plate and the rendered podium makes them look photographed together, because
          real images carry one grain structure, not two. Masked with the same ramp as the art so it
          dies before the card — grain over white UI reads as dirt, not film. */}
      <span style={grain} aria-hidden />

      {/* One line, always — the fixed 100dvh layout budgets this kicker at a single line; a longer
          localized kicker shrinks to fit the column rather than wrapping and stealing crown space. */}
      <FitText as="div" size={13} min={0.66} style={kicker}>
        {t.brainBoost.introKicker}
      </FitText>

      <Display as="h1" style={headline}>
        {t.brainBoost.introHeadline}
      </Display>

      {/* Decorative hero — the Starter crown standing on its marble-and-gold podium, inside the
          backdrop art's halo ring. The backdrop is a child of the stage so the ring stays concentric
          with the crown at every viewport; it bleeds out to dress the whole page and the shell clips
          it. Purely presentational (no motion), so reduced-motion has nothing to strip. */}
      {art && (
        <div style={heroStage} aria-hidden>
          {/* Cast shadow into the mist — outside the podium box so it isn't clipped by the podium's
              own silhouette. This is what gives the plate a floor to stand on. */}
          <span style={groundShadow} />

          <div style={podiumBox}>
            <img src={art.podium} alt="" style={heroPodium} draggable={false} />

            {/* ── Compositing stack on the podium. Each layer is clipped to the podium's own alpha
                   so it grades the marble and nothing else (see `podiumMasked`). Order matters:
                   occlusion darkens, then the environment lights, then the grade unifies hue. ── */}
            <span style={fx.occlusion} />
            <span style={fx.env} />
            <span style={fx.grade} />
            <span style={fx.haze} />

            {/* Grounding, in the order a real scene builds it: the soft cast the body throws, the
                crown's own reflection in the polished marble, then the tight dark occlusion right at
                the contact line. Together they are what make it SIT rather than hover. */}
            <span style={crownBleed} />
            <span style={crownCast} />
            <img src={art.crownBare} alt="" style={crownReflection} draggable={false} />
            <span style={crownContact} />
            <img src={art.crownBare} alt="" style={heroCrown} draggable={false} />
            <span style={fx.crownEnv} />
            <span style={fx.crownGrade} />
            <span style={fx.crownShade} />
          </div>
        </div>
      )}

      <div style={pillRow}>
        {pills.map((p) => (
          <span key={p.label} style={pill}>
            <span style={pillIcon}>{p.icon}</span>
            {p.label}
          </span>
        ))}
      </div>

      <section style={card} aria-label={t.brainBoost.unlockTitle}>
        <div style={cardHeadRow}>
          <span style={cardRule} />
          <span style={cardHeader}>{t.brainBoost.unlockTitle}</span>
          <span style={cardRule} />
        </div>
        <div style={earnGrid}>
          {earns.map((e, i) => (
            <div key={e.label} style={earnCol(i > 0)}>
              <span style={earnBadge}>{e.icon}</span>
              <span style={earnLabel}>{e.label}</span>
              <FitText as="span" size="clamp(10px, 2.88vw, 11.5px)" min={0.7} style={earnSub}>
                {e.sub}
              </FitText>
            </div>
          ))}
        </div>
      </section>

      <div style={ctaWrap}>
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy}
          onPointerDown={(e) => !busy && (e.currentTarget.style.transform = "translateY(1px)")}
          onPointerUp={(e) => (e.currentTarget.style.transform = "translateY(0)")}
          onPointerLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
          style={cta(busy)}
        >
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
      </div>

      <button type="button" onClick={onLogin} style={loginLink}>
        {t.brainBoost.haveAccount}
      </button>
    </main>
  );
}

/* ── Local glyphs (currentColor, aria-hidden) — a few small marks the shared icon set doesn't
 *    carry yet. Kept local to this screen; they inherit the row/pill text color like the rest. ── */

function CheckGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ display: "block" }}>
      <path
        d="M5 12.5 L10 17.5 L19 7"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrownGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ display: "block" }}>
      <path
        d="M3.6 8.4 L7.6 11.6 L12 5.6 L16.4 11.6 L20.4 8.4 L18.6 18 H5.4 Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Ascending bar chart — the "your score" mark. */
function BarsGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ display: "block" }}>
      <rect x="3" y="14" width="5" height="7" rx="1.4" fill="currentColor" />
      <rect x="9.5" y="9" width="5" height="12" rx="1.4" fill="currentColor" />
      <rect x="16" y="3" width="5" height="18" rx="1.4" fill="currentColor" />
    </svg>
  );
}

/* ── Compositing ────────────────────────────────────────────────────────────────────────────────
 *
 * The podium and crown are 3D renders; the backdrop is a painted plate. Dropped together they read
 * as an asset pasted on a picture, because the two disagree about where the light is, how warm it
 * is, and how far away things are. These layers are the standard fixes a compositor reaches for,
 * done in CSS: each one is clipped to its subject's OWN alpha (the PNGs are the masks), so it
 * grades the marble or the gold and never spills onto the page.
 *
 *   occlusion  Ambient occlusion. Light doesn't reach creases and undersides — without this the
 *              plate looks lit from everywhere and therefore from nowhere. Multiply, biased low.
 *   env        Environment bounce. The plate's own light field, sampled as gradients: the warm
 *              core sits above and behind the crown, so it keys the podium's top; the lavender
 *              cloud banks flank it, so they bounce cool violet onto the left and right edges.
 *              Screen, because bounce light adds, never darkens.
 *   grade      Colour grade. The marble renders neutral grey-white; the plate is warm cream. A
 *              soft-light wash pulls the podium's whites toward the plate's white point, which is
 *              what stops it reading as a cut-out.
 *   haze       Atmospheric perspective. Contrast falls off with distance, so the disc's outer
 *              edges — the parts running away toward the frame — lift toward the background value
 *              and lose their hard rim.
 *
 * The crown gets a lighter touch (env only): polished gold already carries the scene's colour, and
 * grading it any further just makes it muddy.
 *
 * IMPLEMENTATION NOTE — one mask per layer, never two. The podium's base fade is baked into the
 * PNG's ALPHA CHANNEL rather than composed as a second CSS mask. Intersecting two masks needs
 * `mask-composite`, and when that doesn't hold the masks fall back to a union: every layer then
 * paints its full rectangle, and the podium wears a faint box. Baking the fade into the asset makes
 * the podium's alpha the single source of truth for "where the podium is", so a single
 * `mask-image: url(podium.png)` is exact and there is no compositing mode left to get wrong. */

/** Clip a layer to a PNG's own alpha. ONE mask, deliberately — see the note above about why the
 *  podium's fade lives in the asset rather than in a second mask layer. */
function clippedTo(src: string): CSSProperties {
  return {
    pointerEvents: "none",
    WebkitMaskImage: `url(${src})`,
    maskImage: `url(${src})`,
    WebkitMaskSize: "100% 100%",
    maskSize: "100% 100%",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
  };
}

function compositeLayers(art: { podium: string; crownBare: string } | null) {
  const onPodium: CSSProperties = {
    position: "absolute",
    inset: 0,
    transform: PODIUM_STRETCH,
    transformOrigin: "50% 100%",
    ...clippedTo(art?.podium ?? ""),
  };
  // Every crown grade layer must mirror the crown's geometry AND its tilt exactly — a mask that
  // doesn't share the transform slides off the artwork it is supposed to be clipping.
  const onCrown: CSSProperties = {
    position: "absolute",
    bottom: "49%",
    left: "50%",
    transform: "translateX(-50%) perspective(1100px) rotateX(-5deg)",
    transformOrigin: "50% 100%",
    width: "95%",
    height: "288%",
    ...clippedTo(art?.crownBare ?? ""),
  };
  return {
    occlusion: {
      ...onPodium,
      mixBlendMode: "multiply",
      background:
        // Under-plate darkening, plus a soft gather at each outer edge where the disc turns away.
        "radial-gradient(120% 150% at 50% 118%, rgba(96,74,138,.42), rgba(96,74,138,.12) 46%, transparent 68%)," +
        "radial-gradient(38% 120% at 0% 62%, rgba(96,74,138,.26), transparent 70%)," +
        "radial-gradient(38% 120% at 100% 60%, rgba(96,74,138,.24), transparent 70%)",
    } as CSSProperties,
    env: {
      ...onPodium,
      mixBlendMode: "screen",
      background:
        // Warm key spilling down from the halo core, then the two lavender cloud banks either side.
        "radial-gradient(130% 95% at 50% -14%, rgba(255,232,196,.62), rgba(255,232,196,.16) 46%, transparent 68%)," +
        "radial-gradient(64% 130% at -2% 56%, rgba(176,146,238,.46), transparent 62%)," +
        "radial-gradient(64% 130% at 102% 52%, rgba(176,146,238,.40), transparent 62%)",
    } as CSSProperties,
    grade: {
      ...onPodium,
      mixBlendMode: "soft-light",
      background:
        // Top face first — it renders near-neutral white and is the last thing still reading as a
        // 3D asset against a warm plate; the rest walks down into the plate's violet shadow tone.
        "linear-gradient(180deg, rgba(255,222,182,.85) 0%, rgba(255,228,196,.62) 26%," +
        " rgba(246,231,223,.36) 52%, rgba(150,120,205,.34) 100%)",
    } as CSSProperties,
    haze: {
      ...onPodium,
      mixBlendMode: "normal",
      opacity: 0.5,
      background:
        "linear-gradient(90deg, #F6E7DF 0%, rgba(246,231,223,.42) 9%, transparent 26%," +
        " transparent 74%, rgba(246,231,223,.42) 91%, #F6E7DF 100%)",
    } as CSSProperties,
    // ── The crown gets the SAME treatment as the podium. Until now it had one screen layer while
    //    the podium had four, so it stayed ungraded: higher contrast, more saturated, and lit as if
    //    nothing were beneath it. That asymmetry is what keeps reading as one asset on top of
    //    another. All three share the crown's exact geometry and tilt, or their masks slide off.
    crownEnv: {
      ...onCrown,
      mixBlendMode: "screen",
      opacity: 0.48,
      background:
        // THE missing cue, and the strongest one: BOUNCE. The crown stands on bright white marble
        // under diffuse light, so its lower half should be visibly lit from BELOW. A render lit
        // identically top and bottom is the signature of a cut-out — real objects are re-lit by
        // whatever they are standing on. Centred on the base and thrown upward.
        "radial-gradient(104% 27% at 50% 97%, rgba(255,250,232,.70), rgba(255,244,216,.22) 42%, transparent 70%)," +
        // Halo key from above, then the two lavender cloud banks flanking it.
        "radial-gradient(120% 70% at 50% 2%, rgba(255,236,205,.44), transparent 56%)," +
        "radial-gradient(58% 90% at -4% 62%, rgba(176,146,238,.40), transparent 62%)," +
        "radial-gradient(58% 90% at 104% 58%, rgba(176,146,238,.34), transparent 62%)",
    } as CSSProperties,
    crownGrade: {
      ...onCrown,
      mixBlendMode: "soft-light",
      background:
        // Same walk as the podium's grade — warm at the top, into the plate's violet shadow at the
        // bottom — so both objects resolve to one white point instead of two.
        "linear-gradient(180deg, rgba(255,226,190,.30) 0%, rgba(250,238,225,.14) 48%," +
        " rgba(150,120,205,.22) 100%)",
    } as CSSProperties,
    crownShade: {
      ...onCrown,
      mixBlendMode: "multiply",
      background:
        // Occlusion on the OBJECT side of the contact: the crown's own base darkens where the
        // marble crowds it, which is the half of contact shading that a shadow on the floor can't
        // provide. Plus a whisper of atmosphere on the outer edges, matching the podium's haze.
        "radial-gradient(78% 20% at 50% 99%, rgba(88,64,128,.40), transparent 66%)," +
        "linear-gradient(90deg, rgba(126,102,166,.20) 0%, transparent 15%," +
        " transparent 85%, rgba(126,102,166,.18) 100%)",
    } as CSSProperties,
  };
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

/* Where the art dissolves into flat cream. The stops are ANCHORED TO THE LAYOUT, not to the art's
 * own height: the blocks below the hero are a fixed 361px, so the pills always start at
 * `100dvh − 361px` and end 40px later, wherever the viewport height puts them. Each stop converts
 * that page position into a distance down the art by subtracting the art's own top
 * (`127px − 0.3485 × column`). The ramp therefore begins mid-podium and is fully cream by the
 * bottom of the pills on ANY viewport — on a short screen where the pills ride up, the fade rides
 * up with them. Four stops rather than two: a straight linear alpha ramp bands visibly here. */
const ART_TOP_OFFSET = "127px - 0.3485 * min(100vw, 430px)";
const artStop = (aboveBottom: number) =>
  `calc(100dvh - ${aboveBottom}px - (${ART_TOP_OFFSET}))`;
const ART_FADE =
  `linear-gradient(to bottom, #000 ${artStop(471)}, rgba(0,0,0,.60) ${artStop(411)},` +
  ` rgba(0,0,0,.20) ${artStop(355)}, transparent ${artStop(321)})`;

/* Fractal-noise grain, generated inline so it costs no request. `overlay` keeps mid-tones and only
 * disturbs the extremes, which is how film grain behaves; 5% is the point where it registers as
 * texture rather than noise. */
const GRAIN_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>` +
      `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='3' stitchTiles='stitch'/>` +
      `<feColorMatrix type='saturate' values='0'/></filter>` +
      `<rect width='180' height='180' filter='url(#n)'/></svg>`,
  );

const grain: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  pointerEvents: "none",
  opacity: 0.05,
  mixBlendMode: "overlay",
  backgroundImage: `url("${GRAIN_SVG}")`,
  backgroundRepeat: "repeat",
  backgroundSize: "180px 180px",
  WebkitMaskImage: ART_FADE,
  maskImage: ART_FADE,
};

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
const heroStage: CSSProperties = {
  position: "relative",
  flex: "1 1 auto",
  minHeight: 0,
  width: "calc(100% + 40px)",
  marginLeft: -20,
  marginTop: 2,
  marginBottom: 4,
};

/* The podium is the anchor everything else is measured from, and it takes the SMALLER of two
 * budgets: `height` spends the leftover vertical space (aspect-ratio turns it into a width) while
 * `maxWidth` caps it at the column. Whichever binds, the crown and the backdrop are percentages of
 * THIS box, so the staging scales as one composed illustration.
 *
 * The crown-plus-podium group stands 3.346 box-heights tall with its centre 67.3% of a box-height
 * above the box top, so `top: 50%` + `translateY(67.3%)` centres the GROUP — not the podium alone —
 * in the stage. A tall window then opens up evenly around the whole illustration instead of
 * stranding the halo low.
 *
 * At height 29.9% the group exactly fills the stage; 35% over-spends by ~17%, and the translate
 * carries ALL of that overflow downward — the podium's base is already faded and the pills paint
 * over it, whereas the crown's gem tip has the headline directly above and no room at all. 92% is
 * what pins the group's top to the stage top in the height-bound regime (a narrow phone, where the
 * overflow is largest); in the width-bound regime it merely sinks the faded base a further ~11px
 * behind the pills, which costs nothing. Anything less lets the gem cross the type at 360px.
 *
 * maxWidth 114% bleeds the podium past the column edges so it reads as a stage the screen crops
 * rather than an object sitting inside it — but no further: past ~120% the ellipse's near edge
 * falls outside the viewport, the curvature disappears, and the podium flattens into a grey band
 * running wall to wall. The bleed has to keep enough of the disc's arc to still read as a disc. */
const podiumBox: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, 98%)",
  height: "35%",
  aspectRatio: "660 / 195",
  maxWidth: "114%",
  // Confines every blend mode below to the podium+crown stack, so `multiply`/`screen` grade the
  // renders and never reach through to the page art or the cream.
  isolation: "isolate",
};

/* The shadow the plate casts into the mist it stands in. Wide, very soft and cool — a hard shadow
 * would fight the diffuse painted light. Deliberately offset a few percent below the disc so it
 * reads as floor contact rather than a drop shadow stuck to the object. */
const groundShadow: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, 205%)",
  width: "104%",
  height: "13%",
  borderRadius: "50%",
  background:
    "radial-gradient(closest-side, rgba(92,70,140,.30), rgba(92,70,140,.13) 52%, transparent 78%)",
  filter: "blur(11px)",
  pointerEvents: "none",
};

/* Backdrop art (720×1279 ⇒ 1.777 tall per unit width). Measured geometry of its crescent: centre
 * 50.2% / 40.4%, diameter 79.5% of the art's width, so the ring's TOP sits 0.3197 art-widths below
 * the art's top edge.
 *
 * Hung so that ring top lands on the headline's baseline — the crescent touches "Daily Royale".
 * Everything above the fixed hero is a constant height (26 pad + 16 kicker + 18 gap + 61 headline
 * ≈ 127px, independent of viewport height), so the anchor is a literal pixel offset:
 *     top = 127px − 0.3197 × width,  width = 1.09 × column
 * which also puts the ring concentric with the crown and framing it at ~1.3×.
 *
 * It deliberately does NOT cover the page. The art dissolves out across the podium's lower half and
 * is fully gone by the pills, leaving flat cream from there down — hence `--art-cream` on the shell,
 * sampled from the art's own lower band (#F6E7DF) so the dissolve has nothing to reveal but more of
 * the same colour. The three-stop ramp eases the falloff; a straight linear one bands visibly. */
const pageArt: CSSProperties = {
  position: "absolute",
  top: "calc(127px - 0.3197 * min(100vw, 430px) * 1.09)",
  left: "50%",
  transform: "translateX(-50%)",
  width: "calc(1.09 * min(100vw, 430px))",
  height: "auto",
  maxWidth: "none",
  zIndex: 0,
  pointerEvents: "none",
  WebkitMaskImage: ART_FADE,
  maskImage: ART_FADE,
};

/* The podium is stretched BEYOND the art's own 660:195 aspect — wider by 14%, taller by only 6%.
 * That asymmetry is the point, and it can't come from the box: the box is aspect-locked, so growing
 * it would scale width and height together AND drag the crown up with it, the crown being a
 * percentage of the box. Stretching the render instead leaves the box as a pure layout anchor.
 *
 * The same transform goes on every masked grade layer so their masks stay registered with it.
 * transform-origin at the base means the extra width spreads sideways off-screen while the floor
 * line stays put; only the 6% of height lifts the top face, which the crown's seating figure and
 * the contact shadow below are both offset to match. */
const PODIUM_STRETCH = "scaleX(1.14) scaleY(1.06)";

/* Fills the podium box exactly — the box IS the podium. The base dissolves into the backdrop's
 * cloud bank the way the mockup's does, which both softens the cut-out's bottom edge and lets the
 * composition sit lower in its box than a hard-edged disc could. */
const heroPodium: CSSProperties = {
  position: "relative",
  display: "block",
  width: "100%",
  height: "100%",
  transform: PODIUM_STRETCH,
  transformOrigin: "50% 100%",
  filter: "drop-shadow(0 12px 22px rgba(84,64,120,.15))",
};

/* Crown, floated 53.7% of the podium's height above its base — which lands the opaque crown (it
 * ends 90.6% down its own box) on the top face.
 *
 * Width and height are set INDEPENDENTLY rather than left to the art's 1:1 aspect: 95% wide against
 * a height pinned to what 88.9% would have given (300.8% of the box's height) stretches the crown
 * ~7% wider without making it any taller. Taller would push the gem back into the headline, and a
 * royal crown reads better slightly wide than slightly narrow. Because the height is unchanged, the
 * 53.7% seating figure still holds. */
const heroCrown: CSSProperties = {
  position: "absolute",
  bottom: "49%",
  left: "50%",
  // A 5° forward lean — the top tips TOWARD the viewer, presenting the crown rather than standing it
  // to attention. transform-origin at the base keeps it pivoting on the marble instead of sliding
  // off it, so the seating and the contact shadow stay honest through the tilt.
  transform: "translateX(-50%) perspective(1100px) rotateX(-5deg)",
  transformOrigin: "50% 100%",
  width: "95%",
  height: "288%",
  // Almost no self-shadow. A drop-shadow offsets the WHOLE silhouette downward — crown points and
  // all — which is the single loudest "this object is hovering above the surface" signal there is.
  // Grounding belongs on the marble, not on the object.
  filter: "drop-shadow(0 1px 2px rgba(84,64,120,.13))",
};

/* GROUNDING.
 *
 * All of these are anchored to the crown's real CONTACT ELLIPSE, measured from the artwork rather
 * than guessed. The crown's base is a cylinder: its silhouette is widest at y=447/512 and tapers to
 * its lowest opaque row at y=464, so the ellipse the crown actually stands on spans roughly
 * y 430–464 with its centre at 87.3% down the art. Converted through the crown's own box
 * (bottom 49%, height 288%):
 *      front lip of the base .. 76.0% of the podium box height
 *      centre of the ellipse .. 85.6%
 *
 * That distinction is the whole fix. A shadow centred BELOW 76% has clear marble between it and the
 * object, and clear space under an object is precisely how the eye decides something is hovering.
 * The occlusion is therefore centred on 85.6% — mostly hidden behind the crown, showing only as a
 * dark fringe where the silhouette meets the surface, which is what contact actually looks like.
 *
 *  1. `crownCast`      wide, soft, weak: the body's mass thrown across the marble under diffuse
 *                      halo light. Spread forward of the base, never detached from it.
 *  2. `crownReflection` the top face is POLISHED marble, and polished surfaces reflect. A flipped
 *                      copy crushed to a fraction of its height (a reflection at this shallow an
 *                      angle is heavily foreshortened), faded and blurred. Its top edge starts
 *                      exactly at the front lip, so object and mirror image touch.
 *  3. `crownContact`   the tight, dark ambient-occlusion core sitting ON the contact ellipse. This
 *                      is the one that pins the crown down.
 */
/* Colour bleed — the other half of the light exchange, and the half almost everyone omits. If white
 * marble throws light UP onto the crown, then the gold throws warmth BACK DOWN onto the marble. A
 * warm pool multiplied over the top face around the base tints it gold-cream without darkening it.
 * Two objects that trade light with each other stop looking like two objects. */
const crownBleed: CSSProperties = {
  position: "absolute",
  bottom: "70%",
  left: "50%",
  transform: "translateX(-50%)",
  width: "80%",
  height: "26%",
  borderRadius: "50%",
  mixBlendMode: "multiply",
  opacity: 0.55,
  background:
    "radial-gradient(closest-side, rgba(252,228,178,1), rgba(254,243,224,1) 52%, rgba(255,255,255,0) 78%)",
  filter: "blur(10px)",
  pointerEvents: "none",
};

const crownCast: CSSProperties = {
  position: "absolute",
  bottom: "70%",
  left: "50%",
  transform: "translateX(-50%)",
  width: "74%",
  height: "24%",
  borderRadius: "50%",
  background:
    "radial-gradient(closest-side, rgba(84,62,126,.24), rgba(84,62,126,.09) 56%, transparent 78%)",
  filter: "blur(13px)",
  pointerEvents: "none",
};

const crownReflection: CSSProperties = {
  position: "absolute",
  // top edge at 76% (the base's front lip) => bottom = 76 - 21
  bottom: "55%",
  left: "50%",
  // scaleY(-1) flips the artwork so its BASE meets the real base at the contact line. Note the mask
  // below reads `to top`: the transform flips the mask with the content, so what is authored as the
  // element's bottom is what ends up adjacent to the crown on screen.
  transform: "translateX(-50%) scaleY(-1)",
  width: "95%",
  height: "21%",
  opacity: 0.17,
  filter: "blur(2px)",
  WebkitMaskImage: "linear-gradient(to top, #000 0%, rgba(0,0,0,.45) 38%, transparent 88%)",
  maskImage: "linear-gradient(to top, #000 0%, rgba(0,0,0,.45) 38%, transparent 88%)",
  pointerEvents: "none",
};

const crownContact: CSSProperties = {
  position: "absolute",
  // Centred on the contact ellipse at 85.6%, spanning its ~19% of box height => bottom = 85.6 - 9.5
  bottom: "76%",
  left: "50%",
  transform: "translateX(-50%)",
  // The base cylinder measures 57% of the crown art, so 54% of the box; 58% leaves a couple of
  // percent of dark fringe proud of the silhouette all the way round.
  width: "58%",
  height: "19%",
  borderRadius: "50%",
  background:
    "radial-gradient(closest-side, rgba(66,46,102,.58), rgba(66,46,102,.26) 54%, transparent 76%)",
  filter: "blur(4px)",
  pointerEvents: "none",
};

const pillRow: CSSProperties = {
  ...overArt,
  marginTop: 8,
  display: "flex",
  justifyContent: "center",
  flexWrap: "wrap",
  // Clamped so all three hold ONE row down to 360px: a wrapped second row costs ~49px, and every
  // pixel the fixed blocks spend is a pixel the crown doesn't get.
  gap: "clamp(6px, 2.2vw, 9px)",
};

const pill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  height: 40,
  padding: "0 clamp(11px, 3.4vw, 16px)",
  borderRadius: 999,
  border: "1px solid color-mix(in srgb, var(--line) 40%, transparent)",
  background: "color-mix(in srgb, var(--panel) 92%, transparent)",
  boxShadow: "0 3px 10px rgba(36,26,62,.07)",
  color: "var(--text)",
  fontSize: 13.5,
  fontWeight: 700,
};

const pillIcon: CSSProperties = {
  display: "inline-flex",
  color: "var(--brand-2)",
};

/* Deliberately tight. Every pixel taken out of this card is emphasis handed to the CTA below it —
 * the card is reassurance, the button is the job. */
const card: CSSProperties = {
  ...overArt,
  marginTop: 8,
  width: "100%",
  borderRadius: "var(--radius-card)",
  border: "1px solid color-mix(in srgb, var(--line) 50%, transparent)",
  background: "color-mix(in srgb, var(--panel) 88%, transparent)",
  boxShadow: "0 14px 36px rgba(36,26,62,.08)",
  padding: "12px clamp(3px, 2.4vw, 10px) 14px",
};

const cardHeadRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const cardRule: CSSProperties = {
  flex: 1,
  height: 0,
  borderTop: "1px solid color-mix(in srgb, var(--line) 65%, transparent)",
};

const cardHeader: CSSProperties = {
  flex: "0 0 auto",
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: "-0.005em",
  color: "var(--text)",
};

const earnGrid: CSSProperties = {
  marginTop: 8,
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
};

function earnCol(divided: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "6px 4px 0",
    borderLeft: divided
      ? "1px solid color-mix(in srgb, var(--line) 50%, transparent)"
      : "1px solid transparent",
  };
}

const earnBadge: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--brand) 12%, var(--panel2))",
  color: "var(--brand)",
};

const earnLabel: CSSProperties = {
  marginTop: 9,
  fontSize: 13.5,
  fontWeight: 700,
  color: "var(--text)",
  lineHeight: 1.2,
};

const earnSub: CSSProperties = {
  marginTop: 3,
  // One line, always. The clamp (passed to FitText as its ceiling) is sized so the longest English
  // sub ("See where you place") holds one line at 360px; a longer localized sub shrinks to fit its
  // 1fr grid column rather than wrapping, keeping the three columns aligned. FitText owns the size;
  // width:100% + nowrap + overflow give it a constrained single-line box.
  fontWeight: 500,
  color: "var(--muted)",
  lineHeight: 1.3,
  width: "100%",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textAlign: "center",
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
    // Tactile, not glossy: one tucked directional shadow for lift, a close contact shadow to seat
    // it, and a single fine specular edge. No highlight sweep.
    // Three tiers, which is what reads as weight rather than as a blurry halo: a wide ambient cast
    // for lift off the page, a mid shadow for the body, and a tight dark contact line directly under
    // the pill so it looks pressed onto the surface instead of floating above it.
    boxShadow:
      "0 26px 48px -14px rgba(92,54,172,.52), 0 10px 20px -6px rgba(92,54,172,.36)," +
      " 0 2px 4px -1px rgba(52,28,104,.30), inset 0 1px 0 rgba(255,255,255,.22)",
    transition: "transform 90ms ease, box-shadow 180ms ease, opacity 140ms",
  };
}

const errorText: CSSProperties = {
  fontSize: 13,
  color: "var(--pink)",
  fontWeight: 700,
};

/* Clearly secondary and clearly detached — it reads as a separate choice, not the button's tail. */
const loginLink: CSSProperties = {
  ...overArt,
  background: "none",
  border: "none",
  color: "var(--muted)",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
  padding: "12px 10px 0",
  marginTop: 8,
};
