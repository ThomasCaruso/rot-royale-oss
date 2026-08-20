import type { CampaignWorld } from "@/api/client";
import { starterWorldArtFor } from "@/assets/campaign/starter";
import { fmt, useT } from "@/i18n/useT";
import { chapterOf } from "@/screens/campaign/components/starter/starterWorldMeta";
import { FitText } from "@/ui/FitText";
import { worldName } from "@/i18n/campaignTitles";
import { useI18n } from "@/store/i18n";

/**
 * The current world — rendered at the SAME size + layout as the other world rows, but given the
 * "current" treatment: a royal-purple frame with a soft purple glow and a floating CURRENT WORLD
 * tab. Tapping the row opens (continues) that world's ladder; the purple chevron signals the
 * affordance — there is no separate Continue button.
 */
export function StarterCurrentWorld({
  world,
  onPick,
}: {
  world: CampaignWorld;
  onPick: () => void;
}) {
  const t = useT();
  const art = starterWorldArtFor(world.world);
  const locale = useI18n((st) => st.locale);
  const chapter = chapterOf(world);
  const pct = world.total_levels > 0 ? Math.round((world.cleared_count / world.total_levels) * 100) : 0;

  return (
    <div style={{ position: "relative", marginTop: 6 }}>
      {/* Floating CURRENT WORLD pill hanging off the top border */}
      <span
        style={{
          position: "absolute",
          top: -11,
          left: 14,
          zIndex: 2,
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 11px",
          borderRadius: 999,
          // `--cta` is the theme's own signature pill surface (and `--ctaText` the ink it chose to
          // sit on it). This was Starter's violet spelled out, so the CURRENT WORLD tab stayed
          // purple on Daylight's green hub and on Crown Arena's ember one.
          background: "var(--cta)",
          color: "var(--ctaText)",
          fontSize: 9.5,
          fontWeight: 800,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          boxShadow: "0 5px 14px color-mix(in srgb, var(--brand) 36%, transparent)",
          whiteSpace: "nowrap",
          // Cap the width so a longer localized tag shrinks (FitText) instead of running off the card.
          maxWidth: "calc(100% - 28px)",
        }}
      >
        <span aria-hidden style={{ fontSize: 9 }}>★</span>
        <FitText as="span" size={9.5} min={0.66} style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
          {t.campaign.currentWorld}
        </FitText>
      </span>

      <button
        type="button"
        onClick={onPick}
        aria-label={fmt(t.campaign.ariaWorldCurrent, {
          world: world.world,
          cleared: world.cleared_count,
          total: world.total_levels,
        })}
        className="rr-tap"
        style={{
          position: "relative",
          overflow: "hidden",
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          color: "inherit",
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderRadius: 20,
          border: "1.5px solid color-mix(in srgb, var(--brand) 42%, var(--line))",
          background: "var(--panel)",
          padding: "12px 14px",
          boxShadow:
            "inset 0 1px 0 var(--sheen), 0 9px 24px color-mix(in srgb, var(--brand) 14%, transparent), 0 0 0 4px color-mix(in srgb, var(--brand) 6%, transparent)",
        }}
      >
        {/* Establishing scene faded into the right edge (matches the other rows) */}
        {art && (
          <img
            src={art.scene}
            alt=""
            aria-hidden
            draggable={false}
            style={{
              position: "absolute",
              right: 16,
              top: "50%",
              transform: "translateY(-50%)",
              width: "40%",
              maxWidth: 185,
              height: "auto",
              opacity: 0.5,
              pointerEvents: "none",
              WebkitMaskImage: "linear-gradient(90deg, transparent, #000 64%)",
              maskImage: "linear-gradient(90deg, transparent, #000 64%)",
            }}
          />
        )}

        {art && (
          <img
            src={art.badge}
            alt=""
            aria-hidden
            draggable={false}
            style={{ width: 58, height: 58, objectFit: "contain", flex: "none", filter: "drop-shadow(0 4px 9px rgba(17,17,17,.15))" }}
          />
        )}

        <div style={{ position: "relative", minWidth: 0, flex: 1 }}>
          {/* No `overflow: hidden` — see StarterWorldRow: it clipped the display serif's descenders
              at this line-height. FitText's width shrink is unaffected. */}
          <FitText as="div" className="display" size={21} min={0.62} axis="x" style={{ lineHeight: 1.05, color: "var(--text)", width: "100%", whiteSpace: "nowrap" }}>
            {worldName(world.world, locale)}
          </FitText>
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", marginTop: 3 }}>
            {fmt(t.campaign.chapterLine, { chapter, cleared: world.cleared_count, total: world.total_levels })}
          </div>
          <div
            style={{
              marginTop: 8,
              height: 5,
              maxWidth: 128,
              borderRadius: 999,
              background: "color-mix(in srgb, var(--brand) 12%, var(--panel2))",
            }}
          >
            <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: "var(--brand)" }} />
          </div>
        </div>

        <span aria-hidden style={{ position: "relative", flex: "none", display: "flex", alignItems: "center", color: "var(--brand)" }}>
          <span style={{ fontSize: 21, fontWeight: 600, lineHeight: 1 }}>›</span>
        </span>
      </button>
    </div>
  );
}
