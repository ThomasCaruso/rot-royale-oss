import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type CampaignCompleteResponse,
  type CampaignStartResponse,
  type PracticeAnswerResponse,
} from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { nextStreak, shouldCelebrate } from "@/lib/celebrate";
import { worldIcon } from "@/lib/campaign";
import { getModule } from "@/modules/registry";
import { enqueue } from "@/offline/outbox";
import { revealFor, itemFor } from "@/offline/playEngine";
import { markProvisionalClear } from "@/offline/campaignLocal";
import type { OfflineRound, OfflineItem } from "@/offline/types";
import { PracticeReveal, ProgressDots } from "@/screens/Practice";
import { CategorySplash } from "@/ui/CategorySplash";
import { GlassCard } from "@/ui/GlassCard";
import { GoldButton } from "@/ui/GoldButton";
import { Centered } from "@/screens/campaign/Campaign";
import { errorMessage } from "@/i18n/errors";

type Phase = "splash" | "playing" | "reveal" | "settling" | "error";

const wrap: React.CSSProperties = {
  width: "100%",
  maxWidth: 560,
  margin: "0 auto",
  padding: "calc(clamp(18px, 5vw, 28px) + env(safe-area-inset-top)) clamp(14px, 4vw, 20px) 48px",
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const stage: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 16,
};

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: 2,
  textTransform: "uppercase",
  fontWeight: 800,
  color: "var(--muted)",
};

/** A campaign level: same self-paced lesson loop as practice (reuses the practice answer endpoint
 * + reveal), but framed as a level and settled for rewards/progress when finished. */
// A campaign level clears at 7 of 10 correct (mirrors the UI copy + the server rule). Used only to
// synthesize a PROVISIONAL offline completion; the server re-scores on sync and is authoritative.
const OFFLINE_PASS_THRESHOLD = 7;

