import { useCallback, useRef, useState } from "react";
import { api, type CogEstimateResolve } from "@/api/client";
import { useT } from "@/i18n/useT";
import { LogSlider } from "@/modules/estimate/LogSlider";
import { clamp, fmtNum, geomMid, roundNice } from "@/modules/estimate/logScale";
import { GlassCard } from "@/ui/GlassCard";
import { GoldButton } from "@/ui/GoldButton";
import { PromptText } from "@/ui/PromptText";
import { RoundHeader } from "@/ui/RoundHeader";

/**
 * Daily Royale ESTIMATE round (interactive class). The round's cognition instance is created and
 * BOUND to (entry_id, round_idx) server-side at entry; this component plays that PRE-BOUND instance
 * — it never calls estimate/start. Guesses go straight to the cognition guess endpoint (up to 3);
 * the server returns direction/band + the narrowed slider bounds, which this renders but NEVER
 * computes (Invariant 1 — the client is not told the answer, only which way it lies).
 *
 * Presentation follows the shared round language (RoundHeader + GlassCard + GoldButton) so the
 * estimate round sits in the same rhythm as trivia instead of reading as a different application.
 * The round is guess-limited rather than time-limited, so the header's ring slot carries guess pips
 * — no fake countdown.
 */
interface EstimateSpec {
  prompt: string;
  unit: string | null;
  difficulty: string;
  max_guesses: number;
  slider_min: number;
  slider_max: number;
  cognition_instance_id: string;
}

/** One line of the guess ledger — what you said, and what the server said back. */
interface Attempt {
  value: number;
  direction: "higher" | "lower" | null;
  band: "close" | "far" | null;
}

/** Guess pips: how many attempts remain, spent left to right. Replaces the countdown ring. */
function GuessPips({ total, used }: { total: number; used: number }) {
  return (
    <span
      style={{ display: "inline-flex", gap: 6, alignItems: "center", flexShrink: 0 }}
      aria-label={`${Math.max(0, total - used)} of ${total} guesses left`}
    >
      {Array.from({ length: total }, (_, i) => {
        const spent = i < used;
        return (
          <span
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: spent ? "transparent" : "var(--amber)",
              border: spent ? "1.5px solid var(--faint)" : "1.5px solid var(--amber)",
              boxShadow: spent ? "none" : "0 0 8px var(--glow)",
              transition: "background .25s ease, box-shadow .25s ease",
            }}
          />
        );
      })}
    </span>
  );
}

/** A ledger row: the guess, then the server's verdict as a tinted direction chip. */
function AttemptRow({ attempt, unit }: { attempt: Attempt; unit: string | null }) {
  const t = useT();
  const close = attempt.band === "close";
  const tint = close ? "var(--amber)" : "var(--pink)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "9px 12px",
        borderRadius: "var(--radius-ctl, 14px)",
        background: "var(--panel2)",
        border: "1px solid var(--line)",
      }}
    >
      <span
        style={{
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: "var(--muted)",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {fmtNum(attempt.value)}
        {unit ? ` ${unit}` : ""}
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 999,
          flexShrink: 0,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: tint,
          background: `color-mix(in srgb, ${tint} 12%, transparent)`,
          border: `1px solid color-mix(in srgb, ${tint} 45%, transparent)`,
        }}
      >
        <span aria-hidden>{attempt.direction === "higher" ? "▲" : "▼"}</span>
        {attempt.direction === "higher" ? t.rounds.higher : t.rounds.lower}
        <span style={{ opacity: 0.65, letterSpacing: 0.6 }}>{close ? "· close" : "· way off"}</span>
      </span>
    </div>
  );
}

