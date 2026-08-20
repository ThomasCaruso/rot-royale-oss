import type { CampaignWorld } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { nextChest, perfectCount, worldFlavor, worldTheme } from "@/lib/campaign";
import { Avatar } from "@/screens/home/Avatar";
import { CoinIcon } from "@/ui/CoinIcon";
import { CrownIcon } from "@/ui/CrownIcon";
import { Display } from "@/ui/Display";
import { FitText } from "@/ui/FitText";
import { useSessionStore } from "@/store/session";

/** Compact world header that floats over the world horizon. Three tight rows so the quest path stays
 * high on screen: (1) top bar — back · emblem · title+subtitle · daily-coins · avatar; (2) progress —
 * cleared chip · bar · boss star; (3) the next-reward anticipation line (the chest the player is
 * climbing toward). Intentionally light so the world atmosphere behind it carries the scene. */
export function CampaignWorldHeader({
  world,
  dailyEarned,
  dailyCap,
  onBack,
}: {
  world: CampaignWorld;
  dailyEarned: number;
  dailyCap: number;
  onBack: () => void;
}) {
  const t = useT();
  // Your own identity — this avatar rendered the default preset with no frame, so it showed a
  // stranger's face on your own world header.
  const avatarPreset = useSessionStore((s) => s.me?.avatar_preset);
  const equippedFrame = useSessionStore((s) => s.me?.equipped_frame ?? null);
  const theme = worldTheme(world.world);
  const flavor = worldFlavor(t, world.world);
  const next = nextChest(world);
  const perfects = perfectCount(world);
  const pct = world.total_levels ? Math.min(100, (world.cleared_count / world.total_levels) * 100) : 0;
  const done = world.total_levels > 0 && world.cleared_count >= world.total_levels;

  return (
    <header
      style={{
        position: "relative",
        borderRadius: 18,
        padding: "10px 12px",
        background: "rgba(12,7,26,.66)",
        border: `1px solid ${theme.accent}40`,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      {/* Row 1 — top bar: back · emblem · title/subtitle · coins · avatar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          aria-label={t.campaign.backToWorlds}
          onClick={onBack}
          style={{
            flex: "none",
            width: 34,
            height: 34,
            borderRadius: 11,
            border: `1px solid ${theme.accent}44`,
            background: "rgba(8,4,20,.5)",
            color: "var(--muted)",
            cursor: "pointer",
            fontSize: 17,
          }}
        >
          ←
        </button>

        {/* world emblem — the illustrated medallion when the world has an art pack */}
        {theme.art?.worldIconImage ? (
          <img
            aria-hidden
            src={theme.art.worldIconImage}
            alt=""
            draggable={false}
            style={{ flex: "none", width: 44, height: 44, objectFit: "contain", display: "block", filter: "drop-shadow(0 3px 6px rgba(0,0,0,.5))" }}
          />
        ) : (
          <span
            aria-hidden
            style={{
              flex: "none",
              width: 42,
              height: 42,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: `radial-gradient(120% 120% at 50% 36%, ${theme.accent}, ${theme.accent}aa)`,
              border: `2px solid ${theme.accent}`,
            }}
          >
            <span className="emoji" style={{ fontSize: 21 }}>
              {theme.glyph}
            </span>
          </span>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <Display style={{ fontSize: 21, lineHeight: 1 }}>{flavor.title ?? world.world}</Display>
          {flavor.subtitle && (
            <FitText
              as="div"
              size={10.5}
              min={0.7}
              axis="x"
              style={{
                marginTop: 3,
                fontWeight: 700,
                color: "var(--muted)",
                width: "100%",
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              {flavor.subtitle}
            </FitText>
          )}
        </div>

        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "6px 9px",
            borderRadius: 999,
            background: "rgba(8,4,20,.5)",
            border: "1px solid rgba(255,201,30,.3)",
          }}
        >
          <CoinIcon size={14} />
          <span style={{ color: "var(--amber)", fontWeight: 800, fontSize: 12 }}>
            {dailyEarned}
            <span style={{ color: "var(--faint)", fontWeight: 700 }}>/{dailyCap}</span>
          </span>
        </div>
        <Avatar size={34} ring={theme.accent} preset={avatarPreset} frame={equippedFrame} />
      </div>

      {/* Row 2 — progress: cleared chip · bar · boss star */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
        <span style={{ flex: "none", fontSize: 11, color: "var(--muted)", fontWeight: 800 }}>
          {fmt(t.campaign.clearedShort, { cleared: world.cleared_count, total: world.total_levels })}
        </span>
        {perfects > 0 && (
          <span style={{ flex: "none", fontSize: 10, fontWeight: 900, color: "var(--amber)" }}>
            ★ {fmt(t.campaign.perfects, { n: perfects })}
          </span>
        )}
        <div
          style={{
            position: "relative",
            flex: 1,
            height: 8,
            borderRadius: 999,
            background: "color-mix(in srgb, var(--panel) 70%, black)",
            border: `1px solid ${theme.accent}33`,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: 0,
              width: `${pct}%`,
              borderRadius: 999,
              background:
                "linear-gradient(90deg, color-mix(in srgb, var(--amber) 70%, white), var(--amber) 60%, color-mix(in srgb, var(--amber) 72%, black))",
              transition: "width 450ms ease",
            }}
          />
        </div>
        <span
          aria-hidden
          style={{
            flex: "none",
            fontSize: 13,
            lineHeight: 1,
            color: done ? "var(--amber)" : "rgba(255,255,255,.25)",
            textShadow: done ? "0 0 8px color-mix(in srgb, var(--amber) 80%, transparent)" : "none",
          }}
        >
          ★
        </span>
      </div>

      {/* Row 3 — the next-reward carrot (or world-complete) */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7 }}>
        {next ? (
          <>
            <span aria-hidden className="emoji" style={{ fontSize: 12, lineHeight: 1 }}>
              🎁
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--text)" }}>
              {fmt(next.levelsRemaining > 0 ? t.campaign.nextReward : t.campaign.nextRewardReady, {
                chest: next.isFinal ? flavor.bossChest : flavor.chest,
                n: next.levelsRemaining,
              })}
            </span>
          </>
        ) : (
          <>
            <CrownIcon size={13} />
            <span style={{ fontSize: 10.5, fontWeight: 900, color: "var(--amber)", letterSpacing: 0.5 }}>
              {t.campaign.crownSecured}
            </span>
          </>
        )}
      </div>
    </header>
  );
}
