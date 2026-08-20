/**
 * KnowledgeStats — the player's knowledge as a compact stat card, in the SAME language as the Home hub
 * card: one connected surface, hairline-divided rows, restrained. Each subject is a row — its name, a
 * five-segment strength meter (a game stat, not a finance bar), and its score. Measured subjects sort
 * strongest-first and read in violet (gold once mastered — the only achievement accent); unmeasured
 * subjects hold their place as calm neutral rows with an empty meter, so the full profile always looks
 * complete even with one subject scored. No emojis, no mind-map, no dashed placeholders, no decoration.
 */

import type { BrainBoostSummary } from "@/api/client";
import { shortCategory } from "./styles";

// The fixed roster of subjects the profile measures against — a stable, complete structure.
const SUBJECTS = [
  "Science & Nature",
  "History",
  "Geography",
  "Arts & Literature",
  "Sports",
  "Pop Culture & Entertainment",
  "Money & Business",
];

const MASTERED = 85; // gold — the achievement threshold

export interface KnowledgeStatsLabels {
  eyebrow: string;
  empty: string; // shown only when nothing is measured yet
}

export function KnowledgeStats({
  summary,
  labels,
}: {
  summary: BrainBoostSummary | null;
  labels: KnowledgeStatsLabels;
}) {
  const scoreByCat = new Map<string, number>();
  for (const c of summary?.categories ?? []) {
    if (c.total > 0) scoreByCat.set(c.category, Math.round(c.score));
  }

  const rows = SUBJECTS.map((category) => ({ category, score: scoreByCat.get(category) ?? null }));
  // Measured strongest-first, then the unmeasured subjects in their stable order.
  rows.sort((a, b) => {
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return b.score - a.score;
  });

  const anyMeasured = rows.some((r) => r.score != null);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div className="grw-eyebrow" style={{ marginBottom: 9 }}>{labels.eyebrow}</div>

      <section className="rr-glass" style={{ borderRadius: 20, padding: "2px 16px", overflow: "hidden" }}>
        {rows.map((r, i) => (
          <Row key={r.category} category={r.category} score={r.score} first={i === 0} />
        ))}
      </section>

      {!anyMeasured && (
        <p style={{ color: "var(--muted)", fontSize: 12.5, fontWeight: 500, margin: "9px 2px 0" }}>{labels.empty}</p>
      )}
    </div>
  );
}

function Row({ category, score, first }: { category: string; score: number | null; first: boolean }) {
  const measured = score != null;
  const mastered = measured && score >= MASTERED;
  const accent = mastered ? "var(--amber)" : "var(--brand)";
  const filled = measured ? Math.max(1, Math.min(5, Math.round(score / 20))) : 0;

  return (
    <div
      role="img"
      aria-label={measured ? `${category}, score ${score}` : `${category}, not yet measured`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        minHeight: 48,
        padding: "11px 0",
        borderTop: first ? "none" : "1px solid var(--line)",
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 15,
          fontWeight: 650,
          lineHeight: 1.2,
          color: measured ? "var(--text)" : "var(--muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {shortCategory(category)}
      </span>

      {/* Five-segment strength meter — consistent for every subject, empty when unmeasured. */}
      <span aria-hidden style={{ display: "inline-flex", gap: 3, flex: "none" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            style={{
              width: 13,
              height: 5,
              borderRadius: 3,
              background: i < filled ? accent : "color-mix(in srgb, var(--faint) 42%, transparent)",
            }}
          />
        ))}
      </span>

      <span
        aria-hidden
        style={{
          flex: "none",
          minWidth: 26,
          textAlign: "right",
          fontFamily: "var(--font-display)",
          fontSize: 15,
          fontWeight: 700,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          color: measured ? (mastered ? "var(--amber)" : "var(--text)") : "var(--faint)",
        }}
      >
        {measured ? score : "–"}
      </span>
    </div>
  );
}
