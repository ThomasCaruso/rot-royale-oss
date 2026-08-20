import { useEffect, useState } from "react";
import type { CampaignCompleteResponse } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { clearLabel, medalFor, worldIcon } from "@/lib/campaign";
import { Avatar } from "@/screens/home/Avatar";
import { useSessionStore } from "@/store/session";
import { WORLD_FRAMES, getFrame } from "@/theme/identity";
import { Confetti } from "@/ui/Confetti";
import { CountUp } from "@/ui/CountUp";
import { Display } from "@/ui/Display";
import { FitText } from "@/ui/FitText";
import { GlassCard } from "@/ui/GlassCard";
import { GoldButton } from "@/ui/GoldButton";
import { useReducedMotion } from "@/ui/useReducedMotion";
import { levelTitle } from "@/i18n/campaignTitles";
import { useI18n } from "@/store/i18n";

const wrap: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  margin: "0 auto",
  padding: "clamp(20px, 6vw, 34px) clamp(14px, 4vw, 20px) 48px",
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  gap: 14,
  justifyContent: "center",
};

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: 2,
  textTransform: "uppercase",
  fontWeight: 800,
  color: "var(--brand-2)",
};

/** Staged "LEVEL COMPLETE" reveal: score → clear status → coins → [frame unlocked] → unlock +
 * actions. `worldComplete` (computed by the container via worldJustCompleted — replay-safe) adds
 * the world-complete FRAME UNLOCKED celebration as its own stage with a second confetti burst. */
