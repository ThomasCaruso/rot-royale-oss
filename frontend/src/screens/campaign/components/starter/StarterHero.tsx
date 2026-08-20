import type { CampaignLadderResponse } from "@/api/client";
import { starterHeroArt } from "@/assets/campaign/starter";
import { useT } from "@/i18n/useT";
import { journeyTotals } from "@/lib/campaign";
import { FitText } from "@/ui/FitText";
import { panel } from "@/screens/campaign/components/starter/starterSurface";

/**
 * The "Campaign" banner — the mode's title stage on the Starter-system hub. A clear vertical
 * hierarchy: the serif Campaign wordmark + blurb, a fine star-line divider, then a lightly-elevated
 * KPI panel (quests cleared · coins today) with the journey meter unified beneath it — all held in
 * the left column, with the large gold-crown-on-a-map artwork as the hero visual anchored right.
 * Every count comes from the real ladder; nothing is invented.
 */
export function StarterHero({
  ladder,
  offlineAction,
}: {
  ladder: CampaignLadderResponse;
  /** The download-for-offline control, rendered as a small opaque banner pinned inside the top-right
   * of the card (over the feathered artwork corner) rather than in the page flow below the worlds. */
  offlineAction?: React.ReactNode;
}) {
  const t = useT();
  const j = journeyTotals(ladder.worlds);
  const earned = ladder.daily_coins_earned;
  const cap = ladder.daily_coins_cap;
  const pct = Math.round(j.pct * 100);

  return (
    <section
      style={{
        ...panel({
          borderRadius: 30,
          border: "1px solid color-mix(in srgb, var(--line) 55%, transparent)",
          // Neutral ink, not the old purple-tinted shadow: a violet shadow fights Daylight's green
          // and Bubblegum's pink, and on the dark skins it registers as nothing at all. Elevation
          // on this card comes from its hairline border and `--sheen` (tuned per polarity by each
          // theme), which is the same contract `starterSurface.panel()` uses.
          boxShadow:
            "0 20px 46px rgba(17,17,17,.10), 0 5px 16px rgba(17,17,17,.05), inset 0 1px 0 var(--sheen)",
        }),
        position: "relative",
        overflow: "hidden",
        padding: "18px 22px 18px",
        display: "flex",
        flexDirection: "column",
        minHeight: 210,
      }}
    >
      {/* Hero artwork — the gold crown on its parchment map, scaled up and anchored to the right so
          it reads as the card's hero visual. Its left edge feathers into the card (mask) and the
          cream monochrome keeps it secondary to the dark serif title. */}
      <img
        src={starterHeroArt}
        alt=""
        aria-hidden
        draggable={false}
        style={{
          position: "absolute",
          top: -6,
          right: -8,
          width: "min(58%, 224px)",
          height: "auto",
          pointerEvents: "none",
          WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 42%)",
          maskImage: "linear-gradient(90deg, transparent 0%, #000 42%)",
          filter: "drop-shadow(0 10px 18px color-mix(in srgb, var(--amber) 20%, transparent))",
        }}
      />

      {/* Offline-download banner — a small frosted pill pinned to the card's top-right corner, so the
          control lives inside the hero (over the artwork's feathered edge) instead of trailing the
          world list. Only rendered online (the parent passes null offline). */}
      {offlineAction && (
        // Capped to the right ~44% (the same reserve the wordmark's maxWidth leaves) so a longer
        // localized "download" label shrinks in place rather than growing left over the wordmark.
        // `top` is tighter than `right` on purpose: the pill's rounded cap reads as more space above
        // than beside it at an equal inset, so 8/12 is what looks evenly tucked into the corner.
        <div style={{ position: "absolute", top: 8, right: 12, zIndex: 3, maxWidth: "44%" }}>{offlineAction}</div>
      )}

      {/* Wordmark + blurb (kept in the left column, clear of the artwork) */}
      <div style={{ position: "relative" }}>
        <FitText
          as="div"
          className="display"
          size="clamp(30px, 9vw, 39px)"
          min={0.62}
          // No `overflow: hidden` here: the display serif's glyphs are ~1.14em tall, so a 0.96
          // line-height leaves the descenders (Campaign's p/g) below the box — clipping the box
          // sliced them and the baseline serifs flat. They hang into the 7px gap above the blurb
          // instead, which costs no layout height. The art reserve is a `maxWidth`, not a
          // `paddingRight`, so it's the element's OWN box — FitText compares scrollWidth against
          // clientWidth, and padding sits inside clientWidth, so a padding reserve never triggered
          // the shrink and a long localized title would have run over the artwork.
          style={{ lineHeight: 0.96, color: "var(--text)", maxWidth: "56%", whiteSpace: "nowrap" }}
        >
          {t.nav.campaign}
        </FitText>
        {/* The blurb holds one line to the left of the art (paddingRight reserves it); a longer
            localized blurb shrinks to fit rather than overflowing the narrow column or wrapping. */}
        <FitText
          as="div"
          size={13.5}
          min={0.7}
          style={{ fontWeight: 500, color: "var(--muted)", marginTop: 7, lineHeight: 1.3, paddingRight: "46%", whiteSpace: "nowrap", overflow: "hidden" }}
        >
          {t.campaign.heroBlurb}
        </FitText>
      </div>

      {/* Fine star-line divider — a quiet premium accent that breaks title from the progression area */}
      <StarDivider />

      {/* KPI panel — the two metrics housed in a lightly-elevated inset, numbers to the fore */}
      <div
        style={{
          position: "relative",
          marginTop: 13,
          maxWidth: 190,
          background: "color-mix(in srgb, var(--panel2) 85%, var(--panel))",
          border: "1px solid color-mix(in srgb, var(--line) 75%, transparent)",
          borderRadius: 14,
          padding: "10px 14px",
          boxShadow: "inset 0 1px 0 var(--sheen), 0 4px 14px rgba(17,17,17,.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <Kpi value={j.cleared} total={j.total} label={t.campaign.questsCleared} />
          <span aria-hidden style={{ width: 1, alignSelf: "stretch", background: "var(--line)", margin: "2px 12px" }} />
          <Kpi value={earned} total={cap} label={t.campaign.coinsToday} />
        </div>
      </div>

      {/* Journey meter — sits directly beneath the KPI panel so the progression reads as one unit */}
      <div
        style={{
          position: "relative",
          marginTop: 9,
          maxWidth: 190,
          height: 7,
          borderRadius: 999,
          background: "color-mix(in srgb, var(--brand) 9%, var(--panel2))",
          boxShadow: "inset 0 1px 1.5px color-mix(in srgb, var(--brand) 12%, transparent)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.max(pct, 3)}%`,
            height: "100%",
            borderRadius: 999,
            background: "linear-gradient(90deg, var(--brand-2), var(--brand))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.28)",
          }}
        />
      </div>
    </section>
  );
}

/** One KPI: a bold cleared count with a muted `/ total`, over a small uppercase label. */
function Kpi({ value, total, label }: { value: number; total: number; label: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="display" style={{ fontSize: 19, lineHeight: 1, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        {value}
        <span style={{ color: "var(--muted)", fontWeight: 400 }}> / {total}</span>
      </div>
      <FitText
        as="div"
        size={9.5}
        min={0.66}
        style={{
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--muted)",
          marginTop: 3,
          width: "100%",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {label}
      </FitText>
    </div>
  );
}

/** A hairline rule with a small gold diamond centered — a restrained luxury separator. */
function StarDivider() {
  return (
    <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 190, marginTop: 16 }}>
      <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--line) 95%, transparent))" }} />
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
      <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg, color-mix(in srgb, var(--line) 95%, transparent), transparent)" }} />
    </div>
  );
}
