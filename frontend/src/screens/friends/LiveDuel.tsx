import { useCallback, useEffect, useRef, useState } from "react";
import { api, friendDuelSocketUrl } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import type { MultipleChoiceSpec } from "@/modules/multipleChoice/MultipleChoiceRound";
import { MultipleChoiceRound } from "@/modules/multipleChoice/MultipleChoiceRound";
import { useSessionStore } from "@/store/session";
import { AnswerPill, type PillState } from "@/ui/AnswerPill";
import { Confetti } from "@/ui/Confetti";
import { Display } from "@/ui/Display";
import { GlassCard } from "@/ui/GlassCard";
import { GoldButton } from "@/ui/GoldButton";

const TOTAL_NORMAL_ROUNDS = 7; // best-of-7; idx >= 7 is sudden death
const AUTO_ADVANCE_MS = 1900;

interface RoundSpecLite {
  idx: number;
  type: string;
  client_spec: Record<string, unknown>;
}

interface RoundResultMsg {
  type: "round_result";
  idx: number;
  phase: string;
  outcome: "you_win" | "opp_win" | "no_point";
  outcome_reason: string;
  your_correct: boolean;
  your_time_ms: number;
  your_answer: number | null;
  opp_correct: boolean;
  opp_time_ms: number;
  opp_answer: number | null;
  your_round_wins: number;
  opp_round_wins: number;
  answer: { correctIndex?: number } & Record<string, unknown>;
  next: string; // normal | sudden_death | done
  finished: boolean;
  result: {
    won: boolean;
    perfect: boolean;
    comeback: boolean;
    xp_awarded: number;
    duel_tier: string;
  } | null;
}

type Phase = "connecting" | "lobby" | "playing" | "waiting" | "reveal" | "done" | "error";

/**
 * Live friend duel — the real-time best-of-7 head-to-head played over a WebSocket. Both friends
 * answer the SAME seeded question; a round resolves the instant both have locked in, and the server
 * (the only authority) pushes the head-to-head outcome to each side. Mirrors the bot DuelPlay rhythm
 * (calm timed question → reveal banner) but the rival is a real person answering live.
 */
