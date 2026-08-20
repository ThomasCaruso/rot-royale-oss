import { type CampaignLadderResponse, type CampaignWorld } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { worldFlavor } from "@/lib/campaign";
import { CampaignHero } from "@/screens/campaign/components/CampaignHero";
import { CampaignRewardCard } from "@/screens/campaign/components/CampaignRewardCard";
import { WorldBoard } from "@/screens/campaign/components/WorldBoard";
import { StarterCampaignHub } from "@/screens/campaign/components/starter/StarterCampaignHub";
import { useArtStyle, useStarterSystem } from "@/theme/useArtStyle";
import { FitText } from "@/ui/FitText";
import { GlassCard } from "@/ui/GlassCard";

const shell: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  margin: "0 auto",
  // Bottom padding clears the floating bottom nav so the crown milestone never hides behind it.
  padding: "calc(clamp(14px, 4vw, 22px) + env(safe-area-inset-top)) clamp(14px, 4vw, 20px) calc(124px + env(safe-area-inset-bottom))",
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

/**
 * Campaign hub — a premium world-selection board: a cosmic hero banner, a daily-chest reward card,
 * the dominant current/continue world, a staggered 2-column board of the remaining worlds connected
 * by a dotted route, and a Crown milestone. The shared bottom nav (Campaign active) is rendered by
 * the Campaign container so the hub and the ladder are peer destinations to Home.
 */
export function CampaignWorlds({
  ladder,
  onPick,
  onExit,
  onVault,
  offlineAction,
}: {
  ladder: CampaignLadderResponse;
  onPick: (world: CampaignWorld) => void;
  onExit: () => void;
  onVault?: () => void;
  /** Only the Starter hub takes this — its branded header occupies the corner the other paths pin
   * the floating download pill to, so there it renders in-flow instead. */
  offlineAction?: React.ReactNode;
}) {
  const t = useT();
  const mono = useArtStyle() === "mono";
  const starterHub = useStarterSystem();

  // Normal themes (Starter + its skins — mono surface, but WITH the Starter art set): the premium
  // reference hub — branded header, "Campaign" banner, spotlighted current world, world rows.
  if (starterHub) {
    return (
      <StarterCampaignHub ladder={ladder} onPick={onPick} onVault={onVault} offlineAction={offlineAction} />
    );
  }

  // Mono ("Blank"): the world hub is a quiet header card + one text list of worlds with their
  // progress — no cosmic hero banner, no chest art, no dotted route board.
  if (mono) {
    return (
      <main style={shell}>
        <GlassCard style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 10.5, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600, color: "var(--muted)" }}>
            {ladder.daily_coins_earned}/{ladder.daily_coins_cap} {t.campaign.coinsToday}
          </span>
          <span className="display" style={{ fontSize: "clamp(26px, 8vw, 34px)", lineHeight: 1.05 }}>
            {t.campaign.journey}
          </span>
          <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 500, lineHeight: 1.5 }}>
            {t.campaign.subtitle}
          </span>
        </GlassCard>

        <GlassCard style={{ display: "flex", flexDirection: "column", padding: "6px 22px" }}>
          {ladder.worlds.map((w, i) => (
            <button
              key={w.world}
              type="button"
              onClick={() => onPick(w)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                width: "100%",
                padding: "16px 0",
                background: "transparent",
                border: "none",
                borderTop: i === 0 ? "none" : "1px solid var(--line)",
                cursor: "pointer",
                textAlign: "left",
                color: "var(--text)",
              }}
            >
              <FitText as="span" className="display" size={18} min={0.66} axis="x" style={{ lineHeight: 1.15, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
                {worldFlavor(t, w.world).title ?? w.world}
              </FitText>
              <span style={{ display: "inline-flex", alignItems: "baseline", gap: 10, flex: "none" }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                  {fmt(t.campaign.clearedShort, { cleared: w.cleared_count, total: w.total_levels })}
                </span>
                <span aria-hidden style={{ color: "var(--faint)", fontSize: 17, fontWeight: 500, lineHeight: 1 }}>
                  ›
                </span>
              </span>
            </button>
          ))}
        </GlassCard>

        <p style={{ textAlign: "center", fontSize: 11, fontWeight: 500, color: "var(--faint)", margin: "2px 8px 0" }}>
          {t.campaign.cosmeticNote}
        </p>
      </main>
    );
  }

  return (
    <main style={shell}>
      <CampaignHero ladder={ladder} onExit={onExit} />
      <CampaignRewardCard ladder={ladder} />
      <WorldBoard ladder={ladder} onPick={onPick} />
      <p style={{ textAlign: "center", fontSize: 11, color: "var(--faint)", margin: "2px 8px 0" }}>
        {t.campaign.cosmeticNote}
      </p>
    </main>
  );
}
