import type { CSSProperties } from "react";
import { titleCase } from "@/lib/titleCase";
import { FitText } from "@/ui/FitText";
import { useThemeArt } from "@/theme/useArtStyle";

/** The copy slice of HeroCard's resolved Visual that the mono card renders (structural subset —
 * HeroCard passes its full Visual straight in). */
export interface MonoDailyVisual {
  tone: string;
  pillText: string;
  title: string;
  subtitle: string | null;
  fieldText: string | null;
  metaLine: string | null;
  countdown: string | null;
  progress: number | null;
  cta: { label: string; onClick: () => void } | null;
}

/**
 * The mono-surface Daily Royale card, in two dressings sharing one state machine (HeroCard
 * resolves the Visual):
 *
 *  - PREMIUM (Starter and its skins — theme art present): the card face is one painted plate
 *    (`art.dailyCard`) carrying the crown, podium, halo and sparkles, and the copy is laid over its
 *    deliberately empty left side — status pill top-left, countdown top-right, the serif title, one
 *    line of copy, the field line and the accent progress bar, then a bold full-width brand CTA
 *    across the bottom. (It used to compose a separate glow + podium + crown per element; the plate
 *    replaced all three, so the crown can never drift out of its own lighting.)
 *  - PLAIN (the art-less Blank pair): the original pure-CSS typography card, untouched.
 */