export function LiveDuel({
  duelId,
  opponentName,
  onExit,
  onRematch,
}: {
  duelId: string;
  opponentName: string;
  onExit: () => void;
  onRematch?: () => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("connecting");
  const [rounds, setRounds] = useState<RoundSpecLite[]>([]);
  const [idx, setIdx] = useState(0);
  const [yourWins, setYourWins] = useState(0);
  const [oppWins, setOppWins] = useState(0);
  const [reveal, setReveal] = useState<RoundResultMsg | null>(null);
  const [finalWin, setFinalWin] = useState<boolean | null>(null);
  const [finalBadge, setFinalBadge] = useState<"perfect" | "comeback" | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const connectedRef = useRef(false); // guards StrictMode double-mount
  const finishedRef = useRef(false);
  const noticeTimer = useRef<number | null>(null);

  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 2200);
  }, []);

  const handleMessage = useCallback(
    (raw: MessageEvent) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.data as string);
      } catch {
        return;
      }
      switch (msg.type) {
        case "state": {
          setRounds((msg.rounds as RoundSpecLite[]) ?? []);
          setIdx((msg.current_round as number) ?? 0);
          setYourWins((msg.your_round_wins as number) ?? 0);
          setOppWins((msg.opp_round_wins as number) ?? 0);
          if (msg.status === "completed") {
            finishedRef.current = true;
            setFinalWin(msg.winner_side === msg.you);
            setPhase("done");
          } else {
            setPhase(msg.opponent_online ? "playing" : "lobby");
          }
          break;
        }
        case "opponent_joined":
          setPhase((p) => (p === "lobby" ? "playing" : p));
          break;
        case "opponent_left":
          flashNotice(fmt(t.friends.opponentLeft, { name: opponentName }));
          break;
        case "opponent_answered":
          flashNotice(fmt(t.friends.opponentAnswered, { name: opponentName }));
          break;
        case "answer_ack":
          setPhase("waiting");
          break;
        case "round_result": {
          const r = msg as unknown as RoundResultMsg;
          setReveal(r);
          setYourWins(r.your_round_wins);
          setOppWins(r.opp_round_wins);
          if (r.finished && r.result) {
            setFinalWin(r.result.won);
            setFinalBadge(r.result.perfect ? "perfect" : r.result.comeback ? "comeback" : null);
          }
          setPhase("reveal");
          break;
        }
        case "error":
          if (msg.code === "round_out_of_order") flashNotice(t.friends.waitingOpponent.replace("{name}", opponentName));
          break;
        default:
          break;
      }
    },
    [t, opponentName, flashNotice],
  );

  // Open the socket once (refreshing the access token first so a long duel doesn't 4401 mid-match).
  useEffect(() => {
    if (connectedRef.current) return;
    connectedRef.current = true;
    let cancelled = false;

    (async () => {
      let token = useSessionStore.getState().accessToken;
      try {
        token = await api.refresh();
      } catch {
        // fall back to the current in-memory token
      }
      if (cancelled) return;
      if (!token) {
        setErrorMsg(t.friends.connectionLost);
        setPhase("error");
        return;
      }
      const ws = new WebSocket(friendDuelSocketUrl(duelId, token));
      wsRef.current = ws;
      ws.onmessage = handleMessage;
      ws.onclose = () => {
        if (cancelled || finishedRef.current) return;
        setErrorMsg(t.friends.connectionLost);
        setPhase((p) => (p === "done" ? p : "error"));
      };
      ws.onerror = () => {
        if (!cancelled && !finishedRef.current) {
          setErrorMsg(t.friends.connectionLost);
        }
      };
    })();

    return () => {
      cancelled = true;
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      wsRef.current?.close();
    };
  }, [duelId, handleMessage, t]);

  const submitAnswer = useCallback(
    (result: { choice: number | null; elapsed_ms: number }) => {
      setChoice(result.choice);
      wsRef.current?.send(JSON.stringify({ type: "answer", idx, result }));
      setPhase("waiting");
    },
    [idx],
  );

  const advance = useCallback(() => {
    const r = reveal;
    if (!r) return;
    if (r.finished) {
      setPhase("done");
      return;
    }
    setReveal(null);
    setChoice(null);
    setIdx(r.idx + 1);
    setPhase("playing");
  }, [reveal]);

  // Auto-advance the reveal after a beat (Continue can push on sooner).
  useEffect(() => {
    if (phase !== "reveal") return;
    const id = window.setTimeout(advance, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(id);
  }, [phase, advance]);

  const isSuddenDeath = idx >= TOTAL_NORMAL_ROUNDS;
  const scoreline = (
    <ScoreLine
      you={t.friends.you}
      opp={opponentName}
      yourWins={yourWins}
      oppWins={oppWins}
      counter={
        isSuddenDeath
          ? t.friends.suddenDeath
          : fmt(t.friends.roundOf, { n: Math.min(idx + 1, TOTAL_NORMAL_ROUNDS), total: TOTAL_NORMAL_ROUNDS })
      }
      intense={isSuddenDeath}
    />
  );

  return (
    <Shell onExit={onExit} exitLabel={t.friends.exit}>
      {notice && (
        <div style={noticeBar} role="status">
          {notice}
        </div>
      )}

      {(phase === "connecting" || phase === "lobby") && (
        <Centered>
          <Display style={{ fontSize: 24, color: "var(--text)" }}>
            {fmt(t.friends.waitingTitle, { name: opponentName })}
          </Display>
          <div style={{ color: "var(--muted)", fontWeight: 600, marginTop: 8 }}>
            {phase === "connecting" ? t.friends.connecting : t.friends.waitingBody}
          </div>
          <div className="rr-aura" style={spinner} aria-hidden />
        </Centered>
      )}

      {phase === "error" && (
        <Centered>
          <div style={{ color: "var(--pink)", fontWeight: 800, fontSize: 16 }}>
            {errorMsg || t.friends.connectionLost}
          </div>
          <GoldButton idlePulse={false} onClick={onExit} style={{ maxWidth: 240, marginTop: 16 }}>
            {t.friends.exit}
          </GoldButton>
        </Centered>
      )}

      {phase === "playing" && rounds[idx] && (
        <MultipleChoiceRound
          key={idx}
          spec={rounds[idx].client_spec as unknown as MultipleChoiceSpec}
          onComplete={submitAnswer}
          eyebrow={scoreline}
        />
      )}

      {phase === "waiting" && (
        <GlassCard style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {scoreline}
          <Centered>
            <div className="rr-aura" style={spinner} aria-hidden />
            <div style={{ color: "var(--muted)", fontWeight: 700, marginTop: 14 }}>
              {fmt(t.friends.waitingOpponent, { name: opponentName })}
            </div>
          </Centered>
        </GlassCard>
      )}

      {phase === "reveal" && reveal && rounds[reveal.idx] && (
        <RoundReveal
          reveal={reveal}
          spec={rounds[reveal.idx].client_spec as unknown as MultipleChoiceSpec}
          choice={choice}
          score={scoreline}
          onContinue={advance}
          continueLabel={reveal.finished ? t.friends.viewResult : t.friends.continueRound}
          wonLabel={t.friends.roundWon}
          lostLabel={t.friends.roundLost}
          tieLabel={t.friends.roundTie}
        />
      )}

      {phase === "done" && (
        <FinalResult
          win={finalWin}
          badge={finalBadge}
          yourWins={yourWins}
          oppWins={oppWins}
          youLabel={t.friends.you}
          oppLabel={opponentName}
          title={
            finalWin
              ? finalBadge === "comeback"
                ? t.friends.comebackWin
                : finalBadge === "perfect"
                  ? t.friends.perfectWin
                  : t.friends.youWin
              : fmt(t.friends.youLose, { name: opponentName })
          }
          badgeLabel={finalBadge === "perfect" ? t.friends.perfectBadge : t.friends.comebackBadge}
          onExit={onExit}
          onRematch={onRematch}
          rematchLabel={t.friends.rematch}
          exitLabel={t.friends.exit}
        />
      )}
    </Shell>
  );
}

