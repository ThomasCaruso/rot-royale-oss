import { useCallback, useEffect, useRef, useState } from "react";
import {
  type PracticeAnswerResponse,
  type PracticeResultResponse,
  type PracticeStartResponse,
} from "@/api/client";
import { api, type QuestionInteractionPayload } from "@/api/client";
import { nextStreak, shouldCelebrate } from "@/lib/celebrate";
import { trackInteraction } from "@/lib/interactionTracker";
import { PersonalizationDebug } from "@/screens/dev/PersonalizationDebug";
import { useT, fmt } from "@/i18n/useT";
import { refreshMe } from "@/api/session";
import { getModule } from "@/modules/registry";
import { useNetwork } from "@/store/network";
import { getPool } from "@/offline/db";
import { enqueue } from "@/offline/outbox";
import { revealFor, itemFor } from "@/offline/playEngine";
import type { OfflineRound, OfflineItem } from "@/offline/types";
import { AnswerPill, type PillState } from "@/ui/AnswerPill";
import { CategorySplash } from "@/ui/CategorySplash";
import { Confetti } from "@/ui/Confetti";
import { CountUp } from "@/ui/CountUp";
import { Display } from "@/ui/Display";
import { GlassCard } from "@/ui/GlassCard";
import { GoldButton } from "@/ui/GoldButton";
import { errorMessage } from "@/i18n/errors";

type Phase = "loading" | "splash" | "playing" | "reveal" | "result" | "error";

const wrap: React.CSSProperties = {
  width: "100%",
  maxWidth: 560,
  margin: "0 auto",
  padding: "calc(clamp(18px, 5vw, 28px) + env(safe-area-inset-top)) clamp(14px, 4vw, 20px) 48px",
  // dvh, not vh: on mobile the browser chrome makes vh taller than the visible area, which pushed
  // the card up and made the layout feel zoomed at some breakpoints.
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

// Centers the active round in the space below the badge + dots; min-height stays auto so a tall
// round grows the page and scrolls rather than clipping at the top.
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
  color: "var(--brand-2)",
};

/** Badge shown throughout the session so it's never confused with a contest. Quick Play gets its
 * own name; otherwise it names the category scope when present ("Practice · Science"), else
 * "Practice · just for fun". */
function PracticeBadge({
  category,
  mode,
}: {
  category?: string | null;
  mode?: "quick" | "starter" | null;
}) {
  const t = useT();
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <span
        style={{
          padding: "5px 12px",
          borderRadius: 999,
          border: "1px solid var(--line)",
          background: "var(--panel)",
          fontSize: 11,
          letterSpacing: 2,
          textTransform: "uppercase",
          fontWeight: 800,
          color: "var(--brand-2)",
        }}
      >
        {mode === "starter"
          ? t.brainBoost.badgeStarter
          : mode === "quick"
            ? t.practice.badgeQuick
            : category
              ? fmt(t.practice.badgeScoped, { category })
              : t.practice.badgeNoStakes}
      </span>
    </div>
  );
}

