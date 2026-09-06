import type { CogEstimateResolve } from "@/api/client";
import { fmtNum, fmtRatio } from "@/modules/estimate/logScale";
import { fmt, useT } from "@/i18n/useT";

/**
 * The answer — which for a Fermi question is the entire reason to have asked.
 *
 * TWO BEATS AND NOTHING ELSE: the number, then how far off you were. An earlier pass also showed
 * the explanation, the components the answer is built from and the intuition note — all of which
 * are genuinely good content, and all of which turned a 90-second game's between-round splash into
 * a datasheet. Sixty words of reading competed with the one number the round exists to deliver.
 * If that material comes back it belongs somewhere a player CHOOSES to go, not in the beat between
 * two timed rounds.
 *
 * Distance is shown as a RATIO, not a difference. These questions span orders of magnitude, so
 * "450 off" is meaningless — 450 off a thousand is a good guess and 450 off ten is not. "1.8x low"
 * is the honest unit of being wrong here, and it's how the scoring thinks about it too.
 */
export function EstimateReveal({
  spec,
  answer,
  result,
  correct = false,
}: {
  // Only the unit is read. The slider bounds are in the round's spec but have no job here now that
  // the reveal states the miss rather than plotting it.
  spec: { unit: string | null };
  answer: Record<string, unknown>;
  result: Record<string, unknown>;
  correct?: boolean;
}) {
  // Before the early return below — a hook after a conditional return breaks the rules of hooks.
  const t = useT();
  // `result.reveal` is the estimate/resolve payload the round fetched on its last guess. It is the
  // ONLY source inside a Royale: an interactive round's stored server_answer is a binding marker
  // with no `answer` in it, so reading `answer.answer` alone left this component returning null and
  // the player seeing a bare "Correct!" with the number never named. `answer` is still preferred so
  // any path that does carry a real server answer keeps working.
  const rev = (result.reveal ?? {}) as Partial<CogEstimateResolve>;
  const actual =
    typeof answer.answer === "number"
      ? answer.answer
      : typeof rev.answer === "number"
        ? rev.answer
        : null;
  const guessRaw = result.final_guess;
  const guess = typeof guessRaw === "number" ? guessRaw : null;
  if (actual === null) return null;

  const ratio = guess !== null && guess > 0 ? actual / guess : null;
  const exact = ratio !== null && isFinite(ratio) && fmtRatio(ratio >= 1 ? ratio : 1 / ratio) === "1";
  const off =
    ratio === null || !isFinite(ratio)
      ? null
      : exact
        ? t.rounds.exact
        : ratio >= 1
          ? fmt(t.rounds.timesLow, { n: fmtRatio(ratio) })
          : fmt(t.rounds.timesHigh, { n: fmtRatio(1 / ratio) });

  // The chip carries the verdict, so it takes the outcome's colour rather than a fixed "miss" red:
  // an estimate can be a long way off in ratio terms and still land inside the acceptable band, and
  // painting that red would contradict the "Correct!" sitting directly above it.
  const accent = correct ? "var(--lime)" : "var(--pink)";

  return (
    <div className="rr-headline-in" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            fontWeight: 800,
            color: "var(--muted)",
          }}
        >
          {t.rounds.actual}
        </div>
        {/* The hero. Everything else on this card exists to give this number a scale to sit on. */}
        <div
          className="display"
          style={{
            fontSize: 40,
            color: "var(--text)",
            lineHeight: 1.05,
            marginTop: 2,
            letterSpacing: -0.5,
          }}
        >
          {fmtNum(actual)}
        </div>
        {spec.unit && (
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 1 }}>{spec.unit}</div>
        )}
      </div>

      {guess !== null && (
        // The second beat. With no rail plotting the distance, the chip IS the statement of how far
        // off you were, so it carries the weight rather than trailing the guess as a tag.
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            borderTop: "1px solid var(--line)",
            paddingTop: 12,
          }}
        >
          {off && (
            <span
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: accent,
                padding: "6px 16px",
                borderRadius: 999,
                border: `1px solid color-mix(in srgb, ${accent} 45%, transparent)`,
                background: `color-mix(in srgb, ${accent} 12%, var(--panel))`,
                whiteSpace: "nowrap",
              }}
            >
              {off}
            </span>
          )}
          {/* Supporting detail, not the point — the ratio above already said how far off. */}
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {fmt(t.rounds.yourGuess, { value: fmtNum(guess) })}
          </span>
        </div>
      )}
    </div>
  );
}