function ScoreLine({
  you,
  opp,
  yourWins,
  oppWins,
  counter,
  intense,
}: {
  you: string;
  opp: string;
  yourWins: number;
  oppWins: number;
  counter: string;
  intense: boolean;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8 }}>
        <Side label={you} wins={yourWins} accent="var(--lime)" align="left" />
        <span aria-hidden className="display" style={{ color: "var(--muted)", fontSize: 13, letterSpacing: 1 }}>
          VS
        </span>
        <Side label={opp} wins={oppWins} accent="var(--pink)" align="right" />
      </div>
      <div style={{ textAlign: "center", marginTop: 8 }}>
        <span
          className={intense ? "display rr-pop" : undefined}
          style={{
            fontSize: intense ? 13 : 11,
            fontWeight: 800,
            letterSpacing: intense ? 2 : 1.5,
            textTransform: "uppercase",
            color: intense ? "var(--pink)" : "var(--muted)",
          }}
        >
          {counter}
        </span>
      </div>
    </div>
  );
}

function Side({
  label,
  wins,
  accent,
  align,
}: {
  label: string;
  wins: number;
  accent: string;
  align: "left" | "right";
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align === "left" ? "flex-start" : "flex-end", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexDirection: align === "right" ? "row-reverse" : "row", maxWidth: "100%" }}>
        <span
          className="display"
          style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}
        >
          {label}
        </span>
        <span className="display" style={{ fontSize: 22, lineHeight: 1, color: accent, textShadow: `0 0 14px color-mix(in srgb, ${accent} 55%, transparent)` }}>
          {wins}
        </span>
      </div>
    </div>
  );
}

