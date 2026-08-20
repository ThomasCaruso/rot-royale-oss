import { lobbyArt } from "@/assets/lobby";
import { useT } from "@/i18n/useT";
import { useArtStyle } from "@/theme/useArtStyle";
import { FitText } from "@/ui/FitText";
import { useReducedMotion } from "@/ui/useReducedMotion";
import { BattleAvatar } from "./BattleAvatar";
import { BattleCTA } from "./BattleCTA";
import { BestOfSevenPips } from "./BestOfSevenPips";
import { PhoneSilhouette } from "./PhoneSilhouette";
import { VersusMark } from "./VersusMark";

/**
 * Battle Mode — the Home #2 card: a premium head-to-head trivia showdown, composed as a STAGE:
 *
 *          BATTLE MODE                       (wordmark + spaced small-caps subtitle, both centred
 *        HEAD-TO-HEAD TRIVIA                  on the scene below)
 *   [YOU]     ⚡VS⚡      [RIVAL]              (large spotlit medallions at the SIDES; between them a
 *           (phone screen)                    faint phone question screen with the gold VS in front)
 *            BEST OF 7
 *           ● ○ ○ ○ ○ ○ ○
 *   [        START BATTLE        ]           (full-width royal-PURPLE cap — contrast without
 *                                             competing with the hero's single gold CTA)
 *
 * The versus scene is the main event, composed as three columns: each rival is a large medallion on
 * its own spotlight pool (cool violet YOU / warm gold RIVAL), and the centre column is the
 * almost-transparent PhoneSilhouette question screen — the trivia they're duelling over — with the
 * VS overlapping it in front. A periodic FACE-OFF beat (rr-faceoff — both rivals lean in while the
 * gold divider flashes, ~1s out of every 5.4s) layers on the calm idle motion (ring breath, VS
 * throb, CTA sweep, active-pip glow); two whisper-faint "?" glyphs in the scene corners keep the
 * theme trivia, not combat. Hover/press (card lift, ring tighten, VS glow, button press) unchanged.
 * Everything collapses under `prefers-reduced-motion`.
 *
 * Deliberately one step BELOW the Daily Royale hero (smaller wordmark, dimmer card glow, purple CTA)
 * — Home has exactly one #1 and this is the strong #2.
 *
 * Kept as the `DuelCard` export (see ../DuelCard.tsx) so the Home callsite + tests are unchanged
 * (`gems` stays in the signature for the callers; the CTA no longer branches on it).
 */