export const EstimateRound: React.FC<{
  spec: EstimateSpec;
  onComplete: (result: Record<string, unknown>) => void;
  eyebrow?: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ spec, onComplete, eyebrow, footer }) => {
  const t = useT();
  const [bounds, setBounds] = useState({ min: spec.slider_min, max: spec.slider_max });
  const [value, setValue] = useState(() => geomMid(spec.slider_min, spec.slider_max));
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [busy, setBusy] = useState(false);
  const done = useRef(false);

  const guess = useCallback(async () => {
    if (busy || done.current) return;
    setBusy(true);
    try {
      const committed = roundNice(value);
      const r = await api.cogEstimateGuess(spec.cognition_instance_id, committed);
      if (r.done) {
        done.current = true;
        // The server has the outcome and the Royale bridge re-reads it server-side, so this payload
        // is not scored — it carries the player's LAST guess purely so the reveal can show it
        // against the real answer. Sending their own input back is not a leak.
        //
        // The REVEAL is fetched here because nothing else will. A Royale round's stored
        // `server_answer` for an interactive type is only a binding marker — no answer, no
        // explanation — so the reveal has nothing to render and falls back to a bare
        // "Correct!"/"Not quite". `estimate/resolve` is a pure read that only becomes legal once
        // the round is complete, which it now is, and it returns the whole payoff: the number, the
        // arithmetic it is built from, and why the intuition misleads. For a Fermi question that
        // payoff IS the round (§5c) — a player who guessed 550 when the truth was 1,000 otherwise
        // learns nothing.
        //
        // Failure must cost the PAYOFF, never the run: `onComplete` is what finalizes the Royale
        // round, so it is called either way. A missing explanation is a disappointment; a round
        // that never finalizes strands the player mid-run.
        let reveal: CogEstimateResolve | undefined;
        try {
          reveal = await api.cogEstimateResolve(spec.cognition_instance_id);
        } catch {
          reveal = undefined;
        }
        onComplete({ final_guess: committed, ...(reveal ? { reveal } : {}) });
        return;
      }
      setAttempts((a) => [...a, { value: committed, direction: r.direction, band: r.band }]);
      setBounds({ min: r.slider_min, max: r.slider_max });
      // Keep the slider where the player left it (their last guess), only clamped into the newly
      // narrowed range — don't yank it back to the midpoint after a wrong guess.
      setValue((v) => clamp(v, r.slider_min, r.slider_max));
    } finally {
      setBusy(false);
    }
  }, [busy, spec.cognition_instance_id, value, onComplete]);

  return (
    <div>
      {/* Header lives ABOVE the card, matching every other round module. */}
      <RoundHeader
        label={t.rounds.estimate}
        right={<GuessPips total={spec.max_guesses} used={attempts.length} />}
      />
      <GlassCard>
        {eyebrow}
        <PromptText text={spec.prompt} style={{ margin: "4px 0 6px" }} />

        {/* The live range. This is the round's quiet scoreboard: every wrong guess visibly closes
            it in, which is the whole mechanic and was previously invisible. */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: "var(--faint)",
          }}
        >
          <span>{t.rounds.range}</span>
          <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
            {fmtNum(bounds.min)} – {fmtNum(bounds.max)}
          </span>
        </div>

        <LogSlider
          min={bounds.min}
          max={bounds.max}
          value={value}
          unit={spec.unit}
          onChange={setValue}
        />

        <GoldButton
          onClick={() => void guess()}
          disabled={busy}
          idlePulse={!busy}
          style={{ marginTop: 10 }}
        >
          Lock in {fmtNum(value)}
          {spec.unit ? ` ${spec.unit}` : ""}
        </GoldButton>

        {/* Before the first guess the card would otherwise end flat on the CTA. This states the
            mechanic (which is not self-evident — nothing else says a wrong guess narrows the range
            rather than ending the round) and gives the card the footer rhythm a four-pill question
            card gets for free. It is replaced by the ledger once guessing starts. */}
        {attempts.length === 0 && (
          <p
            style={{
              margin: "14px 0 2px",
              textAlign: "center",
              fontSize: 12.5,
              fontWeight: 600,
              lineHeight: 1.5,
              color: "var(--faint)",
            }}
          >
            {spec.max_guesses} guesses. Each one narrows the range.
          </p>
        )}

        {attempts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            {attempts.map((a, i) => (
              <AttemptRow key={i} attempt={a} unit={spec.unit} />
            ))}
          </div>
        )}
        {footer}
      </GlassCard>
    </div>
  );
};
