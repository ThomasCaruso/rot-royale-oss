import type { ChestReward, Mission } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { MISSION_ICON, rewardAmount, rewardKind } from "@/lib/today";
import { CoinIcon } from "@/ui/CoinIcon";
import { Display } from "@/ui/Display";
import { GemIcon } from "@/ui/GemIcon";
import { GlassCard } from "@/ui/GlassCard";
import { useReducedMotion } from "@/ui/useReducedMotion";

export interface MissionsCardProps {
  missions: Mission[];
  completedCount: number;
  required: number;
  chestState: string; // in_progress | ready | claimed
  reward: ChestReward;
  claiming: boolean;
  onClaim: () => void;
}

/** The daily heartbeat: three missions + the chest you open by finishing two of them. The reward is
 *  teased before opening (anticipation), the chest glows when claimable, and the CTA gates on the
 *  server-computed chest state. Reduced-motion drops the glow pulse, keeps every state legible. */
export function MissionsCard({
  missions,
  completedCount,
  required,
  chestState,
  reward,
  claiming,
  onClaim,
}: MissionsCardProps) {
  const t = useT();
  const reduced = useReducedMotion();
  const kind = rewardKind(reward);
  const amount = rewardAmount(reward);
  const rewardLabel = fmt(kind === "gems" ? t.today.rewardGems : t.today.rewardCoins, {
    n: amount,
  });
  const RewardIcon = kind === "gems" ? GemIcon : CoinIcon;
  const remaining = Math.max(required - completedCount, 0);
  const ready = chestState === "ready";
  const claimed = chestState === "claimed";

  const labelFor = (id: string) => {
    if (id === "play_royale") return t.today.mission_play_royale;
    if (id === "complete_duel") return t.today.mission_complete_duel;
    if (id === "clear_campaign") return t.today.mission_clear_campaign;
    return id;
  };

  return (
    <GlassCard style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span aria-hidden className="emoji" style={{ fontSize: 24, lineHeight: 1 }}>
          🎯
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Display style={{ fontSize: 19, color: "var(--text)", lineHeight: 1.05 }}>
            {t.today.missionsTitle}
          </Display>
          <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 600, marginTop: 2 }}>
            {fmt(t.today.missionsSubtitle, { required, total: missions.length })}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {missions.map((m) => (
          <div
            key={m.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "9px 11px",
              borderRadius: 14,
              background: m.done
                ? "linear-gradient(180deg, color-mix(in srgb, var(--lime) 20%, var(--panel2)), var(--panel))"
                : "var(--panel)",
              border: `1px solid ${m.done ? "color-mix(in srgb, var(--lime) 45%, transparent)" : "var(--line)"}`,
            }}
          >
            <span
              aria-hidden
              className="emoji"
              style={{ fontSize: 18, lineHeight: 1, opacity: m.done ? 1 : 0.85 }}
            >
              {MISSION_ICON[m.id] ?? "•"}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 14,
                fontWeight: 700,
                color: m.done ? "var(--text)" : "var(--muted)",
              }}
            >
              {labelFor(m.id)}
            </span>
            <span
              aria-hidden
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                flex: "none",
                fontSize: 14,
                fontWeight: 900,
                color: m.done ? "var(--btnText)" : "var(--faint)",
                background: m.done ? "var(--lime)" : "transparent",
                border: m.done ? "none" : "2px solid var(--line)",
              }}
            >
              {m.done ? "✓" : ""}
            </span>
          </div>
        ))}
      </div>

      {/* Chest */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 13,
          padding: "12px 13px",
          borderRadius: 18,
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--amber) 26%, var(--panel2)) 0%, var(--panel2) 60%, var(--panel) 100%)",
          border: `1px solid ${ready ? "color-mix(in srgb, var(--amber) 55%, transparent)" : "var(--line)"}`,
          boxShadow: ready
            ? "0 0 22px color-mix(in srgb, var(--amber) 30%, transparent)"
            : "none",
        }}
      >
        <span
          aria-hidden
          className="emoji"
          style={{
            fontSize: 34,
            lineHeight: 1,
            flex: "none",
            opacity: claimed ? 0.5 : 1,
            filter: claimed ? "grayscale(0.6)" : "none",
            animation: ready && !reduced ? "rr-glow-pulse 2.2s ease-in-out infinite" : "none",
          }}
        >
          {claimed ? "📭" : "🎁"}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontWeight: 800,
              fontSize: 15,
              color: "var(--text)",
            }}
          >
            <RewardIcon size={15} />
            <span>{rewardLabel}</span>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 11.5, fontWeight: 600, marginTop: 2 }}>
            {claimed
              ? t.today.chestClaimed
              : ready
                ? fmt(t.today.chestProgressLabel, { done: completedCount, total: missions.length })
                : fmt(t.today.chestKeepGoing, { n: remaining })}
          </div>
        </div>

        {ready && (
          <button
            type="button"
            className="display"
            disabled={claiming}
            onClick={onClaim}
            onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(2px)")}
            onPointerUp={(e) => (e.currentTarget.style.transform = "translateY(0)")}
            onPointerLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
            style={{
              flex: "none",
              padding: "11px 18px",
              borderRadius: 14,
              border: "none",
              cursor: claiming ? "default" : "pointer",
              fontSize: 14,
              letterSpacing: 0.4,
              color: "var(--btnText)",
              opacity: claiming ? 0.7 : 1,
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--amber) 72%, white) 0%, var(--amber) 45%, color-mix(in srgb, var(--amber) 72%, black) 100%)",
              boxShadow: "0 8px 22px color-mix(in srgb, var(--amber) 45%, transparent)",
              transition: "transform 80ms",
            }}
          >
            {claiming ? t.today.chestOpening : t.today.chestOpen}
          </button>
        )}
      </div>
    </GlassCard>
  );
}