export function CampaignPlay({
  session,
  offlineRounds,
  userId,
  onFinished,
  onAbort,
}: {
  session: CampaignStartResponse;
  // Present ⇒ offline mode: play + reveal + record locally, enqueue one campaign result on finish.
  offlineRounds?: OfflineRound[];
  // The player, so an offline clear can be recorded provisionally for the ladder overlay.
  userId?: string;
  // The second arg flags a provisional (offline) completion so LevelComplete hides reward chrome.
  onFinished: (completion: CampaignCompleteResponse, opts?: { provisional?: boolean }) => void;
  onAbort: () => void;
}) {
  const t = useT();
  const offline = !!offlineRounds;
  const [phase, setPhase] = useState<Phase>("splash");
  const [idx, setIdx] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [reveal, setReveal] = useState<PracticeAnswerResponse | null>(null);
  const [error, setError] = useState("");
  const [celebrate, setCelebrate] = useState(false);
  const streakRef = useRef(0); // running consecutive-correct streak; gates confetti on the reveal
  const answeredRef = useRef(false); // one answer-send per round
  // Offline accumulators: the recorded choices (for the outbox) + the running correct count.
  const offlineItemsRef = useRef<OfflineItem[]>([]);
  const offlineCorrectRef = useRef(0);

  useEffect(() => {
    if (phase !== "splash") return;
    answeredRef.current = false;
    setChoice(null);
    setReveal(null);
    const t = setTimeout(() => setPhase("playing"), 900);
    return () => clearTimeout(t);
  }, [phase, idx]);

  const onRoundComplete = useCallback(
    (res: unknown) => {
      if (answeredRef.current) return;
      answeredRef.current = true;
      const r = res as { choice?: number; elapsed_ms?: number };
      const picked = typeof r?.choice === "number" ? r.choice : null;
      setChoice(picked);
      // Offline: score locally against the cached answer, record the choice for later sync. No
      // network, no api.answerPracticeRound. (Mirrors Practice's offline reveal shape.)
      if (offline && offlineRounds) {
        const rd = offlineRounds[idx];
        const rv = revealFor(rd, picked);
        offlineItemsRef.current.push(itemFor(rd, picked, r?.elapsed_ms ?? 0));
        if (rv.correct) offlineCorrectRef.current += 1;
        const finished = idx === session.rounds.length - 1;
        const streak = nextStreak(streakRef.current, rv.correct);
        streakRef.current = streak;
        setCelebrate(shouldCelebrate({ correct: rv.correct, streak, isFinal: finished }));
        setReveal({
          idx,
          module_type: "trivia",
          correct: rv.correct,
          valid: true,
          answer: { correctIndex: rv.correctIndex },
          explanation: rv.explanation,
          finished,
          correct_count: null,
          total: null,
          accuracy: null,
          sharpness: null,
          sharpness_gained: null,
        });
        setPhase("reveal");
        return;
      }
      api
        .answerPracticeRound(session.entry_id, idx, res as Record<string, unknown>)
        .then((rev) => {
          // Advance the streak, then gate confetti to milestones + the final level question. The
          // server flags `finished` on the last question; fall back to the index for safety.
          const streak = nextStreak(streakRef.current, rev.correct);
          streakRef.current = streak;
          setCelebrate(
            shouldCelebrate({
              correct: rev.correct,
              streak,
              isFinal: rev.finished || idx === session.rounds.length - 1,
            }),
          );
          setReveal(rev);
          setPhase("reveal");
        })
        .catch((err) => {
          setError(errorMessage(err, t, t.contest.lostConnection));
          setPhase("error");
        });
    },
    [session.entry_id, session.rounds.length, idx, t, offline, offlineRounds],
  );

  const onContinue = useCallback(async () => {
    if (!reveal) return;
    // Offline: on the final round, queue one campaign result + mark the level provisionally cleared,
    // then show a PROVISIONAL LevelComplete. No network, no api.campaignComplete.
    if (offline) {
      if (!reveal.finished) {
        setIdx((i) => i + 1);
        setPhase("splash");
        return;
      }
      const total = session.rounds.length;
      const correct = offlineCorrectRef.current;
      await enqueue({
        kind: "campaign",
        client_id: crypto.randomUUID(),
        created_at: Date.now(),
        attempts: 0,
        payload: { world: session.world, level: session.level, items: offlineItemsRef.current },
      });
      markProvisionalClear(userId ?? "", session.world, session.level);
      // Synthesize a provisional completion for the screen; the server RE-SCORES on sync and is
      // authoritative (rewards + unlock finalize then). No coins/gems shown offline.
      onFinished(
        {
          world: session.world,
          level: session.level,
          title: session.title,
          is_boss: session.is_boss,
          correct,
          total,
          passed: correct >= OFFLINE_PASS_THRESHOLD,
          clear_status: null,
          coins_awarded: 0,
          daily_cap_reached: false,
          first_clear: false,
          next_level_unlocked: false,
          best_correct: correct,
        },
        { provisional: true },
      );
      return;
    }
    if (reveal.finished) {
      setPhase("settling");
      try {
        const c = await api.campaignComplete(session.entry_id);
        onFinished(c);
      } catch (err) {
        setError(errorMessage(err, t, t.campaign.errSettle));
        setPhase("error");
      }
    } else {
      setIdx((i) => i + 1);
      setPhase("splash");
    }
  }, [
    reveal,
    session.entry_id,
    session.world,
    session.level,
    session.title,
    session.is_boss,
    session.rounds.length,
    onFinished,
    t,
    offline,
    userId,
  ]);

  if (phase === "error") {
    return (
      <Centered>
        <div style={{ color: "var(--pink)", marginBottom: 16, fontWeight: 700 }}>{error}</div>
        <GoldButton idlePulse={false} onClick={onAbort} style={{ maxWidth: 240 }}>
          {t.campaign.backToCampaign}
        </GoldButton>
      </Centered>
    );
  }
  if (phase === "settling") return <Centered>{t.campaign.tallying}</Centered>;

  const round = session.rounds[idx];
  const total = session.rounds.length;
  const badge = <CampaignBadge session={session} />;

  if (phase === "reveal" && reveal) {
    return (
      <PracticeReveal
        round={round}
        reveal={reveal}
        choice={choice}
        total={total}
        current={idx}
        badge={badge}
        celebrate={celebrate}
        continueLabel={reveal.finished ? t.campaign.finishLevel : t.campaign.continue}
        onContinue={() => void onContinue()}
      />
    );
  }

  const spec = round.client_spec as { category: string; icon: string };
  const Component = getModule(round.type).Component;

  return (
    <div style={wrap}>
      {badge}
      <ProgressDots total={total} current={idx} />
      <div style={stage}>
        {phase === "splash" ? (
          <GlassCard style={{ display: "flex" }}>
            <CategorySplash
              category={spec.category}
              icon={spec.icon}
              eyebrow={t.contest.splashCategory}
            />
          </GlassCard>
        ) : (
          // The round module owns its question card; the countdown ring renders in a header bar
          // above it (unclippable). We pass the level eyebrow as in-card chrome.
          <Component
            key={idx}
            spec={round.client_spec as never}
            onComplete={onRoundComplete as never}
            eyebrow={
              <div style={{ ...eyebrow, marginBottom: 10 }}>
                {fmt(t.campaign.questionProgress, { i: idx + 1, total })}
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

function CampaignBadge({ session }: { session: CampaignStartResponse }) {
  const t = useT();
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <span
        style={{
          padding: "5px 12px",
          borderRadius: 999,
          border: `1px solid ${session.is_boss ? "rgba(255,46,77,.55)" : "var(--line)"}`,
          background: "var(--panel)",
          fontSize: 11,
          letterSpacing: 2,
          textTransform: "uppercase",
          fontWeight: 800,
          color: session.is_boss ? "var(--pink)" : "var(--brand-2)",
          display: "inline-flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <span aria-hidden className="emoji">
          {worldIcon(session.world)}
        </span>
        {session.is_boss
          ? fmt(t.campaign.badgeBoss, { title: session.title })
          : fmt(t.campaign.badgeLevel, { level: session.level, title: session.title })}
      </span>
    </div>
  );
}
