import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Dict } from "@/i18n/en";
import { type ChallengeCreateResponse, type EnterResponse } from "@/api/client";
import { api } from "@/api/client";
import { nextStreak, shouldCelebrate } from "@/lib/celebrate";
import { feedback } from "@/lib/haptics";
import { initialPacing, pacingReducer, type RevealData } from "@/lib/pacing";
import { roundFraming, type RoundBlockKey } from "@/lib/rounds";
import { buildRotReport, type RoundLog } from "@/lib/rotReport";
import { saveRotReport } from "@/lib/rotReportStore";
import { formatLocalTime } from "@/lib/time";
import { useWindowMeta } from "@/lib/useWindowMeta";
import { warmRoundMedia } from "@/lib/warmRoundMedia";
import { RotReport } from "@/screens/results/RotReport";
import { RankedSaveGate } from "@/screens/brainboost/RankedSaveGate";
import { useSessionStore } from "@/store/session";
import { useReducedMotion } from "@/ui/useReducedMotion";
import { getModule, tryGetModule } from "@/modules/registry";
import { AnswerPill, type PillState } from "@/ui/AnswerPill";
import { CategorySplash } from "@/ui/CategorySplash";
import { Confetti } from "@/ui/Confetti";
import { CountUp } from "@/ui/CountUp";
import { Display } from "@/ui/Display";
import { GlassCard } from "@/ui/GlassCard";
import { GoldButton } from "@/ui/GoldButton";
import { useT, fmt } from "@/i18n/useT";
import { errorMessage } from "@/i18n/errors";

const SPLASH_MS = 1000;
const REVEAL_MS = 3000;

