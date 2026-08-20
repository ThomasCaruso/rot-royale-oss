import type { CampaignWorld } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { type WorldState, type WorldTheme, worldFlavor, worldTheme } from "@/lib/campaign";
import { MedallionStage, Silhouette } from "@/screens/campaign/components/scenery";
import { specklesOf } from "@/screens/campaign/components/trail";
import { CrownIcon } from "@/ui/CrownIcon";
import { Display } from "@/ui/Display";
import { FitText } from "@/ui/FitText";

/**
 * A world "destination" card for the campaign board. Two variants:
 *  - `hero`  : the full-width current/continue card — a mini diorama with a big medallion scene,
 *              a floating CURRENT MISSION pill, and a chunky CONTINUE button. Dominant by design.
 *  - `board` : a staggered 2-column destination tile — silhouette backdrop, horizon glow, stage
 *              platform, foreground props. Never a dark box with an icon.
 * Every card is built in three layers: backdrop scene (clipped), midground medallion + stage,
 * foreground props that overlap the medallion's silhouette.
 */
export function WorldCard({
  world,
  state,
  variant,
  nextTitle,
  onPick,
}: {
  world: CampaignWorld;
  state: WorldState;
  variant: "hero" | "board";
  nextTitle?: string | null;
  onPick: () => void;
}) {
  const t = useT();
  const theme = worldTheme(world.world);
  // Themed display name (Science → "Cosmic Labs"); the server key stays canonical for data/routing.
  const title = worldFlavor(t, world.world).title ?? world.world;
  const done = state === "completed";
  const current = state === "current";
  const calm = state === "available"; // "coming up" — present but anticipatory
  const accent = done ? "var(--amber)" : theme.accent;
  const ring = done ? "rgba(255,201,30,.65)" : current ? theme.accent : `${theme.accent}55`;

  const aria = fmt(current ? t.campaign.ariaWorldCurrent : t.campaign.ariaWorld, {
    world: title,
    cleared: world.cleared_count,
    total: world.total_levels,
  });

  if (variant === "hero") {
    return (
      <button
        type="button"
        onClick={onPick}
        aria-label={aria}
        className={current ? "rr-glow-pulse" : undefined}
        onPointerDown={(e) => (e.currentTarget.style.transform = "scale(.985)")}
        onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
        onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        style={{
          position: "relative",
          textAlign: "left",
          cursor: "pointer",
          color: "inherit",
          width: "100%",
          minHeight: 192,
          borderRadius: 26,
          padding: "20px 16px 16px",
          border: `2px solid ${ring}`,
          background: "transparent",
          // Double glow: gold (reward) + the world accent (identity).
          boxShadow: `0 18px 40px rgba(0,0,0,.5), 0 0 0 3px rgba(255,201,30,.16), 0 0 34px ${done ? "rgba(255,201,30,.3)" : theme.accent + "55"}`,
          display: "flex",
          gap: 14,
          alignItems: "center",
          transition: "transform 120ms ease",
          marginTop: 10, // room for the floating pill + medallion poking above the edge
        }}
      >
        <Backdrop theme={theme} radius={24} />

        {/* Floating state pill, hanging off the card's top edge */}
        <span style={missionPill(done)}>
          {!done && <span aria-hidden className="rr-live-pulse" style={pillDot(theme.accent)} />}
          <FitText as="span" size={9.5} min={0.66} style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
            {done ? t.campaign.crownSecured : t.campaign.currentMission}
          </FitText>
        </span>

        <MedallionStage theme={theme} size={112} strong overlap />

        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <Display style={{ fontSize: 23, lineHeight: 1.05 }}>{title}</Display>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, minHeight: 16 }}>
            {done
              ? fmt(t.campaign.clearedShort, { cleared: world.cleared_count, total: world.total_levels })
              : nextTitle
                ? fmt(t.campaign.next, { title: nextTitle })
                : fmt(t.campaign.clearedShort, { cleared: world.cleared_count, total: world.total_levels })}
          </div>
          <div style={{ marginTop: 10 }}>
            <Pips total={world.total_levels} filled={world.cleared_count} accent={accent} />
          </div>
          <span style={continueBtn}>
            <FitText as="span" size={14.5} min={0.6} style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
              {done ? t.campaign.backToCampaign : current ? t.campaign.continue : t.campaign.start}
            </FitText>
            <span aria-hidden className="rr-float" style={{ fontSize: 13 }}>
              ▶
            </span>
          </span>
        </div>
      </button>
    );
  }

  // board (2-column) variant
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={aria}
      onPointerDown={(e) => (e.currentTarget.style.transform = "scale(.96)")}
      onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      style={{
        position: "relative",
        cursor: "pointer",
        color: "inherit",
        width: "100%",
        borderRadius: 22,
        padding: "18px 12px 14px",
        minHeight: 196,
        border: `1.5px solid ${ring}`,
        background: "transparent",
        opacity: calm ? 0.94 : 1,
        boxShadow: done
          ? "0 12px 30px rgba(0,0,0,.42), 0 0 18px rgba(255,201,30,.22)"
          : `0 12px 28px rgba(0,0,0,.4), 0 0 14px ${theme.accent}${calm ? "22" : "3a"}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        transition: "transform 120ms ease",
      }}
    >
      <Backdrop theme={theme} radius={20} dim={calm} />
      {done && (
        <span aria-hidden style={{ position: "absolute", top: 9, right: 9, zIndex: 1 }}>
          <CrownIcon size={18} />
        </span>
      )}

      <MedallionStage theme={theme} size={84} dim={calm} />

      <Display style={{ fontSize: 15.5, lineHeight: 1.05, textAlign: "center", position: "relative" }}>
        {title}
      </Display>

      <div style={{ position: "relative", width: "100%", marginTop: "auto" }}>
        <Pips total={world.total_levels} filled={world.cleared_count} accent={accent} />
        <div style={{ marginTop: 7, display: "flex", justifyContent: "center" }}>
          {done ? (
            <span style={clearedBanner}>{t.campaign.crownSecured}</span>
          ) : calm ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Flag color={theme.accent} />
              <span style={stateText("var(--faint)")}>{t.campaign.comingUp}</span>
            </span>
          ) : (
            <span style={stateText("var(--muted)")}>
              {fmt(t.campaign.clearedShort, { cleared: world.cleared_count, total: world.total_levels })}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/* ---------- layers ---------- */

/** Clipped backdrop layer: world surface gradient, silhouette scene, horizon glow, speckles.
 * Sits behind the content so the medallion/pill can break the card's frame above it. */
function Backdrop({ theme, radius, dim = false }: { theme: WorldTheme; radius: number; dim?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: radius,
        overflow: "hidden",
        background: theme.surface,
        opacity: dim ? 0.82 : 1,
        pointerEvents: "none",
      }}
    >
      <Silhouette kind={theme.scene.silhouette} accent={theme.accent} />
      {/* horizon glow: the world's light source along the card's bottom */}
      <span
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(120% 55% at 50% 116%, ${theme.accent}3d, transparent 70%)`,
        }}
      />
      <span style={specklesOf(theme.spark)} />
      <span style={{ position: "absolute", inset: 0, boxShadow: "inset 0 1px 0 rgba(255,255,255,.09)" }} />
    </span>
  );
}

