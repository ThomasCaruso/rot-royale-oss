/**
 * Consistency — the "you're building momentum" card. The current streak as one clean line, a
 * restrained flame, and a quiet check. Calm — no badge rings, no metric dump.
 */

import { FlameIcon } from "@/ui/icons";
import { fmt } from "@/i18n/useT";
import { CardLabel } from "./ui";
import { growthCardStyle } from "./styles";

export function ConsistencyCard({
  streak,
  labels,
}: {
  streak: number;
  labels: { consistency: string; streakLine: string; keepStreak: string };
}) {
  const hasStreak = streak >= 1;
  return (
    <section style={{ ...growthCardStyle, display: "flex", alignItems: "center", gap: 14, padding: 18 }}>
      <span aria-hidden style={{ flex: "none", display: "flex", color: "var(--lime)" }}>
        <FlameIcon size={24} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <CardLabel>{labels.consistency}</CardLabel>
        {hasStreak ? (
          <>
            <div style={{ margin: "5px 0 0", fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
              {fmt(labels.streakLine, { n: streak })}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>{labels.keepStreak}</div>
          </>
        ) : (
          <div style={{ margin: "5px 0 0", fontSize: 15, fontWeight: 600, color: "var(--muted)" }}>
            {labels.keepStreak}
          </div>
        )}
      </div>
      {hasStreak && (
        <span aria-hidden style={{ flex: "none", display: "flex", color: "var(--lime)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M5 12l4.5 4.5L19 7"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
    </section>
  );
}
