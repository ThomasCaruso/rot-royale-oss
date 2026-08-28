import { fmtNum } from "@/modules/estimate/logScale";
import { fmt, useT } from "@/i18n/useT";

/**
 * The answer — which for a Fermi question is the entire reason to have asked.
 *
 * The round used to end on "counted" / "no points" and never say the number. A player who guessed
 * 550 when the truth was 1,000 learned nothing, and the one satisfying thing about this round type
 * ("huh, really?") was thrown away at the moment it was earned.
 *
 * Distance is shown as a RATIO, not a difference. These questions span orders of magnitude, so
 * "450 off" is meaningless — 450 off a thousand is a good guess and 450 off ten is not. "1.8x low"
 * is the honest unit of being wrong here, and it's how the scoring thinks about it too.
 */
export function EstimateReveal({
  spec,
  answer,
  result,
}: {
  spec: { unit: string | null; slider_min: number; slider_max: number };
  answer: Record<string, unknown>;
  result: Record<string, unknown>;
}) {
  // Before the early return below — a hook after a conditional return breaks the rules of hooks.
  const t = useT();
  const actual = typeof answer.answer === "number" ? answer.answer : null;
  const guessRaw = result.final_guess;
  const guess = typeof guessRaw === "number" ? guessRaw : null;
  if (actual === null) return null;

  const unit = spec.unit ? ` ${spec.unit}` : "";
  // log positions so the marks sit where the DIAL put them — a linear bar would bunch every
  // interesting guess into the left edge.
  const lo = Math.log(Math.max(spec.slider_min, 1e-9));
  const hi = Math.log(Math.max(spec.slider_max, spec.slider_min * 1.0001));
  const at = (v: number) =>
    Math.max(0, Math.min(1, (Math.log(Math.max(v, 1e-9)) - lo) / (hi - lo))) * 100;

  const ratio = guess !== null && guess > 0 ? actual / guess : null;
  const off =
    ratio === null || !isFinite(ratio)
      ? null
      : ratio >= 1
        ? fmt(t.rounds.timesLow, { n: (Math.round(ratio * 10) / 10).toLocaleString() })
        : fmt(t.rounds.timesHigh, { n: (Math.round((1 / ratio) * 10) / 10).toLocaleString() });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            fontWeight: 800,
            color: "var(--muted)",
          }}
        >
          {t.rounds.actual}
        </div>
        <div className="display" style={{ fontSize: 30, color: "var(--text)", lineHeight: 1.15 }}>
          {fmtNum(actual)}
          <span style={{ fontSize: 16, color: "var(--muted)" }}>{unit}</span>
        </div>
      </div>

      {guess !== null && (
        <>
          {/* Both marks on one axis: the gap between them IS the feedback, and seeing it on the
              same scale the dial used is what connects the guess to the miss. */}
          <div style={{ position: "relative", height: 30, margin: "2px 4px 0" }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 13,
                height: 4,
                borderRadius: 999,
                background: "var(--panel2)",
              }}
            />
            {/* The SEGMENT between the two marks is the point. Two dots on a rail leave the reader
                measuring the gap by eye; drawing it says "this much" in one glance — and on a log
                axis a small-looking gap really is a small miss, which is the intuition worth
                building. */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                left: `${Math.min(at(guess), at(actual))}%`,
                width: `${Math.abs(at(actual) - at(guess))}%`,
                top: 13,
                height: 4,
                borderRadius: 999,
                background: "var(--amber)",
                opacity: 0.85,
              }}
            />
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: `${at(guess)}%`,
                top: 8,
                width: 14,
                height: 14,
                marginLeft: -7,
                borderRadius: "50%",
                background: "var(--muted)",
                border: "2px solid var(--panel)",
              }}
            />
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: `${at(actual)}%`,
                top: 5,
                width: 20,
                height: 20,
                marginLeft: -10,
                borderRadius: "50%",
                background: "var(--lime)",
                border: "2px solid var(--panel)",
                boxShadow: "0 0 14px var(--glow)",
              }}
            />
          </div>
          <div style={{ textAlign: "center", fontSize: 13, color: "var(--muted)" }}>
            {fmt(t.rounds.yourGuess, { value: fmtNum(guess) })}
            {unit}
            {off ? ` — ${off}` : ""}
          </div>
        </>
      )}
    </div>
  );
}