export function Practice({
  category = null,
  mode = null,
  onExit,
  onFinished,
}: {
  category?: string | null;
  // "quick" = Quick Play: the 8-question mixed-category trivia run (never ranked, never wagered).
  // "starter" = the first-run Starter Check (Brain Boost onboarding calibration round).
  mode?: "quick" | "starter" | null;
  onExit: () => void;
  // When set, the final Continue hands off to the host (e.g. the Brain Profile reveal) instead of
  // the built-in result screen.
  onFinished?: (entryId: string) => void;
}) {
  const t = useT();
  const online = useNetwork((s) => s.online);
  const [phase, setPhase] = useState<Phase>("loading");
  const [session, setSession] = useState<PracticeStartResponse | null>(null);
  // Offline play state: when the session was built from a cached pool we hold the OfflineRound[] (for
  // local reveal/record) and accumulate one OfflineItem per answered round for the outbox result.
  const [offline, setOffline] = useState(false);
  const offlineRoundsRef = useRef<OfflineRound[]>([]);
  const offlineItemsRef = useRef<OfflineItem[]>([]);
  const offlineCorrectRef = useRef(0);
  const [idx, setIdx] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [reveal, setReveal] = useState<PracticeAnswerResponse | null>(null);
  const [result, setResult] = useState<PracticeResultResponse | null>(null);
  const [error, setError] = useState("");
  const [celebrate, setCelebrate] = useState(false);
  const streakRef = useRef(0); // running consecutive-correct streak; gates confetti on the reveal
  const startedRef = useRef(false);
  const answeredRef = useRef(false); // one answer-send per round (StrictMode / module quirks)
  // Silent personalization signal for the current round, held until Continue (so it can carry the
  // explanation-read duration) or unmount (quit mid-session). Fire-and-forget; never blocks play.
  const pendingEventRef = useRef<QuestionInteractionPayload | null>(null);
  const revealAtRef = useRef(0);

  const flushInteraction = useCallback((quit: boolean) => {
    const pending = pendingEventRef.current;
    if (!pending) return;
    pendingEventRef.current = null;
    trackInteraction({
      ...pending,
      quit_after: quit,
      explanation_read_ms: pending.explanation_opened
        ? Math.max(0, Math.round(performance.now() - revealAtRef.current))
        : null,
    });
  }, []);

  // Leaving mid-session (back nav, app switch, unmount) counts as a quit signal for the round
  // whose reveal was on screen. StrictMode's double-mount is harmless: no reveal → no pending.
  useEffect(() => () => flushInteraction(true), [flushInteraction]);

  useEffect(() => {
    if (startedRef.current) return; // StrictMode double-mount guard
    startedRef.current = true;
    // Offline branch: build an in-memory session from the cached pool — never touches the network.
    if (!online) {
      getPool(category)
        .then((pool) => {
          if (!pool) {
            setError(t.practice.errNotDownloaded);
            setPhase("error");
            return;
          }
          setOffline(true);
          offlineRoundsRef.current = pool.questions;
          setSession({
            entry_id: "",
            rounds: pool.questions.map((q) => ({
              idx: q.idx,
              type: "trivia",
              client_spec: q.client_spec as unknown as Record<string, unknown>,
            })),
          });
          setPhase("splash");
        })
        .catch(() => {
          setError(t.practice.errNotDownloaded);
          setPhase("error");
        });
      return;
    }
    api
      .startPractice(category, mode)
      .then((s) => {
        setSession(s);
        setPhase("splash");
      })
      .catch((err) => {
        setError(errorMessage(err, t, t.practice.errStart));
        setPhase("error");
      });
  }, [category, mode, t, online]);

  // Reset per-round state on each new round's splash, then advance to play after a beat.
  useEffect(() => {
    if (phase !== "splash") return;
    answeredRef.current = false;
    setChoice(null);
    setReveal(null);
    const t = setTimeout(() => setPhase("playing"), 1000);
    return () => clearTimeout(t);
  }, [phase, idx]);

  // The round locked (player chose, or the module timed out): score it server-side and reveal the
  // correct answer + explanation. Practice is no-stakes, so showing the answer post-lock is fine.
  const onRoundComplete = useCallback(
    (res: unknown) => {
      if (!session || answeredRef.current) return;
      answeredRef.current = true;
      const r = res as { choice?: number; elapsed_ms?: number };
      const picked = typeof r?.choice === "number" ? r.choice : null;
      setChoice(picked);
      // Offline: score locally against the cached answer, record the choice for later sync. No
      // network, no personalization signal (a server-side thing), no api.answerPracticeRound.
      if (offline) {
        const rd = offlineRoundsRef.current[idx];
        const rv = revealFor(rd, picked);
        offlineItemsRef.current.push(itemFor(rd, picked, r?.elapsed_ms ?? 0));
        if (rv.correct) offlineCorrectRef.current += 1;
        const finished = idx === session.rounds.length - 1;
        const total = session.rounds.length;
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
          correct_count: finished ? offlineCorrectRef.current : null,
          total: finished ? total : null,
          accuracy: finished ? offlineCorrectRef.current / total : null,
          sharpness: null,
          sharpness_gained: null,
        });
        setPhase("reveal");
        return;
      }
      api
        .answerPracticeRound(session.entry_id, idx, res as Record<string, unknown>)
        .then((rev) => {
          // Advance the streak, then gate confetti to milestones + the final question. The server
          // flags `finished` on the last round; fall back to the index for safety.
          const streak = nextStreak(streakRef.current, rev.correct);
          streakRef.current = streak;
          // Stage the personalization signal; it flushes on Continue (with the explanation-read
          // duration) or on unmount (as a quit). The reveal always shows the explanation panel
          // when one exists, so "opened" = "an explanation was on screen".
          revealAtRef.current = performance.now();
          pendingEventRef.current = {
            mode: category ? "category" : mode === "quick" ? "quick" : "practice",
            entry_id: session.entry_id,
            idx,
            explanation_opened: Boolean(rev.explanation),
            // is_correct / response_ms / timed_out / selected_answer / streak_* are now captured
            // server-side at scoring time (see backend record_answer_signal); the client only
            // supplies the engagement signals the server can't see.
          };
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
          setError(errorMessage(err, t, t.practice.errMidRound));
          setPhase("error");
        });
    },
    [session, idx, t, category, mode, offline],
  );

  // Self-paced: the player reads the feedback, then taps Continue (no auto-advance timer).
  const onContinue = useCallback(async () => {
    if (!session || !reveal) return;
    // Offline: on the final round, queue one practice result to the outbox and show the LOCAL result
    // screen. No onFinished (needs a server entry_id), no refreshMe, no network of any kind.
    if (offline) {
      if (!reveal.finished) {
        setIdx((i) => i + 1);
        setPhase("splash");
        return;
      }
      const total = session.rounds.length;
      const correct = offlineCorrectRef.current;
      await enqueue({
        kind: "practice",
        client_id: crypto.randomUUID(),
        created_at: Date.now(),
        attempts: 0,
        payload: { mode: mode ?? "practice", category, items: offlineItemsRef.current },
      });
      setResult({
        entry_id: "",
        accuracy: total > 0 ? correct / total : 0,
        correct,
        total,
        sharpness: 0,
        sharpness_gained: 0,
        rounds: [],
      });
      setPhase("result");
      return;
    }
    flushInteraction(false); // they stayed through the reveal — not a quit
    if (reveal.finished && onFinished) {
      await refreshMe().catch(() => undefined); // sharpness gain still lands in the store
      onFinished(session.entry_id);
      return;
    }
    if (reveal.finished) {
      setResult({
        entry_id: session.entry_id,
        accuracy: reveal.accuracy ?? 0,
        correct: reveal.correct_count ?? 0,
        total: reveal.total ?? session.rounds.length,
        sharpness: reveal.sharpness ?? 0,
        sharpness_gained: reveal.sharpness_gained ?? 0,
        rounds: [],
      });
      setPhase("result");
      await refreshMe(); // so the hub's sharpness stat reflects the gain
    } else {
      setIdx((i) => i + 1);
      setPhase("splash");
    }
  }, [session, reveal, flushInteraction, onFinished, offline, mode, category]);

  if (phase === "loading") return <Centered>{t.practice.settingUp}</Centered>;
  if (phase === "error") {
    return (
      <Centered>
        <div style={{ color: "var(--pink)", marginBottom: 16, fontWeight: 700 }}>{error}</div>
        <GoldButton idlePulse={false} onClick={onExit} style={{ maxWidth: 240 }}>
          {t.practice.backToHub}
        </GoldButton>
      </Centered>
    );
  }
  if (phase === "result" && result)
    return (
      <PracticeResultView
        result={result}
        category={category}
        mode={mode}
        offline={offline}
        onExit={onExit}
      />
    );
  if (!session) return <Centered>…</Centered>;

  const round = session.rounds[idx];

  if (phase === "reveal" && reveal) {
    return (
      <PracticeReveal
        round={round}
        reveal={reveal}
        choice={choice}
        category={category}
        mode={mode}
        total={session.rounds.length}
        current={idx}
        celebrate={celebrate}
        onContinue={() => void onContinue()}
      />
    );
  }

  const spec = round.client_spec as { category: string; icon: string };
  const Component = getModule(round.type).Component;

  return (
    <div style={wrap}>
      <PracticeBadge category={category} mode={mode} />
      <ProgressDots total={session.rounds.length} current={idx} />
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
          // above it (unclippable). We pass the round eyebrow as in-card chrome.
          <Component
            key={idx}
            spec={round.client_spec as never}
            onComplete={onRoundComplete as never}
            eyebrow={
              <div style={{ ...eyebrow, color: "var(--muted)", marginBottom: 10 }}>
                {fmt(t.practice.roundOf, { i: idx + 1, n: session.rounds.length })}
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

/**
 * Lesson-mode reveal (practice only). Green/red on the player's choice, the correct option
 * highlighted (reusing the contest AnswerPill states), and an "Here's why" explanation panel — the
 * getting-smarter payload. Self-paced: a Continue button, no auto-advance timer.
 */
export function PracticeReveal({
  round,
  reveal,
  choice,
  category,
  mode,
  total,
  current,
  onContinue,
  badge,
  continueLabel,
  celebrate = false,
}: {
  round: PracticeStartResponse["rounds"][number];
  reveal: PracticeAnswerResponse;
  choice: number | null;
  category?: string | null;
  mode?: "quick" | "starter" | null;
  total: number;
  current: number;
  onContinue: () => void;
  // Optional overrides so Campaign Mode can reuse this lesson reveal with its own chrome.
  badge?: React.ReactNode;
  continueLabel?: string;
  // The host decides when a correct answer earns confetti (streak milestone OR final question). A
  // plain correct answer still gets the "Correct!" pop + explanation — only the confetti is gated.
  celebrate?: boolean;
}) {
  const t = useT();
  const spec = round.client_spec as { prompt?: string; options?: string[] };
  const correctIndex =
    typeof reveal.answer.correctIndex === "number" ? (reveal.answer.correctIndex as number) : null;

  return (
    <div style={wrap}>
      {/* The rewarding beat: confetti reserved for streak milestones + the final question (host
          decides via `celebrate`; self-disabled under reduced motion). Correctness is only revealed
          here, after the server scores the locked answer — never during play. */}
      {celebrate && <Confetti burstKey={current + 1} count={90} />}
      {badge ?? <PracticeBadge category={category} mode={mode} />}
      <ProgressDots total={total} current={current} />

      <GlassCard style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Display
          className={reveal.correct ? "rr-pop" : "rr-shake"}
          style={{ fontSize: 26, color: reveal.correct ? "var(--lime)" : "var(--pink)" }}
        >
          {reveal.correct ? t.practice.correct : t.practice.notQuite}
        </Display>
        {spec.prompt && (
          <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>{spec.prompt}</div>
        )}
        {spec.options && correctIndex !== null ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {spec.options.map((opt, i) => {
              let state: PillState = "dim";
              if (i === correctIndex) state = "correct";
              else if (i === choice) state = "wrong";
              return <AnswerPill key={i} index={i} label={opt} state={state} disabled />;
            })}
          </div>
        ) : (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            {reveal.correct ? t.practice.nailedIt : t.practice.notThisTime}
          </div>
        )}
      </GlassCard>

      {/* The learn-this panel — gold-tinted so it reads as the takeaway, not just more chrome. */}
      {reveal.explanation && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "14px 16px",
            borderRadius: 18,
            border: "1px solid rgba(255,201,30,.35)",
            background: "linear-gradient(180deg, rgba(45,32,8,.5), rgba(24,14,2,.6))",
            boxShadow: "0 0 18px rgba(255,201,30,.1)",
          }}
        >
          <div style={{ ...eyebrow, color: "var(--amber)" }}>
            <span className="emoji">💡</span> {t.practice.heresWhy}
          </div>
          <div style={{ fontSize: 14.5, lineHeight: 1.55 }}>{reveal.explanation}</div>
        </div>
      )}

      <GoldButton onClick={onContinue}>
        {continueLabel ?? (reveal.finished ? t.practice.seeResults : t.practice.continue)}
      </GoldButton>
    </div>
  );
}