const wrap: React.CSSProperties = {
  width: "100%",
  maxWidth: 560,
  margin: "0 auto",
  padding: "calc(clamp(18px, 5vw, 28px) + env(safe-area-inset-top)) clamp(14px, 4vw, 20px) 48px",
  // dvh, not vh: on mobile the browser chrome makes vh taller than the visible area, which is what
  // made the card drift up and the layout feel zoomed at some breakpoints.
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

/**
 * What the splash announces for a round that has no trivia category.
 *
 * The interactive cognition rounds hardcode their own English labels ("Spot the change",
 * "Estimate") because modules carry no i18n — so the localized copy has to live out here, on the
 * screen, and be handed in. An unknown type falls back to the generic round word rather than
 * rendering an empty beat: `tryGetModule`'s discipline, applied to copy.
 */
function splashVerb(type: string, t: Dict): string {
  if (type === "change_detection") return t.contest.splashSpotTheChange;
  if (type === "estimate") return t.contest.splashEstimate;
  return t.contest.splashRound;
}

// The active round (splash / question / reveal) is vertically centered in the space below the
// progress dots; min-height stays auto so a tall question grows the page and scrolls rather than
// clipping at the top.
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

/** Loader: enter the contest once, then hand off to the paced player. */
export function Contest({
  windowId,
  onExit,
  onPractice,
}: {
  windowId: string;
  onExit: () => void;
  onPractice: () => void;
}) {
  const t = useT();
  const [entry, setEntry] = useState<EnterResponse | null>(null);
  const [error, setError] = useState("");
  const enteredRef = useRef(false);

  useEffect(() => {
    if (enteredRef.current) return; // StrictMode + one-entry-per-window guard
    enteredRef.current = true;
    api
      .enter(windowId)
      .then(setEntry)
      .catch((err) =>
        setError(errorMessage(err, t, t.contest.enterError)),
      );
  }, [windowId, t]);

  if (error) {
    return (
      <Centered>
        <div style={{ color: "var(--pink)", marginBottom: 16, fontWeight: 700 }}>{error}</div>
        <GoldButton idlePulse={false} onClick={onExit} style={{ maxWidth: 240 }}>
          {t.contest.backToHub}
        </GoldButton>
      </Centered>
    );
  }
  if (!entry) return <Centered>{t.contest.entering}</Centered>;
  return <ContestPlay entry={entry} onExit={onExit} onPractice={onPractice} />;
}

function ContestPlay({
  entry,
  onExit,
  onPractice,
}: {
  entry: EnterResponse;
  onExit: () => void;
  onPractice: () => void;
}) {
  const t = useT();
  const [pacing, dispatch] = useReducer(pacingReducer, entry.rounds.length, initialPacing);

  // Pull the run's images and clips down while round 1 is on screen, so a change or video round
  // later in the run does not stall on a cold fetch. Best-effort and cancelled on unmount.
  useEffect(() => warmRoundMedia(entry.rounds), [entry.rounds]);
  const [choice, setChoice] = useState<number | null>(null);
  // What the module itself reported at completion. The generic reveal only needs `choice`, but a
  // module-owned reveal needs the module's own memory of the round (the tap that was made, the
  // final guess) — nothing else on the wire carries it.
  const [lastResult, setLastResult] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  // Running consecutive-correct streak across this run; gates confetti on the reveal (milestones +
  // final question only). `celebrate` is the resolved per-reveal flag handed to RevealView.
  const streakRef = useRef(0);
  const [celebrate, setCelebrate] = useState(false);

  const answeredRef = useRef(false); // one answer-send per round
  // Ranked permanence gate: a GUEST finishing a ranked run sees the save-profile gate once —
  // their score only survives settlement if the profile is saved. "Later" continues to the
  // normal report; play itself is never blocked.
  const isGuest = useSessionStore((s) => s.me?.is_guest ?? false);
  const [gateDismissed, setGateDismissed] = useState(false);
  // Per-round outcome log accumulated across the run — the source for the INSTANT Rot Report shown on
  // finish (own-run only: correctness from the server reveal, client-measured time, the round's
  // category). One push per round (guarded by answeredRef), so StrictMode never double-logs.
  const roundLogRef = useRef<RoundLog[]>([]);
  const round = entry.rounds[pacing.idx];

  // Reset per-round local state whenever a new round's splash begins.
  useEffect(() => {
    if (pacing.phase === "splash") {
      answeredRef.current = false;
      setChoice(null);
      setLastResult({});
    }
  }, [pacing.phase, pacing.idx]);

  // Phase-scoped timers (splash / reveal). None span phases, so phase-keyed effects with cleanup
  // are correct. `holding` has no timer — it ends the moment the server answer arrives (instant
  // reveal). Modules self-complete on their own timeout (as in Practice), so no backstop timer here.
  useEffect(() => {
    if (pacing.phase === "splash") {
      const id = window.setTimeout(() => dispatch({ type: "SPLASH_DONE" }), SPLASH_MS);
      return () => window.clearTimeout(id);
    }
    if (pacing.phase === "reveal") {
      const id = window.setTimeout(() => dispatch({ type: "REVEAL_DONE" }), REVEAL_MS);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [pacing.phase, pacing.idx]);

  // NB: the run finishing does NOT show the dramatic results — those only exist after the WINDOW
  // closes and settlement runs (shown via the Royale Results auto-reveal on next open). Here we show
  // only minimal, honest post-run feedback (see ScoreBanked below).

  // The round locked (player chose, or the module timed out): record the choice, lock the rhythm,
  // and send the answer. The reveal renders as soon as this response arrives (right/wrong, no delay).
  const onRoundComplete = useCallback(
    (result: unknown) => {
      if (answeredRef.current) return; // guard double-complete (StrictMode / module quirks)
      answeredRef.current = true;
      const r = result as { choice?: number; elapsed_ms?: number };
      setChoice(typeof r?.choice === "number" ? r.choice : null);
      setLastResult((result ?? {}) as Record<string, unknown>);
      // Capture the client-side facts for this round NOW (before the await): the measured answer time
      // (null when the module reports none / the round timed out) and the trivia category.
      const elapsedMs = typeof r?.elapsed_ms === "number" ? r.elapsed_ms : null;
      const category =
        (entry.rounds[pacing.idx]?.client_spec as { category?: string } | undefined)?.category ??
        null;
      dispatch({ type: "LOCKED" });
      api
        .answerRound(entry.entry_id, pacing.idx, result as Record<string, unknown>)
        .then((rev: RevealData) => {
          // §5f second-chance: a wrong first pick on a Daily Royale trivia round doesn't finalize —
          // the server greys `eliminated` and gives a retry window. Re-arm the SAME round (no reveal,
          // no log/streak yet) and let the player pick once more for half points.
          if (rev.retry_available && typeof rev.eliminated === "number") {
            answeredRef.current = false; // allow the second pick
            dispatch({
              type: "RETRY",
              eliminated: rev.eliminated,
              // Fallback only — the server is authoritative (TRIVIA_RETRY_MS) and is what the
              // deadline is actually enforced against. Kept in step so a missing field can't
              // hand the player a shorter window than the server is honouring.
              retryMs: rev.retry_ms ?? 8000,
            });
            return;
          }
          // Log this round's outcome for the instant Rot Report (server-canonical correctness).
          roundLogRef.current.push({ correct: rev.correct, elapsedMs, category });
          // Advance the running streak, then decide whether THIS correct answer earns confetti
          // (milestone streak, or the final question). Wrong answers reset the streak.
          const streak = nextStreak(streakRef.current, rev.correct);
          streakRef.current = streak;
          setCelebrate(
            shouldCelebrate({
              correct: rev.correct,
              streak,
              isFinal: pacing.idx === entry.rounds.length - 1,
            }),
          );
          dispatch({ type: "REVEAL_READY", reveal: rev });
        })
        .catch((err) =>
          setError(errorMessage(err, t, t.contest.lostConnection)),
        );
    },
    [entry.entry_id, entry.rounds, pacing.idx, t],
  );

  if (error) {
    return (
      <Centered>
        <div style={{ color: "var(--pink)", marginBottom: 16, fontWeight: 700 }}>{error}</div>
        <GoldButton idlePulse={false} onClick={onExit} style={{ maxWidth: 240 }}>
          {t.contest.backToHub}
        </GoldButton>
      </Centered>
    );
  }

  // Run complete → the INSTANT personal Rot Report (own-run score/timing/title + share). The 24h ranked
  // placement is NOT shown here (it isn't known until settlement) — the report surfaces it as a clearly
  // separated "Daily result pending" strip. This must come before any `round`-dependent render (idx is
  // past the last round).
  if (pacing.phase === "finished") {
    if (isGuest && !gateDismissed) {
      return (
        <RankedSaveGate
          onDone={() => setGateDismissed(true)}
          onLater={() => setGateDismissed(true)}
        />
      );
    }
    return (
      <RotReportFinish
        entryId={entry.entry_id}
        windowId={entry.window_id}
        log={roundLogRef.current}
        total={entry.rounds.length}
        onExit={onExit}
        onPractice={onPractice}
      />
    );
  }

  const Component = getModule(round.type).Component;
  // OPTIONAL, and the type used to say otherwise. Trivia rounds carry a category and an icon; the
  // interactive cognition rounds carry neither. Declaring them required is what let the splash be
  // written as `spec.category && <CategorySplash/>` without anyone noticing it renders nothing at
  // all on a change or estimate round. Line 192 already had this right.
  const spec = round.client_spec as { category?: string; icon?: string };
  const framing = roundFraming(pacing.idx, entry.rounds.length);

  return (
    <div style={wrap}>
      <RoundProgress total={entry.rounds.length} current={pacing.idx} />

      <div style={stage}>
        {pacing.phase === "splash" && (
          /* A SQUARE, and always the same square.
           *
           * Two faults, one cause. The card's height came from `CategorySplash`'s `flex: 1`, so it
           * was whatever the stage happened to give it — a different size on different screens and
           * different rounds. And the splash was gated on `spec.category`, which the interactive
           * cognition rounds do not have: on a change or estimate round this card rendered
           * COMPLETELY EMPTY. That is the blank beat that shows up around the image round.
           *
           * `aspectRatio: 1` fixes the shape, and the fallback below fixes the emptiness: a round
           * with no category announces what it IS instead. A splash that announces nothing is worse
           * than no splash at all — it reads as the game having lost its place. */
          <GlassCard
            style={{
              aspectRatio: "1 / 1",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 12,
              overflow: "hidden",
            }}
          >
            {framing.isBlockStart && <RoundBanner blockKey={framing.blockKey} />}
            <CategorySplash
              category={spec.category ?? splashVerb(round.type, t)}
              icon={spec.icon ?? "🧠"}
              eyebrow={spec.category ? t.contest.splashCategory : t.contest.splashRound}
            />
          </GlassCard>
        )}

        {(pacing.phase === "playing" || pacing.phase === "holding") && (
          // The round module owns its own question card; we hand it the round eyebrow + (while
          // holding) the "locked in" note as in-card chrome. The countdown ring renders in a header
          // BAR above that card, so its glow halo is never clipped (PR: definitive timer-ring fix).
          <Component
            key={pacing.idx}
            spec={round.client_spec as never}
            onComplete={onRoundComplete as never}
            // §5f: on a wrong first pick these re-arm the trivia round (grey the option, +retry window).
            // Other modules ignore them.
            eliminated={pacing.retry?.eliminated ?? null}
            retryMs={pacing.retry?.retryMs}
            notice={pacing.retry ? <RetryNotice /> : null}
            eyebrow={
              <div style={{ ...eyebrow, color: "var(--muted)", marginBottom: 10 }}>
                {fmt(t.contest.roundProgress, {
                  round: framing.roundNumber,
                  total: framing.totalBlocks,
                  q: framing.questionInBlock,
                  qtotal: framing.questionsInThisBlock,
                })}
              </div>
            }
            footer={
              pacing.phase === "holding" ? (
                <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", marginTop: 12 }}>
                  {t.contest.lockedIn}
                </div>
              ) : undefined
            }
          />
        )}

        {pacing.phase === "reveal" && pacing.reveal && (
          <RevealView
            round={round}
            reveal={pacing.reveal}
            choice={choice}
            result={lastResult}
            celebrate={celebrate}
          />
        )}
      </div>
    </div>
  );
}

export function RevealView({
  round,
  reveal,
  choice,
  result = {},
  celebrate = false,
}: {
  round: EnterResponse["rounds"][number];
  reveal: RevealData;
  choice: number | null;
  /** What the round module reported at completion — its own memory of what the player did. */
  result?: Record<string, unknown>;
  // Confetti is gated to streak milestones + the final question (the host decides); a plain correct
  // answer still gets the "Correct!" pop + points count-up below, just no confetti.
  celebrate?: boolean;
}) {
  const t = useT();
  const spec = round.client_spec as { prompt?: string; options?: string[] };
  const correctIndex =
    typeof reveal.answer.correctIndex === "number" ? (reveal.answer.correctIndex as number) : null;
  // tryGetModule, not getModule: an unrecognised type must cost us the reveal, not the screen.
  const ModuleReveal = tryGetModule(round.type)?.Reveal;

  // The outcome deserves its own feel, distinct from the tap that caused it: iOS success/error
  // notification haptics, which are a pattern rather than a single knock. Keyed on the round index
  // so it fires ONCE per reveal, not on every re-render of this card.
  useEffect(() => {
    feedback(reveal.correct ? "success" : "error");
  }, [reveal.idx, reveal.correct]);

  return (
    <GlassCard style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* The rewarding moment: a confetti pop reserved for streak milestones + the final question
          (Confetti self-disables under reduced motion), and the points count up on every correct.
          Anti-cheat: correctness is only ever shown HERE, after the server answer arrives. */}
      {celebrate && <Confetti burstKey={reveal.idx + 1} count={90} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <Display
          className={reveal.correct ? "rr-pop" : "rr-shake"}
          style={{ fontSize: 26, color: reveal.correct ? "var(--lime)" : "var(--pink)" }}
        >
          {reveal.correct ? t.contest.correct : t.contest.notQuite}
        </Display>
        {reveal.points > 0 && (
          <span
            className="display"
            style={{
              fontSize: 22,
              color: "var(--amber)",
              textShadow: "0 0 16px rgba(255,201,30,.5)",
            }}
          >
            +<CountUp value={reveal.points} durationMs={700} />
          </span>
        )}
      </div>
      {spec.options && correctIndex !== null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {spec.options.map((opt, i) => {
            let state: PillState = "dim";
            if (i === correctIndex) state = "correct";
            else if (i === choice) state = "wrong";
            return <AnswerPill key={i} index={i} label={opt} state={state} disabled />;
          })}
        </div>
      ) : ModuleReveal ? (
        // The round type owns its payoff: where the change actually was, what the number actually
        // was. Only the module knows what its answer MEANS, and the generic branch below can say
        // nothing more useful than "counted".
        <ModuleReveal
          spec={round.client_spec as never}
          answer={reveal.answer}
          result={result}
          correct={reveal.correct}
        />
      ) : (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          {reveal.correct ? t.contest.counted : t.contest.noPoints}
        </div>
      )}
    </GlassCard>
  );
}

/**
 * The second-chance beat (§5f). This mechanic used to fire in total silence — the player's pick
 * greyed out and the countdown restarted with nothing said — so a wrong answer read as the game
 * confiscating the answer rather than handing back a second go. A real player lost rounds to it.
 *
 * States the three things the player needs before the clock matters: their pick is out, they have
 * another go, and it is worth half. Deliberately says nothing about WHICH option is right — the
 * answer stays server-side until the round resolves (Invariant 1).
 */
function RetryNotice() {
  const t = useT();
  const reduced = useReducedMotion();
  return (
    <div
      role="status"
      className={reduced ? undefined : "rr-splash-in"}
      style={{ margin: "16px 0 2px", textAlign: "center" }}
    >
      {/* No panel, centred, and BELOW the options. The eliminated option sliding away is what tells
          the player their pick is gone, so a boxed banner on top of that announced the same thing
          twice — and above the options it pushed the answers down at the exact moment the player is
          re-reading them. Soft rose: not gold (the countdown ring is gold) and not alarm-red (the
          ring's own final seconds are red). */}
      <div
        className="display"
        style={{
          fontSize: 18,
          lineHeight: 1.15,
          color: "color-mix(in srgb, var(--pink) 78%, var(--text))",
        }}
      >
        {t.contest.retryTitle} —
      </div>
      <div style={{ marginTop: 3, fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
        {t.contest.retryNote}
      </div>
    </div>
  );
}

/**
 * Round-segmented progress: 4 segments (one per 2-question block) instead of per-question dots. Each
 * segment fills proportionally as its questions are answered — a completed block is full lime, the
 * active block fills 0..1, future blocks stay dim. Mobile-clean and GPU-cheap (a width transition on
 * an inner bar; no per-question nodes). Derives block geometry from `total` via roundFraming so a
 * non-8 run still shows 4 segments (the last absorbs any remainder).
 */
export function RoundProgress({ total, current }: { total: number; current: number }) {
  const size = roundFraming(0, total).blockSize;
  const segments = roundFraming(0, total).totalBlocks;
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center" }} aria-hidden>
      {Array.from({ length: segments }, (_, b) => {
        const start = b * size;
        const end = b === segments - 1 ? total : start + size;
        const span = Math.max(1, end - start);
        // Fraction of THIS block answered: current is the index in progress (0-based), so questions
        // strictly before `current` are done.
        const done = Math.min(span, Math.max(0, current - start));
        const frac = current >= end ? 1 : done / span;
        return (
          <div
            key={b}
            style={{
              flex: 1,
              maxWidth: 64,
              height: 8,
              borderRadius: 4,
              background: "var(--line)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${frac * 100}%`,
                height: "100%",
                borderRadius: 4,
                background: frac >= 1 ? "var(--lime)" : "var(--amber)",
                boxShadow: frac > 0 && frac < 1 ? "0 0 10px var(--amber)" : "none",
                transition: "width 200ms ease",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Brief round-banner interstitial shown on the splash of each block's first question (Opening /
 * Pressure / Crown Climb / Final Crown Round). Reuses the existing `rr-splash-in` keyframe (which the
 * global reduced-motion media query already collapses to an instant state change). Decorative label
 * only — the question itself stays calm (anti-cheat: no answer client-side).
 */
export function RoundBanner({ blockKey }: { blockKey: RoundBlockKey }) {
  const t = useT();
  const reduced = useReducedMotion();
  return (
    <div
      className={reduced ? undefined : "rr-splash-in"}
      style={{
        alignSelf: "center",
        padding: "5px 16px",
        borderRadius: 999,
        background: "linear-gradient(135deg, rgba(124,58,237,.35), rgba(255,193,52,.18))",
        border: "1px solid rgba(255,193,52,.3)",
        fontFamily: "Fredoka, sans-serif",
        fontWeight: 900,
        fontSize: 13,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--amber)",
      }}
    >
      {t.contest[blockKey]}
    </div>
  );
}

/**
 * The instant Rot Report finish screen — builds the own-run report from the round log and resolves the
 * pending-placement time + honest attempt count. Thin container so the card stays pure/prop-driven.
 */
function RotReportFinish({
  entryId,
  windowId,
  log,
  total,
  onExit,
  onPractice,
}: {
  entryId: string;
  windowId: string;
  log: RoundLog[];
  total: number;
  onExit: () => void;
  onPractice: () => void;
}) {
  const { resultsAt, attempts } = useWindowMeta(windowId);
  const report = useMemo(() => buildRotReport(log, total), [log, total]);
  // Stash this exact report so Home can re-open it (and re-share) after this screen is gone — the
  // per-round log lives only here, and the server never re-exposes a finished entry's breakdown.
  const userId = useSessionStore((s) => s.me?.user_id);
  useEffect(() => {
    if (userId) saveRotReport(userId, { windowId, entryId, report });
  }, [userId, windowId, entryId, report]);
  // Eagerly mint the shareable challenge link so tapping Share opens the OS sheet synchronously (iOS
  // requires navigator.share inside the tap gesture). Best-effort: on failure RotReport falls back to
  // the neutral app link, so a challenge-create hiccup never blocks sharing.
  const [challenge, setChallenge] = useState<ChallengeCreateResponse | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .createChallenge(entryId)
      .then((c) => alive && setChallenge(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [entryId]);
  return (
    <RotReport
      report={report}
      resultsAt={resultsAt}
      attempts={attempts}
      windowId={windowId}
      challengeUrl={challenge?.url}
      challengeScore={challenge?.score}
      challengeNo={challenge?.contest_no}
      onExit={onExit}
      onPractice={onPractice}
    />
  );
}

/**
 * Minimal post-run feedback (NOT the dramatic results). The window is still open and async — the run
 * is banked, but nothing is final until settlement. So: no placement, no coins/rating, no podium/
 * finality language — only "score banked", "you're in the field", and when the window settles.
 *
 * NB: the live finish flow now shows the instant {@link RotReport} instead; ScoreBanked is retained
 * (and still tested) as the honest async-pending framing for any caller that wants it.
 */
export function ScoreBanked({
  windowId,
  onExit,
  onPractice,
}: {
  windowId: string;
  onExit: () => void;
  onPractice: () => void;
}) {
  const t = useT();
  // Daily Royale: results settle at settle_at (close_at + 15min). Prefer it; fall back to close_at if
  // an older response omits it, and to a generic line if neither is available. Viewer-local time, no "ET".
  const { resultsAt } = useWindowMeta(windowId);

  return (
    <main
      style={{
        minHeight: "100dvh", // dvh to match the round view's mobile-safe sizing (PR #2)
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 24,
        textAlign: "center",
      }}
    >
      <span aria-hidden className="emoji" style={{ fontSize: 54, lineHeight: 1 }}>
        🗳️
      </span>
      <Display gold style={{ fontSize: "clamp(34px, 10vw, 44px)" }}>
        {t.contest.scoreLocked}
      </Display>
      <div style={{ color: "var(--muted)", fontSize: 15, fontWeight: 700, maxWidth: 340, lineHeight: 1.5 }}>
        {t.contest.inTheField}{" "}
        {resultsAt
          ? fmt(t.contest.resultsAt, { time: formatLocalTime(resultsAt) })
          : t.contest.resultsOnClose}
      </div>
      <div style={{ width: "100%", maxWidth: 300, display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
        <GoldButton onClick={onExit}>{t.contest.backToHub}</GoldButton>
        <button
          type="button"
          onClick={onPractice}
          style={{
            padding: "13px 14px",
            borderRadius: 14,
            border: "1px solid var(--line)",
            background: "rgba(45,20,90,.4)",
            color: "var(--text)",
            fontWeight: 800,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          {t.contest.practice}
        </button>
      </div>
    </main>
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