function RoundReveal({
  reveal,
  spec,
  choice,
  score,
  onContinue,
  continueLabel,
  wonLabel,
  lostLabel,
  tieLabel,
}: {
  reveal: RoundResultMsg;
  spec: MultipleChoiceSpec;
  choice: number | null;
  score: React.ReactNode;
  onContinue: () => void;
  continueLabel: string;
  wonLabel: string;
  lostLabel: string;
  tieLabel: string;
}) {
  const won = reveal.outcome === "you_win";
  const lost = reveal.outcome === "opp_win";
  const title = won ? wonLabel : lost ? lostLabel : tieLabel;
  const tone = won ? "var(--lime)" : lost ? "var(--pink)" : "var(--muted)";
  const correctIndex = typeof reveal.answer.correctIndex === "number" ? reveal.answer.correctIndex : null;

  return (
    <GlassCard style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {won && <Confetti burstKey={reveal.idx + 1} count={80} />}
      {score}
      <div style={{ textAlign: "center" }}>
        <Display className={won ? "rr-pop" : lost ? "rr-shake" : undefined} style={{ fontSize: 28, color: tone }}>
          {title}
        </Display>
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
        {continueLabel}
      </GoldButton>
    </GlassCard>
  );
}

function FinalResult({
  win,
  badge,
  yourWins,
  oppWins,
  youLabel,
  oppLabel,
  title,
  badgeLabel,
  onExit,
  onRematch,
  rematchLabel,
  exitLabel,
}: {
  win: boolean | null;
  badge: "perfect" | "comeback" | null;
  yourWins: number;
  oppWins: number;
  youLabel: string;
  oppLabel: string;
  title: string;
  badgeLabel: string;
  onExit: () => void;
  onRematch?: () => void;
  rematchLabel: string;
  exitLabel: string;
}) {
  return (
    <GlassCard style={{ display: "flex", flexDirection: "column", gap: 18, textAlign: "center" }}>
      {win && <Confetti burstKey={badge ? 98 : 99} count={badge ? 185 : 140} />}
      <Display className="rr-pop" style={{ fontSize: 34, color: win ? "var(--lime)" : "var(--pink)" }}>
        {title}
      </Display>
      {badge && (
        <div
          style={{
            color: badge === "comeback" ? "var(--lime)" : "var(--amber)",
            fontWeight: 800,
            letterSpacing: 1,
            textTransform: "uppercase",
            fontSize: 14,
          }}
        >
          {badgeLabel}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 14 }}>
        <span style={{ color: "var(--lime)", fontWeight: 800 }}>{youLabel} {yourWins}</span>
        <span style={{ color: "var(--muted)" }}>—</span>
        <span style={{ color: "var(--pink)", fontWeight: 800 }}>{oppWins} {oppLabel}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {onRematch && (
          <GoldButton idlePulse={false} onClick={onRematch}>
            {rematchLabel}
          </GoldButton>
        )}
        <button type="button" onClick={onExit} style={textBtn}>
          {exitLabel}
        </button>
      </div>
    </GlassCard>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 4 }}>
      {children}
    </div>
  );
}

function Shell({ children, onExit, exitLabel }: { children: React.ReactNode; onExit: () => void; exitLabel: string }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        maxWidth: 480,
        margin: "0 auto",
        padding: "calc(env(safe-area-inset-top) + 14px) clamp(14px, 4vw, 20px) calc(env(safe-area-inset-bottom) + 24px)",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
        <button type="button" onClick={onExit} style={textBtn}>
          {exitLabel}
        </button>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>{children}</div>
    </main>
  );
}

const textBtn: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 12,
  border: "1px solid var(--line)",
  background: "color-mix(in srgb, var(--panel) 70%, transparent)",
  color: "var(--muted)",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};

const spinner: React.CSSProperties = {
  width: 44,
  height: 44,
  marginTop: 18,
  borderRadius: "50%",
  background: "radial-gradient(circle, color-mix(in srgb, var(--brand-2) 60%, transparent), transparent 70%)",
};

const noticeBar: React.CSSProperties = {
  position: "fixed",
  top: "calc(env(safe-area-inset-top) + 10px)",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 50,
  maxWidth: 360,
  width: "calc(100% - 28px)",
  textAlign: "center",
  padding: "10px 16px",
  borderRadius: 14,
  background: "color-mix(in srgb, var(--brand-2) 24%, var(--panel))",
  border: "1px solid color-mix(in srgb, var(--brand-2) 50%, transparent)",
  color: "var(--text)",
  fontWeight: 700,
  fontSize: 13,
  boxShadow: "0 12px 30px rgba(0,0,0,.45)",
};
