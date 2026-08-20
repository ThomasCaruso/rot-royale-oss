import { useCallback, useEffect, useRef, useState } from "react";
import { AnswerPill } from "@/ui/AnswerPill";
import { GlassCard } from "@/ui/GlassCard";
import { PromptText } from "@/ui/PromptText";
import { RoundHeader } from "@/ui/RoundHeader";
import { useReducedMotion } from "@/ui/useReducedMotion";

// How long the eliminated option takes to slide out. Quick enough not to eat the retry window,
// slow enough that the list is seen to close up rather than the option just blinking out of
// existence — the movement is what tells the player their pick is gone.
const REMOVE_MS = 240;

export interface MultipleChoiceSpec {
  prompt: string;
  options: string[];
  category: string;
  icon: string;
  time_limit_ms: number;
}

export interface MultipleChoiceResult {
  choice: number | null;
  elapsed_ms: number;
}

/**
 * Timed multiple-choice round (trivia, rapid_math). Calm in-play per the anti-cheat split: the
 * client can't know correctness, so selecting just locks the pill (violet). Correct/wrong reveal +
 * celebration happen on the results screen. Gold countdown ring is the primary timer.
 */
export const MultipleChoiceRound: React.FC<{
  spec: MultipleChoiceSpec;
  onComplete: (result: MultipleChoiceResult) => void;
  // Host-supplied chrome rendered inside the question card, above the prompt (e.g. the "Round 1 of 4"
  // eyebrow). Optional so the module renders standalone too.
  eyebrow?: React.ReactNode;
  // Host-supplied footer rendered inside the question card, below the answers (e.g. the contest
  // "locked in" note shown while the server scores the round).
  footer?: React.ReactNode;
  // §5f Daily Royale second-chance: when the host reports a wrong first pick, `eliminated` is the
  // option that greys out (unclickable) and `retryMs` opens a fresh countdown for one more pick.
  // Absent everywhere but the ranked Royale, so other hosts get the unchanged one-shot behaviour.
  eliminated?: number | null;
  retryMs?: number;
  // Host-supplied line shown UNDER the options while the second chance is open. The module owns no
  // copy (it has no i18n), so the screen passes the localized beat in.
  notice?: React.ReactNode;
}> = ({ spec, onComplete, eyebrow, footer, eliminated = null, retryMs, notice }) => {
  const reduced = useReducedMotion();
  const [limit, setLimit] = useState(spec.time_limit_ms);
  const [left, setLeft] = useState(spec.time_limit_ms);
  const [selected, setSelected] = useState<number | null>(null);
  // The eliminated option animates OUT rather than sitting there greyed: `leaving` collapses it,
  // then `gone` unmounts it so the surviving options close the gap and the card re-centres.
  const [leaving, setLeaving] = useState<number | null>(null);
  const [gone, setGone] = useState<number | null>(null);
  const [runId, setRunId] = useState(0); // bumped to restart the countdown on a retry re-arm
  const done = useRef(false);
  const startRef = useRef<number>(performance.now());

  const finish = useCallback(
    (choice: number | null) => {
      if (done.current) return;
      done.current = true;
      const elapsed = Math.round(performance.now() - startRef.current);
      setTimeout(() => onComplete({ choice, elapsed_ms: elapsed }), 420);
    },
    [onComplete],
  );

  // §5f re-arm: a wrong first pick greys that option and restarts the round on the retry window.
  // `startRef` resets with the countdown, so the reported elapsed is the retry-phase think time.
  useEffect(() => {
    if (eliminated == null) return;
    setLeaving(eliminated);
    // Gently but quickly: collapse, then remove. Under reduced motion it just goes.
    const t = window.setTimeout(() => setGone(eliminated), reduced ? 0 : REMOVE_MS);
    setSelected(null);
    done.current = false;
    const ms = retryMs ?? 8000; // fallback; the server's TRIVIA_RETRY_MS is authoritative
    setLimit(ms);
    setLeft(ms);
    setRunId((n) => n + 1);
    return () => window.clearTimeout(t);
  }, [eliminated, retryMs, reduced]);

  useEffect(() => {
    const start = performance.now();
    startRef.current = start;
    const id = setInterval(() => {
      const remaining = limit - (performance.now() - start);
      if (remaining <= 0) {
        clearInterval(id);
        setLeft(0);
        finish(null);
      } else {
        setLeft(remaining);
      }
    }, 50);
    return () => clearInterval(id);
  }, [runId, limit, finish]);

  return (
    <div>
      {/* Header BAR lives ABOVE the card so the ring + its red glow halo can never be clipped. */}
      <RoundHeader category={spec.category} icon={spec.icon} remainingMs={left} totalMs={limit} />
      <GlassCard>
        {eyebrow}
        {/* Prompt: comfortable line-height, no fixed height so short and long prompts both read well
            (a tall prompt grows the card and scrolls rather than clipping). */}
        <PromptText text={spec.prompt} />
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {spec.options.map((opt, i) => {
            if (gone === i) return null; // §5f: the eliminated pick has left the list entirely
            const isLeaving = leaving === i;
            return (
              <div
                key={i}
                style={{
                  overflow: "hidden",
                  maxHeight: isLeaving ? 0 : 200,
                  opacity: isLeaving ? 0 : 1,
                  transform: isLeaving ? "translateX(-28px)" : "none",
                  // The negative margin eats the flex gap as the row collapses, so the remaining
                  // options slide up smoothly instead of jumping when this one unmounts.
                  marginBottom: isLeaving ? -11 : 0,
                  transition: reduced
                    ? "none"
                    : `max-height ${REMOVE_MS}ms cubic-bezier(.4,0,.2,1), opacity 160ms ease-out,
                       transform ${REMOVE_MS}ms cubic-bezier(.4,0,.2,1),
                       margin-bottom ${REMOVE_MS}ms cubic-bezier(.4,0,.2,1)`,
                }}
              >
                <AnswerPill
                  index={i}
                  label={opt}
                  state={
                    isLeaving
                      ? "dim"
                      : selected === i
                        ? "selected"
                        : selected !== null
                          ? "dim"
                          : "default"
                  }
                  disabled={done.current || isLeaving}
                  onClick={() => {
                    if (done.current || isLeaving) return;
                    setSelected(i);
                    finish(i);
                  }}
                />
              </div>
            );
          })}
        </div>
        {notice}
        {footer}
      </GlassCard>
    </div>
  );
};