export function LevelComplete({
  completion,
  provisional = false,
  worldIconName,
  dailyEarned,
  dailyCap,
  worldComplete = false,
  onNext,
  onReplay,
  onBackToCampaign,
  onPractice,
  onVault,
}: {
  completion: CampaignCompleteResponse;
  // Offline finish: rewards/unlock aren't settled yet. Hide the coin chrome + the world-complete
  // frame reveal; show an honest "we'll finalize when you're back online" note instead.
  provisional?: boolean;
  worldIconName: string;
  dailyEarned: number;
  dailyCap: number;
  worldComplete?: boolean;
  onNext?: () => void;
  onReplay: () => void;
  onBackToCampaign: () => void;
  onPractice: () => void;
  onVault?: () => void;
}) {
  const locale = useI18n((st) => st.locale);
  const t = useT();
  const reduced = useReducedMotion();
  const preset = useSessionStore((s) => s.me?.avatar_preset);
  // The frame this world's completion unlocks (purchasable in the Vault — never auto-granted).
  // Offline (provisional) never celebrates the frame: the world completion isn't settled yet.
  const frame = worldComplete && !provisional ? getFrame(WORLD_FRAMES[completion.world]) : null;
  const celebrate = Boolean(frame);
  const maxStage = celebrate ? 4 : 3;
  const [stage, setStage] = useState(reduced ? maxStage : 0);

  useEffect(() => {
    if (reduced) return;
    const timers = [
      setTimeout(() => setStage(1), 500),
      setTimeout(() => setStage(2), 1100),
      setTimeout(() => setStage(3), 1700),
    ];
    // World complete: the FRAME UNLOCKED moment lands at stage 3; actions hold until stage 4 so
    // the celebration owns the beat before the screen offers what to do next.
    if (celebrate) timers.push(setTimeout(() => setStage(4), 2600));
    return () => timers.forEach(clearTimeout);
  }, [reduced, celebrate]);

  const { passed, is_boss, correct, total, clear_status, coins_awarded, daily_cap_reached } =
    completion;
  // One confetti canvas, two staggered bursts: mount (the clear) and the frame reveal — the key
  // bump at stage 3 re-fires the burst well after the first one has self-terminated (~1.6s).
  const confettiKey =
    completion.level + (is_boss ? 100 : 0) + (celebrate && stage >= 3 ? 1000 : 0);
  const header = passed
    ? is_boss
      ? t.campaign.bossComplete
      : t.campaign.levelComplete
    : t.campaign.notCleared;
  const headerColor = passed ? "var(--amber)" : "var(--muted)";

  const primary = onNext
    ? { label: t.campaign.nextLevel, action: onNext }
    : passed
      ? { label: t.campaign.replay, action: onReplay }
      : { label: t.campaign.tryAgain, action: onReplay };

  return (
    <main style={wrap}>
      {passed && <Confetti burstKey={confettiKey} />}

      {/* Stage 0 — header + score */}
      <div style={{ textAlign: "center" }}>
        <div style={{ ...eyebrow, display: "flex", gap: 8, justifyContent: "center" }}>
          <span aria-hidden className="emoji">
            {worldIcon(worldIconName)}
          </span>
          {fmt(t.campaign.worldLevel, { world: worldIconName, level: completion.level })}
        </div>
        <Display gold={passed} className="rr-pop" style={{ fontSize: 40, color: headerColor, marginTop: 4 }}>
          {header}
        </Display>
        <Display gold style={{ fontSize: 72, lineHeight: 1.05, marginTop: 6 }}>
          <CountUp value={correct} />
          <span style={{ fontSize: 32, color: "var(--muted)" }}>/{total}</span>
        </Display>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>{levelTitle(completion.title, locale)}</div>
      </div>

      {/* Stage 1 — clear status + medal */}
      <RevealRow show={stage >= 1}>
        <GlassCard
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: "14px 18px",
          }}
        >
          {passed && (
            <span aria-hidden className="emoji" style={{ fontSize: 30 }}>
              {medalFor(clear_status)}
            </span>
          )}
          <Display style={{ fontSize: 22, color: passed ? "var(--lime)" : "var(--muted)" }}>
            {clearLabel(t, clear_status)}
          </Display>
        </GlassCard>
      </RevealRow>

      {/* Stage 2 — coins (or, offline, an honest "we'll finalize when you sync" note) */}
      <RevealRow show={stage >= 2}>
        <GlassCard style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 6 }}>
          {provisional ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {t.campaign.offlineClearedNote}
            </div>
          ) : coins_awarded > 0 ? (
            <>
              <div style={{ fontSize: 26, fontWeight: 900, color: "var(--amber)" }}>
                +<CountUp value={coins_awarded} /> 🪙
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t.campaign.coinsEarned}</div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {passed ? t.campaign.capReached : t.campaign.noReward}
            </div>
          )}
          {!provisional && coins_awarded > 0 && daily_cap_reached && (
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{t.campaign.capReached}</div>
          )}
          {!provisional && (
            <div style={{ fontSize: 11, color: "var(--faint)" }}>
              {fmt(t.campaign.todayNote, {
                earned: dailyEarned,
                cap: dailyCap,
                note: t.campaign.cosmeticNote,
              })}
            </div>
          )}
        </GlassCard>
      </RevealRow>

      {/* World complete — FRAME UNLOCKED celebration (stage 3; actions wait for stage 4).
          Honest economy copy: the frame is unlocked TO BUY in the Vault, never granted. */}
      {celebrate && frame && (
        <RevealRow show={stage >= 3}>
          <div className={stage >= 3 ? "rr-splash-in" : undefined}>
            <GlassCard
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                textAlign: "center",
                border: "1.5px solid rgba(255,201,30,.55)",
                boxShadow:
                  "0 18px 40px rgba(0,0,0,.35), 0 0 26px rgba(255,201,30,.22), inset 0 1px 0 rgba(255,255,255,.08)",
              }}
            >
              <div style={{ ...eyebrow, color: "var(--amber)" }}>
                {fmt(t.campaign.worldComplete, { world: completion.world })}
              </div>
              <Display gold className="rr-pop" style={{ fontSize: 28 }}>
                {t.campaign.frameUnlocked}
              </Display>
              {/* The player's own avatar wearing the new frame. Headroom on top: the frame
                  ornament perches ~24% above the disc (FrameCard's overhang rule). */}
              <div aria-hidden style={{ paddingTop: 22 }}>
                <Avatar size={80} preset={preset} frame={frame.id} />
              </div>
              <div style={{ fontWeight: 800, color: "var(--text)", marginTop: 4 }}>
                {frame.name}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--amber)" }}>
                <span aria-hidden className="emoji">
                  🔓
                </span>{" "}
                {t.campaign.frameInVault}
              </div>
              {clear_status === "perfect" && (
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-2)" }}>
                  <span aria-hidden className="emoji">
                    💯
                  </span>{" "}
                  {t.campaign.framePerfect}
                </div>
              )}
              {onVault && (
                <button
                  type="button"
                  onClick={onVault}
                  style={{
                    marginTop: 2,
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid var(--line)",
                    background: "transparent",
                    color: "var(--muted)",
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {t.campaign.viewInVault}
                </button>
              )}
            </GlassCard>
          </div>
        </RevealRow>
      )}

      {/* Final stage — unlock + actions */}
      <RevealRow show={stage >= maxStage}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {completion.next_level_unlocked && (
            <div
              style={{
                textAlign: "center",
                fontWeight: 800,
                fontSize: 13,
                color: "var(--lime)",
                letterSpacing: 0.5,
              }}
            >
              <span aria-hidden className="emoji">
                🔓
              </span>{" "}
              {t.campaign.nextUnlocked}
            </div>
          )}
          <GoldButton onClick={primary.action}>{primary.label}</GoldButton>
          <div style={{ display: "flex", gap: 10 }}>
            <GhostButton onClick={onBackToCampaign}>{t.campaign.backToCampaign}</GhostButton>
            <GhostButton onClick={onPractice}>{t.campaign.practiceCategory}</GhostButton>
          </div>
        </div>
      </RevealRow>
    </main>
  );
}

function RevealRow({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        opacity: show ? 1 : 0,
        transform: show ? "translateY(0)" : "translateY(8px)",
        transition: "opacity 320ms ease, transform 320ms ease",
        pointerEvents: show ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}

function GhostButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: "12px 14px",
        borderRadius: 14,
        border: "1px solid var(--line)",
        background: "var(--panel)",
        color: "var(--muted)",
        fontWeight: 800,
        cursor: "pointer",
      }}
    >
      {/* Two of these split the row (each flex:1); a longer localized label shrinks to one line
          instead of wrapping and unbalancing the pair. */}
      <FitText as="span" size={13} min={0.62} style={{ display: "block", width: "100%", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden" }}>
        {children}
      </FitText>
    </button>
  );
}
