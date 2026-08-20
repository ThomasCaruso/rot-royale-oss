import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DuelResult, type DuelRoundResponse, type RoundSpec } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import type { MultipleChoiceSpec } from "@/modules/multipleChoice/MultipleChoiceRound";
import { MultipleChoiceRound } from "@/modules/multipleChoice/MultipleChoiceRound";
import { outcomeCopy, toneColor } from "@/screens/duel/duelOutcome";
import { AnswerPill, type PillState } from "@/ui/AnswerPill";
import { Confetti } from "@/ui/Confetti";
import { CountUp } from "@/ui/CountUp";
import { Display } from "@/ui/Display";
import { GemIcon } from "@/ui/GemIcon";
import { GlassCard } from "@/ui/GlassCard";
import { GoldButton } from "@/ui/GoldButton";
import { errorMessage } from "@/i18n/errors";

const TOTAL_NORMAL_ROUNDS = 7; // best-of-7; idx >= 7 is sudden death
const AUTO_ADVANCE_MS = 1600;

/**
 * Duel play — the best-of-7 head-to-head round loop. Immersive full screen (no bottom nav), a
 * two-phase per-round rhythm:
 *   playing  → MultipleChoiceRound (its own 10s ring timer; self-completes on tap/timeout)
 *   reveal   → the head-to-head outcome banner (win green / lose red / no-point neutral), the answer
 *              pills with the server's correct index, and the updated YOU x — y RIVAL line.
 *
 * Anti-cheat parity with the contest: the client never holds the answer mid-round; correctness +
 * the rival's result come back from `submitDuelRound` only AFTER the lock. The reveal auto-advances
 * (~1.6s) but a Continue button lets the player push on immediately.
 */
export function DuelPlay({
  matchId,
  rounds,
  poolGems,
  rivalTier,
  onFinished,
  onExit,
}: {
  matchId: string;
  rounds: RoundSpec[];
  duelType: string;
  entryGems: number;
  poolGems: number;
  rivalTier: string;
  onFinished: (result: DuelResult) => void;
  onExit: () => void;
}) {
  const t = useT();
  const [idx, setIdx] = useState(0);
  const [reveal, setReveal] = useState<DuelRoundResponse | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [error, setError] = useState("");
  // Whether the NEXT round (the one we'll show after advancing) is sudden death — drives the eyebrow.
  const [suddenDeath, setSuddenDeath] = useState(false);

  const submittingRef = useRef(false); // one submit per round
  const finishedRef = useRef(false); // never call onFinished twice
  const advancingRef = useRef(false); // one advance per reveal (manual Continue + auto-advance share advance())

  // The pre-reveal scoreline (drives the in-play versus bar). Updates from the latest reveal so the
  // playing eyebrow of round N reflects the ledger after round N-1.
  const [userWins, setUserWins] = useState(0);
  const [rivalWins, setRivalWins] = useState(0);

  const handleComplete = useCallback(
    (result: { choice: number | null; elapsed_ms: number }) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setChoice(result.choice);
      api
        .submitDuelRound(matchId, idx, result as unknown as Record<string, unknown>)
        .then((res) => {
          setUserWins(res.user_round_wins);
          setRivalWins(res.rival_round_wins);
          setReveal(res);
        })
        .catch((err) => {
          setError(errorMessage(err, t, t.duel.loadError));
        });
    },
    [matchId, idx, t],
  );

  // Advance out of the reveal: either finish the duel or step to the next round. Guarded against a
  // double-advance — manual Continue and the auto-advance timer both call this, and the timer's
  // callback can already be dequeued at the instant the player taps Continue. advancingRef makes the
  // body run at most once per reveal; it's reset when the next round's reveal is cleared below (a new
  // reveal then re-arms the guard), so it never blocks the legitimate advance on the next round.
  const advance = useCallback(() => {
    const res = reveal;
    if (!res) return;
    if (advancingRef.current) return;
    advancingRef.current = true;
    if (res.finished) {
      if (finishedRef.current) return;
      finishedRef.current = true;
      if (res.result) onFinished(res.result);
      return;
    }
    setSuddenDeath(res.next === "sudden_death");
    setReveal(null);
    setChoice(null);
    submittingRef.current = false;
    advancingRef.current = false;
    setIdx((i) => i + 1);
  }, [reveal, onFinished]);

  // Auto-advance the reveal after a beat (cleared if the player taps Continue first).
  useEffect(() => {
    if (!reveal) return;
    const id = window.setTimeout(advance, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(id);
  }, [reveal, advance]);

  if (error) {
    return (
      <Shell onExit={onExit} exitLabel={t.duel.exit}>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            textAlign: "center",
          }}
        >
          <div style={{ color: "var(--pink)", fontWeight: 800, fontSize: 16 }}>{error}</div>
          <GoldButton idlePulse={false} onClick={onExit} style={{ maxWidth: 240 }}>
            {t.duel.exit}
          </GoldButton>
        </div>
      </Shell>
    );
  }

  // Guard against an out-of-range idx (defensive — the server's `finished` ends the loop first).
  const round = rounds[idx];
  if (!round) {
    return (
      <Shell onExit={onExit} exitLabel={t.duel.exit}>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
            fontWeight: 700,
          }}
        >
          {t.duel.startingDuel}
        </div>
      </Shell>
    );
  }

  const isSuddenDeath = suddenDeath || idx >= TOTAL_NORMAL_ROUNDS;
  const score = (
    <DuelScore
      userWins={reveal ? reveal.user_round_wins : userWins}
      rivalWins={reveal ? reveal.rival_round_wins : rivalWins}
      roundIdx={idx}
      isSuddenDeath={isSuddenDeath}
      rivalTier={rivalTier}
      poolGems={poolGems}
      scoredSide={reveal ? scoredSide(reveal.outcome) : null}
    />
  );

  return (
    <Shell onExit={onExit} exitLabel={t.duel.exit}>
      {reveal ? (
        <DuelReveal
          reveal={reveal}
          spec={round.client_spec as unknown as MultipleChoiceSpec}
          choice={choice}
          score={score}
          onContinue={advance}
        />
      ) : (
        <MultipleChoiceRound
          key={idx}
          spec={round.client_spec as unknown as MultipleChoiceSpec}
          onComplete={handleComplete}
          eyebrow={score}
        />
      )}
    </Shell>
  );
}

