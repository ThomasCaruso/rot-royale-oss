import type { BrainBoostToday } from "@/api/client";
import { lobbyArt } from "@/assets/lobby";
import { useT } from "@/i18n/useT";
import { useAiReady } from "@/lib/useAiReady";
import { useArtStyle } from "@/theme/useArtStyle";
import { FitText } from "@/ui/FitText";

/**
 * The Home hub row — two tiles side by side in the ported reference-mock style: ROT CHECK (the
 * daily brain check; flame art, gold accent — took the old Vault tile's slot) and CAMPAIGN
 * ("clear worlds, earn coins"; globe art, violet accent). Each is a tap target with a ">" chevron
 * affordance. The Brain Boost tile is state-aware: pending → starts today's check; done → shows the
 * Brain Score inline and taps into training the weakest category. Real destinations only (no fake
 * state) — the same trust rule as the rest of Home. Vault lives in the bottom nav + coins pill.
 */
export function HubTiles({
  onGrowth,
  today,
  onStartCheck,
  onTrainWeakSpot,
}: {
  onGrowth: () => void;
  today: BrainBoostToday | null; // null while loading — the tile renders its pending state
  onStartCheck: () => void;
  onTrainWeakSpot: (category: string) => void;
}) {
  const t = useT();
  const mono = useArtStyle() === "mono";
  const aiReady = useAiReady();

  const summary = today?.completed_today === true ? (today.latest ?? null) : null;
  const weakest = summary?.weaknesses[0] ?? null;
  const rotSubtitle = summary
    ? `✓ ${t.brainBoost.brainScore} ${summary.brain_score} · ${summary.rot_type}`
    : aiReady
      ? t.brainBoost.checkMetaReady
      : t.brainBoost.checkMeta;
  const onBrainBoost =
    summary && weakest ? () => onTrainWeakSpot(weakest.category) : onStartCheck;

  // The mono ("Blank") skins get ground-up pure-CSS tiles — title, one quiet line, a plain
  // chevron. No lobby art, no glow props, no texture.
  if (mono) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <MonoTile title={t.brainBoost.introTitle} subtitle={rotSubtitle} onClick={onBrainBoost} />
        <MonoTile title={t.growth.title} subtitle={t.growth.keepPlaying} onClick={onGrowth} />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <HubTile
        title={t.brainBoost.introTitle}
        subtitle={rotSubtitle}
        accent="var(--amber)"
        art={<LobbyArtImg src={lobbyArt.flameStreak} size="clamp(80px, 24vw, 102px)" />}
        onClick={onBrainBoost}
      />
      <HubTile
        title={t.growth.title}
        subtitle={t.growth.keepPlaying}
        accent="var(--brand-2)"
        art={<LobbyArtImg src={lobbyArt.flagProgress} size="clamp(80px, 24vw, 102px)" />}
        onClick={onGrowth}
      />
    </div>
  );
}

