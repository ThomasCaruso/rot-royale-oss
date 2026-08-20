/**
 * Brain Score card — the page's headline moment after the Brain Profile. Deliberately minimal: a
 * two-column card (copy left, sparkline right) with the score in the display serif and a single
 * clean rising lavender trend. No pills, no badges, no ranking, no extra stats — just the number,
 * the weekly move, one sentence, and the line.
 */

import { CardLabel, Sparkline } from "./ui";
import { growthCardStyle, SERIF } from "./styles";

export function BrainScoreCard({
  current,
  delta,
  trend,
  labels,
}: {
  current: number;
  delta: number;
  trend: number[];
  labels: { brainScore: string; thisWeek: string; momentum: string; keepPlaying: string };
}) {
  return (
    <section
      style={{
        ...growthCardStyle,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        padding: "26px 28px",
      }}
    >
      {/* Left: label, serif score, weekly delta, one supporting line. */}
      <div style={{ minWidth: 0 }}>
        <CardLabel>{labels.brainScore}</CardLabel>
        <div
          style={{
            fontFamily: SERIF,
            color: "var(--text)",
            fontSize: "clamp(60px, 15vw, 72px)",
            lineHeight: 0.9,
            fontWeight: 600,
            marginTop: 18,
            letterSpacing: "-0.01em",
          }}
        >
          {current}
        </div>

        {delta > 0 ? (
          <div style={{ color: "var(--lime)", fontSize: 18, fontWeight: 700, marginTop: 14 }}>
            ↑ +{delta} {labels.thisWeek}
          </div>
        ) : delta < 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 18, fontWeight: 700, marginTop: 14 }}>
            ↓ {Math.abs(delta)} {labels.thisWeek}
          </div>
        ) : null}

        <div style={{ color: "var(--muted)", fontSize: 15, marginTop: 10, lineHeight: 1.4 }}>
          {delta > 0 ? labels.momentum : labels.keepPlaying}
        </div>
      </div>

      {/* Right: the soft purple haze sparkline (or a faint grey placeholder when there's no trend
          yet). Fluid width so it never overflows a narrow card. */}
      <div style={{ width: "clamp(150px, 44%, 230px)", flexShrink: 0 }}>
        <Sparkline values={trend} />
      </div>
    </section>
  );
}
