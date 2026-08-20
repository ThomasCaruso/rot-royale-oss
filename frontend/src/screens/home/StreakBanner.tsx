import type { ChestReward } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { rewardAmount, rewardKind, streakRungs } from "@/lib/today";

export interface StreakBannerProps {
  current: number;
  milestones: number[];
  nextMilestone: number | null;
  nextReward: ChestReward | null;
}

/** Loss-aversion + a visible reward ladder: the live streak, the 3/5/7 rungs (reached / next /
 *  future), and the next earned reward. Earned, never purchasable. Rendered only when a streak is
 *  alive (Home gates on current >= 1). Static — no animation needed. */
export function StreakBanner({ current, milestones, nextMilestone, nextReward }: StreakBannerProps) {
  const t = useT();
  const rungs = streakRungs(current, milestones, nextMilestone);
  const rewardText =
    nextMilestone != null && nextReward != null
      ? fmt(t.today.streakNextReward, {
          day: nextMilestone,
          reward: fmt(
            rewardKind(nextReward) === "gems" ? t.today.rewardGems : t.today.rewardCoins,
            { n: rewardAmount(nextReward) },
          ),
        })
      : t.today.streakMaxed;

  return (
    <section
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "12px 15px",
        borderRadius: 20,
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--pink) 24%, var(--panel2)) 0%, var(--panel2) 60%, var(--panel) 100%)",
        border: "1px solid color-mix(in srgb, var(--pink) 38%, transparent)",
        boxShadow: "0 14px 30px rgba(0,0,0,.34)",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "relative",
          width: 48,
          height: 48,
          flex: "none",
          display: "grid",
          placeItems: "center",
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 35% 28%, color-mix(in srgb, var(--pink) 55%, var(--panel2)), var(--panel))",
          border: "2px solid color-mix(in srgb, var(--pink) 50%, transparent)",
        }}
      >
        <span className="emoji" style={{ fontSize: 26, lineHeight: 1 }}>
          🔥
        </span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="display" style={{ fontSize: 17, color: "var(--text)", lineHeight: 1.1 }}>
          {fmt(t.today.streakTitle, { n: current })}
        </div>
        <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 600, marginTop: 2 }}>
          {rewardText}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flex: "none" }}>
        {rungs.map((r) => (
          <span
            key={r.day}
            aria-hidden
            className="display"
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              fontSize: 12,
              color: r.reached ? "var(--btnText)" : r.isNext ? "var(--amber)" : "var(--faint)",
              background: r.reached
                ? "linear-gradient(180deg, color-mix(in srgb, var(--amber) 80%, white), var(--amber))"
                : "var(--panel)",
              border: r.isNext
                ? "2px solid var(--amber)"
                : `1px solid ${r.reached ? "transparent" : "var(--line)"}`,
              boxShadow: r.reached ? "0 0 10px color-mix(in srgb, var(--amber) 45%, transparent)" : "none",
            }}
          >
            {r.day}
          </span>
        ))}
      </div>
    </section>
  );
}