/** Mono hub tile: flat hairline panel, slim type, generous space — nothing else. */
function MonoTile({ title, subtitle, onClick }: { title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rr-tap"
      onClick={onClick}
      style={{
        textAlign: "left",
        cursor: "pointer",
        padding: "18px 16px",
        minHeight: 108,
        borderRadius: "var(--radius-card, 16px)",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <FitText
          as="div"
          className="display"
          size={15}
          min={0.62}
          style={{ lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", flex: 1, minWidth: 0 }}
        >
          {title}
        </FitText>
        <span aria-hidden style={{ color: "var(--muted)", fontSize: 16, fontWeight: 600, lineHeight: 1, flex: "none" }}>
          ›
        </span>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 500, lineHeight: 1.45 }}>{subtitle}</div>
    </button>
  );
}

function HubTile({
  title,
  subtitle,
  accent,
  art,
  onClick,
}: {
  title: string;
  subtitle: string;
  accent: string;
  art: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="rr-tap"
      onClick={onClick}
      style={{
        position: "relative",
        overflow: "hidden",
        textAlign: "left",
        cursor: "pointer",
        padding: "clamp(12px, 4vw, 16px)",
        borderRadius: 24,
        minHeight: 150,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: `radial-gradient(120% 110% at 86% 10%, color-mix(in srgb, ${accent} 30%, var(--panel2)) 0%, color-mix(in srgb, var(--panel) 96%, black) 72%)`,
        border: `1px solid color-mix(in srgb, ${accent} 40%, var(--line))`,
        // Layered depth: outer drop shadow, an accent rim ring, a top sheen and a deeper lower shadow —
        // depth from border/shadow, only a whisper of accent glow (the glow budget stays on the hero).
        boxShadow: `0 16px 34px rgba(0,0,0,.45), inset 0 0 0 1px color-mix(in srgb, ${accent} 22%, transparent), inset 0 2px 0 rgba(255,255,255,.14), inset 0 -34px 46px rgba(0,0,0,.34), 0 0 16px color-mix(in srgb, ${accent} 8%, transparent)`,
      }}
    >
      {/* Top highlight — a bright hairline + soft sheen along the upper edge for a lit, glossy cap. */}
      <span aria-hidden style={{ position: "absolute", inset: "0 0 auto 0", height: 44, background: "linear-gradient(180deg, rgba(255,255,255,.14), transparent)", pointerEvents: "none" }} />
      {/* Faint inner star texture for arcade depth. */}
      <span aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: "radial-gradient(1.2px 1.2px at 22% 30%, rgba(255,255,255,.5), transparent), radial-gradient(1px 1px at 70% 22%, rgba(255,255,255,.4), transparent), radial-gradient(1.3px 1.3px at 40% 64%, color-mix(in srgb, var(--brand-2) 60%, transparent), transparent)" }} />
      <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          {/* Fluid title so CAMPAIGN/CAMPAÑA never collides with the chevron — sized for an 8-char
              title beside the 28px chevron at a 320px viewport. */}
          <FitText
            as="div"
            className="display"
            size="clamp(12px, 4.2vw, 19px)"
            min={0.62}
            style={{ letterSpacing: "0.02em", color: "var(--text)", lineHeight: 1.0, whiteSpace: "nowrap", overflow: "hidden", width: "100%", textShadow: "0 2px 0 rgba(0,0,0,.4), 0 4px 10px rgba(0,0,0,.4)" }}
          >
            {title}
          </FitText>
          <FitText
            as="div"
            size={12}
            min={0.7}
            style={{ color: "color-mix(in srgb, var(--text) 70%, var(--muted))", fontWeight: 600, marginTop: 4, overflow: "hidden", whiteSpace: "nowrap", width: "100%" }}
          >
            {subtitle}
          </FitText>
        </div>
        {/* Glowing circular arrow button. */}
        <span
          aria-hidden
          style={{
            flex: "none",
            width: 28,
            height: 28,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            color: "var(--btnText)",
            fontSize: 16,
            fontWeight: 800,
            background: `radial-gradient(120% 120% at 35% 25%, color-mix(in srgb, ${accent} 80%, white), ${accent})`,
            border: `1px solid color-mix(in srgb, ${accent} 70%, white)`,
            boxShadow: `0 3px 8px rgba(0,0,0,.45), 0 0 14px color-mix(in srgb, ${accent} 60%, transparent), inset 0 1px 0 rgba(255,255,255,.5)`,
          }}
        >
          ›
        </span>
      </div>
      <div style={{ position: "relative", alignSelf: "flex-end", marginTop: 0 }}>
        {/* Strong accent glow behind the art so it reads as a lit game prop. */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: "-24px -18px -14px -22px",
            borderRadius: "50%",
            background: `radial-gradient(circle, color-mix(in srgb, ${accent} 52%, transparent), transparent 68%)`,
            filter: "blur(2px)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", filter: "drop-shadow(0 10px 14px rgba(0,0,0,.6))" }}>{art}</div>
      </div>
    </button>
  );
}

/** A lobby-art PNG framed with object-fit:contain so it never squashes inside a tile. */
function LobbyArtImg({ src, size }: { src: string; size: number | string }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      style={{ width: size, height: size, objectFit: "contain", display: "block" }}
    />
  );
}