/** user_win → "user" scored; rival_win → "rival"; no_point → nobody. */
function scoredSide(outcome: string): "user" | "rival" | null {
  if (outcome === "user_win") return "user";
  if (outcome === "rival_win") return "rival";
  return null;
}

/**
 * The versus scoreline — YOU n — m RIVAL as a two-sided bar, your side vs the rival side (tagged
 * with its tier label). Below it: the question counter (or a SUDDEN DEATH intensity treatment) and
 * a subtle Gem-pool chip for gem duels. This is the eyebrow inside the question card AND the header
 * of the reveal, so the head-to-head state is always on screen.
 */
export function DuelScore({
  userWins,
  rivalWins,
  roundIdx,
  isSuddenDeath,
  rivalTier,
  poolGems,
  scoredSide,
}: {
  userWins: number;
  rivalWins: number;
  roundIdx: number;
  isSuddenDeath: boolean;
  rivalTier: string;
  poolGems: number;
  scoredSide?: "user" | "rival" | null;
}) {
  const t = useT();
  const tierLabel = (t.duel.tierLabel as Record<string, string>)[rivalTier] ?? rivalTier;
  const counter = isSuddenDeath
    ? t.duel.suddenDeath
    : fmt(t.duel.questionOf, { n: Math.min(roundIdx + 1, TOTAL_NORMAL_ROUNDS), total: TOTAL_NORMAL_ROUNDS });

  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Side label={t.duel.you} wins={userWins} accent="var(--lime)" align="left" bump={scoredSide === "user"} />
        <span
          aria-hidden
          className="display"
          style={{ color: "var(--muted)", fontSize: 13, letterSpacing: 1 }}
        >
          VS
        </span>
        <Side
          label={t.duel.rivalShort}
          sub={tierLabel}
          wins={rivalWins}
          accent="var(--pink)"
          align="right"
          bump={scoredSide === "rival"}
        />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          marginTop: 8,
        }}
      >
        <span
          className={isSuddenDeath ? "display rr-pop" : undefined}
          style={{
            fontSize: isSuddenDeath ? 13 : 11,
            fontWeight: 800,
            letterSpacing: isSuddenDeath ? 2 : 1.5,
            textTransform: "uppercase",
            color: isSuddenDeath ? "var(--pink)" : "var(--muted)",
            textShadow: isSuddenDeath ? "0 0 14px color-mix(in srgb, var(--pink) 60%, transparent)" : "none",
          }}
        >
          {counter}
        </span>
        {poolGems > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 800,
              color: "var(--cyan)",
            }}
          >
            <GemIcon size={12} />
            {poolGems}
          </span>
        )}
      </div>
    </div>
  );
}

