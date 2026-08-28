import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { useT } from "@/i18n/useT";
import { feedback } from "@/lib/haptics";
import { AnswerPill, type PillState } from "@/ui/AnswerPill";
import { GlassCard } from "@/ui/GlassCard";
import { PromptText } from "@/ui/PromptText";
import { RoundHeader } from "@/ui/RoundHeader";

/**
 * The video round: watch a clip, answer two questions about it, watch a subtly altered version of
 * the same clip, then say what changed.
 *
 * ONE Royale slot, THREE scored answers — the only round type that asks more than one question. It
 * earns that by taking roughly three times as long, and is worth roughly three times the points,
 * through the same `compute_points` formula as everything else.
 *
 * WHY THE CLIP IS SIZED BY HEIGHT, NOT WIDTH. The clips are 9:16 portrait (real camera framing). At
 * the card's full width a 9:16 frame is ~636px tall on an iPhone 14, which overflows the round once
 * the header, prompt and card padding are counted — and this round cannot scroll, because the whole
 * frame has to be visible while it plays. Driving from HEIGHT and deriving width from the aspect
 * ratio inverts that: the clip is always as large as the screen allows, never larger, and the
 * leftover width becomes natural side padding rather than an overflow.
 *
 *   iPhone SE   225x400 (59px each side)   iPhone 14   285x506 (37px each side)
 *
 * `muted` + `playsInline` are NOT optional: iOS refuses to autoplay without both, and a clip that
 * silently never starts is an unanswerable round. The clips ship with no audio track, so muting
 * costs nothing.
 *
 * ANSWERS ARE JUDGED SERVER-SIDE. `choice` indexes the options as SERVED; the server maps it back
 * through the same seeded shuffle. This component never holds a correct index, so nothing here can
 * leak one — the same property trivia has.
 */

export interface VideoQuestionSpec {
  prompt: string;
  options: string[];
}

export interface VideoRoundSpec {
  cognition_instance_id: string;
  base_url: string;
  altered_url: string;
  width: number;
  height: number;
  duration_ms: number;
  questions: VideoQuestionSpec[];
  change_question: VideoQuestionSpec;
  question_time_limit_ms: number;
}

type Phase = "clip1" | "q0" | "q1" | "clip2" | "q2";

/** The clip's box. Height-driven so a portrait frame can never overflow the round. */
const STAGE_MAX_VH = 60;
const STAGE_MAX_PX = 580;

const PHASE_ORDER: Phase[] = ["clip1", "q0", "q1", "clip2", "q2"];

/**
 * Taps are ignored for this long after a question appears.
 *
 * Without it a fast double-tap answers TWO questions: the first tap advances, and the second lands
 * on whatever option is now under the finger — a question the player never even saw. Nobody reads
 * four options and decides in under a quarter of a second, so this costs a real answer nothing.
 */
const INPUT_COOLDOWN_MS = 250;