export function ProgressDots({ total, current }: { total: number; current: number }) {
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
      {Array.from({ length: total }, (_, k) => (
        <span
          key={k}
          style={{
            width: k === current ? 24 : 8,
            height: 8,
            borderRadius: 4,
            background:
              k < current ? "var(--lime)" : k === current ? "var(--amber)" : "var(--line)",
            boxShadow: k === current ? "0 0 10px var(--amber)" : "none",
            transition: "width 150ms",
          }}
        />
      ))}
    </div>
  );
}

function PracticeResultView({
  result,
  category,
  mode,
  offline = false,
  onExit,
}: {
  result: PracticeResultResponse;
  category?: string | null;
  mode?: "quick" | "starter" | null;
  // Offline result: there is no server sharpness — show accuracy + a "we'll sync" note instead.
  offline?: boolean;
  onExit: () => void;
}) {
  const t = useT();
  const pct = Math.round(result.accuracy * 100);
  return (
    <div style={wrap}>
      {!offline && result.sharpness_gained > 0 && <Confetti burstKey={result.entry_id.length} />}
      <PracticeBadge category={category} mode={mode} />
      <div style={{ textAlign: "center", marginTop: 8 }}>
        <div style={eyebrow}>{t.practice.complete}</div>
        <Display gold className="rr-pop" style={{ fontSize: 76 }}>
          <CountUp value={pct} />%
        </Display>
        <div style={{ color: "var(--muted)", fontSize: 14 }}>
          {fmt(t.practice.accuracySummary, { correct: result.correct, total: result.total })}
        </div>
      </div>

      {offline ? (
        <GlassCard style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>{t.practice.offlineSyncNote}</div>
        </GlassCard>
      ) : (
        <GlassCard style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>
            <span style={{ color: "var(--brand-2)" }}>+{result.sharpness_gained}</span>{" "}
            {t.practice.sharpness}
          </div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            {fmt(t.practice.nowAt, { sharpness: result.sharpness })}
          </div>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
            {t.practice.honesty}
          </div>
        </GlassCard>
      )}

      <GoldButton onClick={onExit}>{t.practice.backToHubCaps}</GoldButton>
      {/* Dev-only taste-profile inspector: renders nothing unless VITE_PERSONALIZATION_DEBUG. */}
      <PersonalizationDebug />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        color: "var(--muted)",
        fontWeight: 700,
        padding: 24,
      }}
    >
      {children}
    </main>
  );
}