export function BattleModeCard({ onDuel }: { onDuel: () => void; gems: number }) {
  const t = useT();
  const reduced = useReducedMotion();
  const artStyle = useArtStyle();
  const titleWords = t.duel.cardTitle.split(" ");

  // The mono ("Blank") skins get a ground-up pure-CSS card: title, one quiet line, an outlined
  // CTA — no portraits, no spotlights, no VS scene. The hero keeps the only filled button.
  if (artStyle === "mono") {
    return (
      <section className="rr-glass" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <span className="display" style={{ fontSize: "clamp(18px, 5.6vw, 22px)", lineHeight: 1.1 }}>
            {t.duel.cardTitle}
          </span>
          <FitText
            as="span"
            size={11}
            min={0.66}
            style={{
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            {t.duel.cardBestOf}
          </FitText>
        </div>
        <div style={{ color: "var(--muted)", fontSize: 13.5, fontWeight: 500, lineHeight: 1.5 }}>
          {t.duel.cardSubtitle}
        </div>
        <button
          type="button"
          className="rr-tap"
          onClick={onDuel}
          style={{
            width: "100%",
            padding: "13px 20px",
            borderRadius: "var(--radius-ctl, 16px)",
            border: "1.5px solid var(--text)",
            background: "transparent",
            color: "var(--text)",
            fontFamily: "inherit",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <FitText
            as="span"
            size={15}
            min={0.6}
            style={{ display: "block", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textAlign: "center" }}
          >
            {t.duel.cardCta}
          </FitText>
        </button>
      </section>
    );
  }

  // NOTE: sizes use container units (cqw = 1% of the card's own width), NOT vw. The card lives in a
  // max-width:480 column, so vw (viewport-relative) blows up on any wider screen and overflows the
  // card. `cqw` resolves against the `containerType: inline-size` wrapper below → scales with the CARD.
  const avatarSize = "clamp(78px, 25cqw, 116px)";
  const vsSize = "clamp(27px, 8.4cqw, 42px)";

  return (
    <div style={{ containerType: "inline-size", width: "100%" }}>
    <section className="rr-battle" style={cardStyle}>
      {/* Depth layers (decorative, non-interactive): warm glow behind the VS, faint texture, vignette,
          and a glowing gold bottom rim. All absolute/pointer-none; none affect layout flow. */}
      <span aria-hidden style={vsBackglow} />
      <span aria-hidden style={texture} />
      <span aria-hidden style={vignette} />
      <span aria-hidden style={goldBottomRim} />

      {/* Header: wordmark + spaced small-caps subtitle, both CENTRED on the scene below so the
          title, thread and rivals stack on one axis. */}
      <div style={{ position: "relative", zIndex: 2, minWidth: 0, textAlign: "center" }}>
        <div className="display" style={{ lineHeight: 0.9, display: "flex", gap: "0.28em", flexWrap: "wrap", justifyContent: "center" }}>
          {titleWords.map((word, i) => (
            <span
              key={i}
              style={{
                fontSize: "clamp(22px, 7.6cqw, 36px)",
                color: i === 0 ? "var(--text)" : "var(--amber)",
                WebkitTextFillColor: i === 0 ? "var(--text)" : "var(--amber)",
                WebkitTextStroke: i === 0 ? "1.3px rgba(26,14,52,.92)" : "0.9px #6d3f00",
                textShadow:
                  i === 0
                    ? "0 3px 0 rgba(20,10,44,.7), 0 6px 0 rgba(10,5,28,.5), 0 10px 20px rgba(0,0,0,.5)"
                    : "0 2px 0 #9A5B00, 0 4px 0 #6d3f00, 0 6px 0 #4f2d00, 0 10px 22px rgba(255,196,49,.5)",
              }}
            >
              {word}
            </span>
          ))}
        </div>
        {/* Spaced small-caps tagline, framed by two hairlines — event-poster type, not body copy. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(7px, 2cqw, 10px)", marginTop: "clamp(6px, 1.8cqw, 9px)" }}>
          <span aria-hidden style={{ width: "clamp(16px, 5cqw, 26px)", height: 1, background: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--brand-2) 65%, transparent))" }} />
          <FitText
            as="span"
            size="clamp(9.5px, 2.7cqw, 11.5px)"
            min={0.66}
            style={{
              color: "color-mix(in srgb, var(--text) 72%, var(--muted))",
              fontWeight: 800,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            {t.duel.cardSubtitle}
          </FitText>
          <span aria-hidden style={{ width: "clamp(16px, 5cqw, 26px)", height: 1, background: "linear-gradient(90deg, color-mix(in srgb, var(--brand-2) 65%, transparent), transparent)" }} />
        </div>
      </div>

      {/* CENTRE STAGE: three columns — YOU | phone screen + VS | RIVAL — pips joined beneath.
          The card's main focus, sitting between the header and the CTA. */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "clamp(6px, 1.8cqw, 9px)", padding: "clamp(10px, 2.8cqw, 15px) 0 clamp(2px, 0.8cqw, 4px)" }}>
        {/* Street-lamp spotlights — each beam originates at a small glowing SOURCE on the card's
            edge (upper-left / upper-right) and angles diagonally DOWN onto its rival: a swaying
            lavender PARTY beam with twinkling dust onto YOU, a still warm-orange beam onto RIVAL.
            Conic wedges anchored at the lamp point (soft edges) + blur, at whisper opacity so they
            light the stage without becoming arena drama. */}
        <span aria-hidden style={{ ...lampSource, left: "0.5%", background: "radial-gradient(circle, #efe6ff 0%, #cdb8ff 45%, transparent 75%)", boxShadow: "0 0 12px 3px rgba(205,184,255,.55)" }} />
        <span
          aria-hidden
          className={reduced ? undefined : "rr-spot-sway"}
          style={{
            ...spotBeam,
            left: "-2%",
            // Wedge anchored at the lamp (top-left), aimed down-right at the YOU medallion.
            // Lavender-leaning so it reads against the violet card; still whisper-soft.
            background:
              "conic-gradient(from 116deg at 3% 2%, transparent 0deg, color-mix(in srgb, #cdb8ff 52%, transparent) 13deg, color-mix(in srgb, #cdb8ff 52%, transparent) 31deg, transparent 46deg)",
            transformOrigin: "3% 2%",
            opacity: 0.42,
          }}
        />
        <span aria-hidden style={{ ...lampSource, right: "0.5%", background: "radial-gradient(circle, #ffe9c9 0%, #ffab52 45%, transparent 75%)", boxShadow: "0 0 12px 3px rgba(255,160,70,.5)" }} />
        <span
          aria-hidden
          style={{
            ...spotBeam,
            right: "-2%",
            // Mirrored wedge anchored at the top-right lamp, aimed down-left at RIVAL.
            background:
              "conic-gradient(from 198deg at 97% 2%, transparent 0deg, color-mix(in srgb, var(--amber) 46%, #ff6a00) 15deg, color-mix(in srgb, var(--amber) 46%, #ff6a00) 33deg, transparent 46deg)",
            opacity: 0.2,
          }}
        />
        {/* Party dust drifting in the YOU beam — three twinkling specks, nothing more. */}
        {PARTY_DUST.map((d, i) => (
          <span
            key={i}
            aria-hidden
            className={reduced ? undefined : "rr-twinkle"}
            style={{
              position: "absolute",
              left: d.left,
              top: d.top,
              width: d.size,
              height: d.size,
              borderRadius: "50%",
              background: d.color,
              opacity: 0.5,
              animationDelay: d.delay,
              pointerEvents: "none",
            }}
          />
        ))}

        {/* Whisper-faint trivia glyphs in the scene corners — theme cues, never clutter. */}
        <span aria-hidden className="display" style={{ position: "absolute", left: "5%", top: "2%", fontSize: "clamp(17px, 5cqw, 24px)", color: "var(--brand-2)", opacity: 0.13, transform: "rotate(-14deg)", pointerEvents: "none" }}>?</span>
        <span aria-hidden className="display" style={{ position: "absolute", right: "5.5%", bottom: "26%", fontSize: "clamp(13px, 4cqw, 19px)", color: "var(--brand-2)", opacity: 0.11, transform: "rotate(11deg)", pointerEvents: "none" }}>?</span>

        {/* The face-off row: rivals at the sides, the faint question screen standing between them
            with the gold VS overlapping in front. Labels are absolute under each circle
            (paddingBottom reserves their room); the rivals carry the face-off lean-in (one shared
            timeline with the VS divider flash). */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(8px, 2.8cqw, 18px)", width: "100%", paddingBottom: "clamp(17px, 5cqw, 22px)" }}>
          <BattleAvatar src={lobbyArt.avatarHooded} label={t.duel.cardYou} glow="color-mix(in srgb, var(--brand-2) 82%, transparent)" size={avatarSize} reduced={reduced} z={2} className={reduced ? undefined : "rr-faceoff-a"} />
          <div style={{ position: "relative", flex: "none", display: "grid", placeItems: "center" }}>
            <PhoneSilhouette />
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 2 }}>
              <VersusMark size={vsSize} reduced={reduced} />
            </div>
          </div>
          <BattleAvatar src={lobbyArt.avatarBot} label={t.duel.cardRival} glow="color-mix(in srgb, var(--amber) 76%, transparent)" size={avatarSize} reduced={reduced} z={1} className={reduced ? undefined : "rr-faceoff-b"} />
        </div>
        <BestOfSevenPips label={t.duel.cardBestOf} reduced={reduced} />
      </div>

      {/* CTA: full-width royal-purple cap with a whisper of side inset. */}
      <div style={{ position: "relative", zIndex: 2, padding: "0 clamp(4px, 1.4cqw, 8px)" }}>
        <BattleCTA label={t.duel.cardCta} onClick={onDuel} />
      </div>
    </section>
    </div>
  );
}

/** Shared shape of the two street-lamp beams (see the scene block) — a blurred conic wedge whose
 * apex sits at the lamp source on the card edge, spilling diagonally down across the stage. */
const spotBeam: React.CSSProperties = {
  position: "absolute",
  top: "-14%",
  height: "112%",
  width: "58%",
  filter: "blur(7px)",
  pointerEvents: "none",
};

/** The lamp head itself — a small glowing source point on the card edge where its beam begins. */
const lampSource: React.CSSProperties = {
  position: "absolute",
  top: "-11%",
  width: 7,
  height: 7,
  borderRadius: "50%",
  opacity: 0.75,
  pointerEvents: "none",
};

/** The violet beam's twinkling party specks (position/size/stagger tuned by eye — static data so
 * renders stay stable). */
const PARTY_DUST = [
  { left: "12%", top: "22%", size: 3, color: "#d9c9ff", delay: "0s" },
  { left: "19%", top: "44%", size: 2.5, color: "#b79dff", delay: "0.6s" },
  { left: "8%", top: "56%", size: 2, color: "#efe6ff", delay: "1.1s" },
] as const;

/* ---- Card shell + depth layers (token-driven so the whole card re-skins per theme) ---- */

const cardStyle: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  gap: "clamp(3px, 1cqw, 6px)",
  padding: "clamp(13px, 3.6cqw, 18px) clamp(16px, 4.5cqw, 22px)",
  borderRadius: "clamp(22px, 6cqw, 28px)",
  // Deep royal-purple gradient (dark corners, a brighter royal middle), derived from theme tokens.
  background:
    "linear-gradient(150deg, color-mix(in srgb, var(--panel) 94%, black) 0%, color-mix(in srgb, var(--brand) 30%, var(--panel2)) 52%, color-mix(in srgb, var(--panel) 88%, black) 100%)",
  // Gold rim; the inner purple stroke + inner bottom-gold glow + top highlight complete the bevel.
  border: "1px solid color-mix(in srgb, var(--amber) 40%, transparent)",
  boxShadow:
    "inset 0 0 0 1px color-mix(in srgb, var(--brand-2) 28%, transparent)," +
    " inset 0 -20px 42px color-mix(in srgb, var(--amber) 12%, transparent)," +
    " inset 0 2px 0 rgba(255,255,255,.1)," +
    " 0 22px 48px rgba(0,0,0,.52), 0 0 26px color-mix(in srgb, var(--brand) 15%, transparent)",
};

/** Quiet violet pool behind the centre of the scene — ambient depth only (no gold, no portal); the
 * side spotlights live on the avatars' own halos (cool violet YOU / warm gold RIVAL). */
const vsBackglow: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "48%",
  width: "64%",
  height: "62%",
  transform: "translate(-50%, -50%)",
  borderRadius: "50%",
  background: "radial-gradient(circle, color-mix(in srgb, var(--brand) 30%, transparent) 0%, transparent 68%)",
  filter: "blur(14px)",
  pointerEvents: "none",
};

/** Faint speckle texture (starfield) for depth — kept low so it never reads as noise. */
const texture: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  opacity: 0.55,
  pointerEvents: "none",
  backgroundImage:
    "radial-gradient(1.2px 1.2px at 22% 28%, rgba(255,255,255,.5), transparent)," +
    "radial-gradient(1px 1px at 60% 66%, rgba(255,255,255,.35), transparent)," +
    "radial-gradient(1.3px 1.3px at 82% 24%, rgba(255,201,30,.32), transparent)," +
    "radial-gradient(1px 1px at 42% 82%, rgba(199,180,255,.3), transparent)",
};

/** Corner vignette — darkens the edges so the lit centre pops. */
const vignette: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  borderRadius: "inherit",
  pointerEvents: "none",
  background: "radial-gradient(120% 120% at 50% 42%, transparent 55%, rgba(0,0,0,.34) 100%)",
};

/** Glowing gold bottom rim — the brightest edge of the bevel, as in the reference. */
const goldBottomRim: React.CSSProperties = {
  position: "absolute",
  left: "7%",
  right: "7%",
  bottom: 0,
  height: 2,
  borderRadius: 999,
  background: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--amber) 78%, transparent), transparent)",
  pointerEvents: "none",
};
