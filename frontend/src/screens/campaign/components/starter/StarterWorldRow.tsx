import type { CampaignWorld } from "@/api/client";
import { starterWorldArtFor } from "@/assets/campaign/starter";
import { fmt, useT } from "@/i18n/useT";
import { chapterOf } from "@/screens/campaign/components/starter/starterWorldMeta";
import { CrownIcon } from "@/ui/CrownIcon";
import { FitText } from "@/ui/FitText";
import { worldName } from "@/i18n/campaignTitles";
import { useI18n } from "@/store/i18n";

// Per-world nudges for the establishing scene (some illustrations frame better a little lower or
// smaller within the row). Anything unset falls back to the shared defaults below.
const SCENE_ADJUST: Record<string, { top?: string; width?: string; maxWidth?: number }> = {
  // The colosseum sits high + reads large; drop it down a touch and zoom the art out.
  Sports: { top: "60%", width: "33%", maxWidth: 150 },
};

/**
 * One world row on the Starter hub: category medallion, name, chapter/clear line, a slim progress
 * rail, and its establishing scene faded into the right. A completed world swaps the chevron for a
 * gold crown. Every state is drawn from real ladder data — worlds are always enterable (the backend
 * gates individual LEVELS, not worlds), so no row is ever shown as a locked dead-end.
 */
export function StarterWorldRow({
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
  const done = world.total_levels > 0 && world.cleared_count >= world.total_levels;
  const pct = world.total_levels > 0 ? Math.round((world.cleared_count / world.total_levels) * 100) : 0;
  const sceneAdj = SCENE_ADJUST[world.world] ?? {};

  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={fmt(t.campaign.ariaWorld, {
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
        border: "1px solid color-mix(in srgb, var(--line) 75%, transparent)",
        background: "var(--panel)",
        padding: "12px 14px",
        boxShadow: "inset 0 1px 0 var(--sheen), 0 1px 2px rgba(17,17,17,.03), 0 9px 22px rgba(17,17,17,.06)",
      }}
    >
      {/* Establishing scene faded into the right edge, behind the chevron (kept well clear of the
          left-side text + progress rail so nothing overlaps the artwork) */}
      {art && (
        <img
          src={art.scene}
          alt=""
          aria-hidden
          draggable={false}
          loading="lazy"
          decoding="async"
          style={{
            position: "absolute",
            right: 16,
            top: sceneAdj.top ?? "50%",
            transform: "translateY(-50%)",
            width: sceneAdj.width ?? "40%",
            maxWidth: sceneAdj.maxWidth ?? 185,
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
          loading="lazy"
          decoding="async"
          style={{ width: 58, height: 58, objectFit: "contain", flex: "none", filter: "drop-shadow(0 4px 9px rgba(17,17,17,.15))" }}
        />
      )}

      <div style={{ position: "relative", minWidth: 0, flex: 1 }}>
        {/* No `overflow: hidden`: at 1.05 line-height the display serif's descenders (Geography's
            g/p/y) fall outside the box, and clipping it cut them flat. FitText still shrinks a long
            name to fit the width (scrollWidth is reported the same either way), and the row button's
            own overflow:hidden is the outer guard. */}
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
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              borderRadius: 999,
              background: done ? "var(--amber)" : "var(--brand)",
            }}
          />
        </div>
      </div>

      <span aria-hidden style={{ position: "relative", flex: "none", display: "flex", alignItems: "center", color: "var(--faint)" }}>
        {done ? <CrownIcon size={20} /> : <span style={{ fontSize: 21, fontWeight: 500, lineHeight: 1 }}>›</span>}
      </span>
    </button>
  );
}