/** One side of the versus bar: a label (+ optional tier sub) and the round-win count. */
function Side({
  label,
  sub,
  wins,
  accent,
  align,
  bump,
}: {
  label: string;
  sub?: string;
  wins: number;
  accent: string;
  align: "left" | "right";
  bump?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "left" ? "flex-start" : "flex-end",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 7,
          flexDirection: align === "right" ? "row-reverse" : "row",
        }}
      >
        <span
          className="display"
          style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 1, color: "var(--text)" }}
        >
          {label}
        </span>
        <span
          className={bump ? "display rr-pop" : "display"}
          style={{
            fontSize: 22,
            lineHeight: 1,
            color: accent,
            textShadow: `0 0 14px color-mix(in srgb, ${accent} 55%, transparent)`,
          }}
        >
          {bump ? <CountUp value={wins} durationMs={500} /> : wins}
        </span>
      </div>
      {sub && (
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", marginTop: 2 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

/** Format a millisecond delta as a short "+0.4s" style string for the speed-win sub-line. */
function speedDelta(yourMs: number, rivalMs: number): string {
  const delta = Math.abs(rivalMs - yourMs) / 1000;
  return `+${delta.toFixed(1)}s`;
}

/**
 * The post-lock reveal: the head-to-head outcome banner + answer pills (correct index green, the
 * user's wrong pick red) + the updated scoreline, mirroring the contest reveal but framed as a duel
 * result. A confetti burst fires only when the user scored (reduced-motion-aware via Confetti).
 */
export function DuelReveal({
  reveal,
  spec,
  choice,
  score,
  onContinue,
}: {
  reveal: DuelRoundResponse;
  spec: MultipleChoiceSpec;
  choice: number | null;
  score: React.ReactNode;
  onContinue: () => void;
}) {
  const t = useT();
  const copy = outcomeCopy(t, reveal.outcome, reveal.outcome_reason);
  const won = reveal.outcome === "user_win";

  const correctIndex =
    typeof (reveal.answer as { correctIndex?: unknown }).correctIndex === "number"
      ? ((reveal.answer as { correctIndex: number }).correctIndex)
      : null;

  // Append the speed delta to a speed win so "you were faster" feels earned.
  const sub =
    won && reveal.outcome_reason === "speed_gap"
      ? `${copy.sub} (${speedDelta(reveal.your_time_ms, reveal.rival_time_ms)})`
      : copy.sub;

  return (
    <GlassCard style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {won && <Confetti burstKey={reveal.idx + 1} count={80} />}
      {score}
      <div style={{ textAlign: "center" }}>
        <Display
          className={won ? "rr-pop" : reveal.outcome === "rival_win" ? "rr-shake" : undefined}
          style={{ fontSize: 28, color: toneColor(copy.tone) }}
        >
          {copy.title}
        </Display>
        <div style={{ color: "var(--muted)", fontSize: 13.5, fontWeight: 600, marginTop: 4 }}>
          {sub}
        </div>
      </div>
      {spec.options && correctIndex !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {spec.options.map((opt, i) => {
            let state: PillState = "dim";
            if (i === correctIndex) state = "correct";
            else if (i === choice) state = "wrong";
            return <AnswerPill key={i} index={i} label={opt} state={state} disabled />;
          })}
        </div>
      )}
      <GoldButton idlePulse={false} onClick={onContinue}>
        {reveal.finished ? t.duel.viewResult : t.duel.continueRound}
      </GoldButton>
    </GlassCard>
  );
}

/**
 * Immersive duel shell: full-height, centered, max-width column with safe-area insets and a top
 * Exit affordance (abandons — the backend forfeits the match; nothing special to do here). No bottom
 * nav (this is a focused, head-to-head session).
 */
function Shell({
  children,
  onExit,
  exitLabel,
}: {
  children: React.ReactNode;
  onExit: () => void;
  exitLabel: string;
}) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        maxWidth: 480,
        margin: "0 auto",
        padding:
          "calc(env(safe-area-inset-top) + 14px) clamp(14px, 4vw, 20px) calc(env(safe-area-inset-bottom) + 24px)",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
        <button
          type="button"
          onClick={onExit}
          style={{
            padding: "7px 14px",
            borderRadius: 12,
            border: "1px solid var(--line)",
            background: "color-mix(in srgb, var(--panel) 70%, transparent)",
            color: "var(--muted)",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {exitLabel}
        </button>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {children}
      </div>
    </main>
  );
}