export function VideoRound({
  spec,
  onComplete,
  eyebrow,
  footer,
}: {
  spec: VideoRoundSpec;
  onComplete: (result: { answers: (number | null)[] }) => void;
  eyebrow?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("clip1");
  const [choice, setChoice] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  // The lock is ALSO a ref, and that is the load-bearing half. `locked` state does not update until
  // React re-renders, so two taps in the same tick both read it as false and both send an answer —
  // the server's unique (instance, attempt_index) constraint then rejects the second, turning a
  // double-tap into an error. The ref flips synchronously, so the second tap never fires at all.
  const lockedRef = useRef(false);
  const answersRef = useRef<(number | null)[]>([]);
  const limit = spec.question_time_limit_ms;

  const questionIndex = phase === "q0" ? 0 : phase === "q1" ? 1 : phase === "q2" ? 2 : -1;
  const question =
    questionIndex === 2 ? spec.change_question : spec.questions[questionIndex] ?? null;
  const showingClip = phase === "clip1" || phase === "clip2";

  // Per-question countdown. Each question has its own 5s clock: the points formula scores on
  // (correct, time_frac), so an untimed question would score flat and make speed meaningless in
  // the one mode where every other round rewards it.
  const [left, setLeft] = useState(limit);
  const startedAt = useRef(0);
  useEffect(() => {
    if (showingClip) return;
    // Unlocking happens HERE, with the new question's clock — not in `advance`.
    //
    // Unlocking synchronously in `advance` unlocked before `left` had been reset, so the moment one
    // question timed out the effect below saw (left === 0, unlocked) for the NEXT question and
    // auto-answered it too. A single timeout cascaded through the rest of the round. It also let a
    // double-tap land its second tap on the next question's options.
    startedAt.current = Date.now();
    lockedRef.current = false;
    setLocked(false);
    setLeft(limit);
    const id = window.setInterval(() => {
      const remaining = Math.max(0, limit - (Date.now() - startedAt.current));
      setLeft(remaining);
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, showingClip, limit]);

  const advance = useCallback(() => {
    setChoice(null);
    setPhase((p) => PHASE_ORDER[Math.min(PHASE_ORDER.indexOf(p) + 1, PHASE_ORDER.length - 1)]);
  }, []);

  const submit = useCallback(
    (picked: number | null) => {
      if (lockedRef.current || questionIndex < 0) return;
      // A tap this soon after the question appeared is the tail of the previous tap, not an answer.
      if (picked !== null && Date.now() - startedAt.current < INPUT_COOLDOWN_MS) return;
      lockedRef.current = true;
      setLocked(true);
      setChoice(picked);
      answersRef.current = [...answersRef.current, picked];
      const elapsed = Math.min(limit, Math.max(0, Date.now() - startedAt.current));

      // Fire and forget, and advance IMMEDIATELY rather than awaiting the response.
      //
      // The server is authoritative — it judges the answer and the round finalizes through
      // /entries/{id}/answer regardless — so there is nothing in the reply the next question needs.
      // Waiting for it would stall the player on a slow connection at the one moment a timed round
      // cannot afford it, and a dropped request would leave them stuck on a question they have
      // already answered.
      void api
        .cogVideoAnswer(spec.cognition_instance_id, questionIndex, picked, elapsed)
        .catch(() => {});

      if (questionIndex === 2) onComplete({ answers: answersRef.current });
      else advance();
    },
    [questionIndex, limit, spec.cognition_instance_id, onComplete, advance],
  );

  // Timeout is a real outcome, not an error: it scores as wrong and the round moves on.
  useEffect(() => {
    if (showingClip || lockedRef.current || left > 0) return;
    // Measured against the clock, not against `left`. On the render where a question advances,
    // `left` is still the previous question's 0 while `startedAt` has already been reset — reading
    // state alone made one timeout cascade into auto-answering every remaining question.
    if (Date.now() - startedAt.current < limit) return;
    submit(null);
  }, [left, showingClip, limit, submit]);

  const onEnded = useCallback(() => {
    setPhase((p) => (p === "clip1" ? "q0" : p === "clip2" ? "q2" : p));
  }, []);

  const step = questionIndex < 0 ? (phase === "clip1" ? 1 : 3) : questionIndex + 1;

  return (
    <div>
      <RoundHeader
        label={
          showingClip
            ? phase === "clip1"
              ? t.rounds.watchClosely
              : t.rounds.watchAgain
            : t.rounds.videoRound
        }
        remainingMs={showingClip ? 0 : left}
        totalMs={limit}
        ring={!showingClip}
        right={
          showingClip ? (
            <span
              style={{
                fontSize: 11.5,
                letterSpacing: 1.4,
                textTransform: "uppercase",
                fontWeight: 800,
                color: "var(--muted)",
              }}
            >
              {step} / 3
            </span>
          ) : undefined
        }
      />
      <GlassCard style={{ overflow: "hidden" }}>
        {eyebrow}
        {showingClip ? (
          <>
            <PromptText
              text={phase === "clip1" ? t.rounds.watchTheClip : t.rounds.watchForWhatChanged}
              style={{ margin: "4px 0 12px" }}
            />
            <div
              style={{
                height: `min(${STAGE_MAX_VH}vh, ${STAGE_MAX_PX}px)`,
                aspectRatio: `${spec.width} / ${spec.height}`,
                maxWidth: "100%",
                margin: "0 auto",
                borderRadius: "var(--radius-ctl, 14px)",
                overflow: "hidden",
                background: "var(--panel2)",
                boxShadow: "inset 0 2px 10px rgba(0,0,0,.12)",
              }}
            >
              <video
                key={phase}
                src={phase === "clip1" ? spec.base_url : spec.altered_url}
                muted
                playsInline
                autoPlay
                preload="auto"
                onEnded={onEnded}
                // A clip that fails to load must not wedge the round: treat it as ended and let the
                // questions run. Better a hard question than a dead screen.
                onError={onEnded}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </div>
          </>
        ) : (
          question && (
            <>
              <PromptText text={question.prompt} style={{ margin: "4px 0 14px" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {question.options.map((opt, i) => {
                  const state: PillState = choice === i ? "selected" : "default";
                  return (
                    <AnswerPill
                      key={i}
                      index={i}
                      label={opt}
                      state={state}
                      disabled={locked}
                      onClick={() => {
                        feedback("selection");
                        submit(i);
                      }}
                    />
                  );
                })}
              </div>
            </>
          )
        )}
        {footer}
      </GlassCard>
    </div>
  );
}