export function MonoDailyCard({ v }: { v: MonoDailyVisual }) {
  const live = v.tone === "live";
  const art = useThemeArt();
  // Ink is chosen for the PLATE, not the theme (see the palettes at the bottom of this file).
  const PLATE_INK = art?.dailyCardInk === "light" ? PLATE_INK_ON_DARK : PLATE_INK_ON_LIGHT;

  const status = (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0, flex: "0 1 auto" }}>
        {live && (
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--lime)",
              flex: "none",
            }}
          />
        )}
        <FitText
          as="span"
          size={10.5}
          min={0.7}
          style={{
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: live ? "#1E9E5A" : art ? PLATE_INK.muted : "var(--muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {v.pillText}
        </FitText>
      </span>
      {v.countdown && (
        <span style={{ ...caps, color: art ? PLATE_INK.muted : undefined, fontVariantNumeric: "tabular-nums", flex: "none" }}>
          {v.countdown}
        </span>
      )}
    </div>
  );

  const meta = (v.metaLine || v.fieldText) && (
    <div
      style={{
        color: art ? PLATE_INK.faint : "var(--faint)",
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.5,
      }}
    >
      {[v.metaLine, v.fieldText].filter(Boolean).join(" · ")}
    </div>
  );

  const progress = v.progress != null && (
    <div
      aria-hidden
      style={{
        height: 4,
        borderRadius: 999,
        background: art ? PLATE_INK.line : "var(--line)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.min(100, Math.max(0, Math.round(v.progress * 100)))}%`,
          height: "100%",
          borderRadius: 999,
          background: "var(--brand)",
        }}
      />
    </div>
  );

  const cta = v.cta && (
    <button
      type="button"
      className="rr-tap"
      onClick={v.cta.onClick}
      style={{
        position: "relative",
        width: "100%",
        marginTop: 2,
        minHeight: art ? 56 : undefined,
        padding: art ? "15px 46px 15px 22px" : "15px 44px 15px 20px",
        borderRadius: art ? 18 : "var(--radius-ctl, 12px)",
        border: "none",
        // Premium: a top gloss layered over the royal-purple CTA gradient reads as a machined
        // plaque catching the light (the plain Blank pill keeps its flat --cta).
        background: art
          ? "linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,0) 46%), var(--cta)"
          : "var(--cta)",
        color: "var(--ctaText)",
        fontFamily: "inherit",
        fontSize: art ? 14 : 13,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        textAlign: "center",
        cursor: "pointer",
        // Premium: the CTA is the card's bold focal control — a soft brand lift grounds it, a bright
        // specular top edge catches the light, and a quiet inner bottom press gives real tactile
        // depth (never glow/casino chrome). The plain Blank pill stays flat.
        boxShadow: art
          ? "0 12px 26px color-mix(in srgb, var(--brand) 30%, transparent), 0 2px 6px color-mix(in srgb, var(--brand) 22%, transparent), inset 0 2px 0 rgba(255,255,255,.30), inset 0 -4px 9px rgba(0,0,0,.18)"
          : undefined,
      }}
    >
      {/* The label holds one line: a longer localized CTA shrinks to fit the button's content box
          (kept clear of the arrow by the right padding) rather than wrapping and growing the pill. */}
      <FitText
        as="span"
        size={art ? 14 : 13}
        min={0.58}
        style={{ display: "block", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textAlign: "center" }}
      >
        {v.cta.label}
      </FitText>
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: 20,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: art ? 16 : 15,
          fontWeight: 600,
        }}
      >
        →
      </span>
    </button>
  );

  if (art) {
    return (
      <section
        className="rr-glass"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 11,
          padding: "clamp(20px, 5.4vw, 24px)",
          borderRadius: 28,
          // Match the plate's own proportions so `cover` has nothing to trim in the common case.
          // `aspect-ratio` is a PREFERRED size, not a cap: if a long localized subtitle needs more
          // room the card still grows, and `cover` + `right center` then trims the empty left
          // rather than the crown.
          aspectRatio: "900 / 803",
          // The plate is a hard-edged rectangle, so the card has to clip it to its own radius —
          // `.rr-glass` sets no overflow of its own.
          overflow: "hidden",
          // The whole card face IS the art now — crown, podium, halo, sparkles and the lavender
          // sweep are one painted plate (`starter-daily-card.jpg`), with the copy and CTA laid over
          // its empty left side.
          //
          // `cover` + `right center` is the pairing that matters: cover never distorts (so the
          // crown and podium keep their drawn proportions whatever shape the card ends up), and
          // anchoring RIGHT means every pixel it has to trim comes off the LEFT — which is the
          // deliberately empty part of the plate. Anchoring centre would shave the crown.
          //
          // The flat `--panel` under it is what the plate sits on if it ever fails to load, and it
          // is what a dark skin shows through the JPEG's edges.
          backgroundColor: "var(--panel)",
          backgroundImage: `url(${art.dailyCard})`,
          backgroundSize: "cover",
          backgroundPosition: "right center",
          backgroundRepeat: "no-repeat",
        }}
      >
        {status}
        {/* The title owns a full-width line (never crushed against the crown column), per the
            reference — the left-text / right-showcase split happens BELOW it. A longer localized
            title shrinks to hold this one line (FitText) instead of ellipsizing, so the card keeps
            the English composition. `overflow: hidden` + the padding/negative-margin pair still
            extends the clip box below the baseline so line-height 1.0 doesn't shear descenders. */}
        <FitText
          as="div"
          className="display"
          size="clamp(30px, 9vw, 40px)"
          min={0.6}
          style={{
            lineHeight: 1.0,
            paddingBottom: "0.2em",
            marginBottom: "-0.2em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            color: PLATE_INK.text,
          }}
        >
          {titleCase(v.title)}
        </FitText>
        {/* Middle zone: copy + meter, held to the LEFT of the plate. The crown and podium are part
            of the background image now, so there is no showcase element to sit beside — `COPY_W`
            is what keeps the text off the crown instead of a flex sibling. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: meta || progress ? "space-between" : "center",
            gap: 10,
            flex: "1 1 auto",
            minWidth: 0,
            width: COPY_W,
            maxWidth: COPY_W,
          }}
        >
          {v.subtitle && (
            <div
              style={{
                color: PLATE_INK.muted,
                fontSize: 13.5,
                fontWeight: 500,
                lineHeight: 1.5,
              }}
            >
              {v.subtitle}
            </div>
          )}
          {(meta || progress) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {meta}
              {progress}
            </div>
          )}
        </div>
        {cta}
      </section>
    );
  }

  return (
    <section
      className="rr-glass"
      style={{ display: "flex", flexDirection: "column", gap: 13 }}
    >
      {status}
      <div
        className="display"
        style={{
          fontSize: "clamp(30px, 9.2vw, 38px)",
          lineHeight: 1.06,
          color: "var(--text)",
        }}
      >
        {titleCase(v.title)}
      </div>
      {v.subtitle && (
        <div
          style={{
            color: "var(--muted)",
            fontSize: 13.5,
            fontWeight: 500,
            lineHeight: 1.5,
            marginTop: -4,
          }}
        >
          {v.subtitle}
        </div>
      )}
      {meta}
      {progress}
      {cta}
    </section>
  );
}

/** Left-hand copy column. The crown occupies roughly the right half of the plate, so the text
 *  and meter are held to this width rather than being allowed to run under it. */
const COPY_W = "min(54%, 210px)";

/**
 * Ink for text sitting ON the plate — deliberately NOT `var(--text)` / `var(--muted)`.
 *
 * The plate is a fixed light image. Every theme with art renders it, including the four DARK
 * Starter skins (midnight, apex, crown_arena, champion), whose `--text` is near-white — which on
 * this card put white type on an ivory painting and made the title all but invisible. Text over a
 * photographic surface has to be coloured for the surface, not for the theme, so these are the
 * Starter ink values pinned literally. They are correct on the plate in every skin because the
 * plate never changes.
 *
 * The plate now comes in both polarities, so there are two palettes and the ART picks which — via
 * `art.dailyCardInk` — NOT the theme. A dark skin on a light plate still needs dark ink.
 */
const PLATE_INK_ON_LIGHT = {
  text: "#241A3E",
  muted: "#6F678A",
  faint: "#A69EBD",
  line: "rgba(84,64,120,.16)",
} as const;

/** For a dark plate (Midnight). Mirrors the light set: strong title, quieter body, quietest meta. */
const PLATE_INK_ON_DARK = {
  text: "#F6F3FF",
  muted: "#C4BBDD",
  faint: "#9A90B8",
  line: "rgba(255,255,255,.20)",
} as const;

/** Whisper-quiet small caps — the status voice of the mono card. */
const caps: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--muted)",
};