/* ---------- bits ---------- */

/** Chunky segmented progress — bars fill left→right; the final (boss) slot is a gold star pip. */
function Pips({ total, filled, accent }: { total: number; filled: number; accent: string }) {
  if (total <= 0) return null;
  const bossOn = filled >= total;
  return (
    <div style={{ display: "flex", gap: 3.5, justifyContent: "center", alignItems: "center" }}>
      {Array.from({ length: Math.max(0, total - 1) }, (_, i) => {
        const on = i < filled;
        return (
          <span
            key={i}
            style={{
              flex: 1,
              height: 7,
              borderRadius: 999,
              background: on ? accent : "rgba(255,255,255,.13)",
              boxShadow: on ? `0 0 6px ${accent}88, inset 0 1px 0 rgba(255,255,255,.35)` : "inset 0 1px 2px rgba(0,0,0,.4)",
            }}
          />
        );
      })}
      <span
        aria-hidden
        style={{
          flex: "none",
          fontSize: 13,
          lineHeight: 1,
          color: bossOn ? "var(--amber)" : "rgba(255,255,255,.22)",
          textShadow: bossOn ? "0 0 8px color-mix(in srgb, var(--amber) 80%, transparent)" : "none",
        }}
      >
        ★
      </span>
    </div>
  );
}

/** Tiny checkpoint flag (CSS triangle + pole) for "coming up" tiles. */
function Flag({ color }: { color: string }) {
  return (
    <span aria-hidden style={{ position: "relative", width: 10, height: 13, display: "inline-block" }}>
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 1.5, background: "rgba(255,255,255,.45)" }} />
      <span
        style={{
          position: "absolute",
          left: 1.5,
          top: 1,
          width: 0,
          height: 0,
          borderTop: "4px solid transparent",
          borderBottom: "4px solid transparent",
          borderLeft: `7px solid ${color}`,
        }}
      />
    </span>
  );
}

function stateText(color: string): React.CSSProperties {
  return {
    fontSize: 10.5,
    fontWeight: 800,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color,
  };
}

const clearedBanner: React.CSSProperties = {
  padding: "3px 10px",
  borderRadius: 7,
  background: "linear-gradient(90deg, color-mix(in srgb, var(--amber) 75%, white), var(--amber))",
  color: "var(--btnText)",
  fontSize: 9.5,
  fontWeight: 900,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  boxShadow: "0 3px 10px color-mix(in srgb, var(--amber) 35%, transparent)",
};

const continueBtn: React.CSSProperties = {
  marginTop: 12,
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "12px 14px",
  borderRadius: 15,
  background: "linear-gradient(180deg, color-mix(in srgb, var(--amber) 76%, white), var(--amber))",
  color: "var(--btnText)",
  fontWeight: 900,
  fontSize: 14.5,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  boxShadow: "0 10px 24px color-mix(in srgb, var(--amber) 45%, transparent), inset 0 1.5px 0 rgba(255,255,255,.55)",
  fontFamily: "inherit",
};

function missionPill(done: boolean): React.CSSProperties {
  return {
    position: "absolute",
    top: -12,
    left: 16,
    // Cap the width so a longer localized tag shrinks (via FitText) instead of running off the card.
    maxWidth: "calc(100% - 32px)",
    zIndex: 2,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 11px",
    borderRadius: 999,
    background: done
      ? "linear-gradient(90deg, color-mix(in srgb, var(--amber) 75%, white), var(--amber))"
      : "linear-gradient(180deg, var(--panel2), var(--panel))",
    border: done
      ? "1.5px solid color-mix(in srgb, var(--amber) 40%, white)"
      : "1.5px solid color-mix(in srgb, var(--amber) 60%, transparent)",
    color: done ? "var(--btnText)" : "var(--amber)",
    fontSize: 9.5,
    fontWeight: 900,
    letterSpacing: 1,
    textTransform: "uppercase",
    boxShadow: "0 4px 14px rgba(0,0,0,.5)",
    whiteSpace: "nowrap",
  };
}

function pillDot(accent: string): React.CSSProperties {
  return {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: accent,
    boxShadow: `0 0 6px ${accent}`,
  };
}
