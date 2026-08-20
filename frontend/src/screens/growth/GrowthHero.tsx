/**
 * GrowthHero — the dominant, restrained top card. It communicates exactly four things, composed as one
 * quiet system: the current Brain Score, the weekly change, the recent trend, and one line of AI
 * interpretation. Same surface language as the Home cards (rr-glass) — no bespoke panel, no glow, no
 * gold, no green pill. The score sits above a clean trend line (neither obscures the other); the AI
 * read is a single quiet interpretation row beneath a hairline — not a second panel.
 *
 * Ranges slice the same real series client-side (anchored to the latest point), so "+N this week" (a
 * true trailing-7-day delta) stays correct in every range.
 */

import { useState } from "react";
import type React from "react";
import type { BrainBoostSummary } from "@/api/client";
import { fmt } from "@/i18n/useT";
import { GrowthTrail } from "./GrowthTrail";
import { composeBrainRead } from "./brainRead";
import { shortCategory } from "./styles";

const DAY = 86_400_000;
type Range = "7D" | "30D" | "ALL";
const RANGES: { key: Range; days: number }[] = [
  { key: "7D", days: 7 },
  { key: "30D", days: 30 },
  { key: "ALL", days: Infinity },
];

export interface GrowthHeroLabels {
  brainScore: string;
  thisWeek: string;
  today: string;
  daysAgo: string;
  keepPlaying: string;
  aiInsight: string;
  becomingStrength: string;
  strongestNow: string;
  biggestGap: string;
  wellRounded: string;
  focusGap: string;
  insightEmpty: string;
}

export function GrowthHero({
  current,
  delta,
  trend,
  summary,
  labels,
  reduced,
  onFocusGap,
}: {
  current: number;
  delta: number;
  trend: { date: string; score: number }[];
  summary: BrainBoostSummary | null;
  labels: GrowthHeroLabels;
  reduced: boolean;
  onFocusGap?: (category: string) => void;
}) {
  const [range, setRange] = useState<Range>("7D");

  const dates = trend.map((p) => Date.parse(p.date));
  const anchor = dates.length ? dates[dates.length - 1] : 0;
  const days = RANGES.find((r) => r.key === range)!.days;
  const cutoff = anchor - days * DAY;
  const sliced = trend.filter((_, i) => dates[i] >= cutoff);
  const shown = sliced.length >= 2 ? sliced : trend;
  const points = shown.map((p) => p.score);

  const startValue = points.length >= 2 ? points[0] : undefined;
  const spanDays = shown.length >= 2 ? Math.round((anchor - Date.parse(shown[0].date)) / DAY) : 0;
  const startCaption = spanDays > 0 ? fmt(labels.daysAgo, { n: spanDays }) : labels.today;

  return (
    <section className="rr-glass" style={{ borderRadius: 24, padding: 18, display: "flex", flexDirection: "column" }}>
      {/* Eyebrow + quiet range control. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span className="grw-eyebrow" style={{ color: "var(--brand)" }}>{labels.brainScore}</span>
        <div role="tablist" aria-label={labels.brainScore}
          style={{ display: "flex", gap: 2, padding: 2, borderRadius: 999, background: "var(--panel2)", border: "1px solid var(--line)" }}>
          {RANGES.map((r) => {
            const on = r.key === range;
            return (
              <button key={r.key} type="button" role="tab" aria-selected={on} onClick={() => setRange(r.key)}
                style={{
                  border: "none", cursor: "pointer", padding: "5px 9px", borderRadius: 999, fontSize: 10,
                  fontWeight: 800, letterSpacing: "0.02em", lineHeight: 1,
                  background: on ? "var(--panel)" : "transparent",
                  color: on ? "var(--brand)" : "var(--muted)",
                  boxShadow: on ? "0 1px 2px rgba(20,16,8,.12)" : "none",
                }}>
                {r.key}
              </button>
            );
          })}
        </div>
      </div>

      {/* Score + weekly change on one composed line. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 54, lineHeight: 1, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
          {current}
        </span>
        <Change delta={delta} thisWeek={labels.thisWeek} keepPlaying={labels.keepPlaying} />
      </div>

      {/* The trend — clean, composed under the score (neither obscures the other). */}
      <div style={{ width: "100%", height: 118, marginTop: 8 }}>
        <GrowthTrail
          points={points}
          reduced={reduced}
          startValue={startValue}
          endValue={current}
          hideEndValue
          startCaption={points.length >= 2 ? startCaption : undefined}
          endCaption={points.length >= 2 ? labels.today : undefined}
        />
      </div>

      {/* AI interpretation — a single quiet row beneath a hairline. Not a second panel. */}
      <AiRow summary={summary} labels={labels} onFocusGap={onFocusGap} />
    </section>
  );
}

/** Weekly change as plain type — green only when it's genuine positive movement. No pill. */
function Change({ delta, thisWeek, keepPlaying }: { delta: number; thisWeek: string; keepPlaying: string }) {
  if (delta === 0) {
    return <span style={{ color: "var(--muted)", fontSize: 12.5, fontWeight: 500 }}>{keepPlaying}</span>;
  }
  const up = delta > 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, whiteSpace: "nowrap" }}>
      <span style={{ color: up ? "color-mix(in srgb, var(--lime) 62%, var(--text))" : "var(--muted)", fontSize: 15, fontWeight: 800 }}>
        {up ? "↑" : "↓"} {up ? "+" : ""}{delta}
      </span>
      <span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 500 }}>{thisWeek}</span>
    </span>
  );
}

const wrap: React.CSSProperties = { overflowWrap: "break-word" };

/** A single quiet interpretation row: a small violet AI marker, one sentence reading the score's
 * trajectory, and the gap it would train (the whole row is the action when there's a real gap). */
function AiRow({
  summary,
  labels,
  onFocusGap,
}: {
  summary: BrainBoostSummary | null;
  labels: GrowthHeroLabels;
  onFocusGap?: (category: string) => void;
}) {
  const read = composeBrainRead(summary);

  let headline = "";
  if (!read.isEmpty) {
    if (read.risingCategory) headline = fill(labels.becomingStrength, shortCategory(read.risingCategory));
    else if (read.topStrength) headline = fill(labels.strongestNow, shortCategory(read.topStrength));
  }
  const gapText = read.weakSpot
    ? fill(labels.biggestGap, read.weakIsTopic ? read.weakSpot : shortCategory(read.weakSpot))
    : labels.wellRounded;

  const trainTarget = summary?.weaknesses?.[0]?.category ?? (read.weakSpot && !read.weakIsTopic ? read.weakSpot : null);
  const tappable = Boolean(onFocusGap && trainTarget);

  const shell: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid var(--line)",
    background: "transparent",
  };

  const body = (
    <>
      <span aria-hidden style={{ flex: "none", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", color: "var(--brand)", textTransform: "uppercase" }}>
        {labels.aiInsight}
      </span>
      <span aria-hidden style={{ flex: "none", width: 1, alignSelf: "stretch", background: "var(--line)" }} />
      <span style={{ flex: 1, minWidth: 0, textAlign: "left", ...wrap }}>
        {read.isEmpty ? (
          <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 500 }}>{labels.insightEmpty}</span>
        ) : (
          <>
            {headline && <span style={{ color: "var(--text)", fontSize: 13.5, fontWeight: 700 }}>{headline} </span>}
            <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 500 }}>{gapText}</span>
          </>
        )}
      </span>
      {tappable && (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flex: "none", color: "var(--brand)" }}>
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </>
  );

  return tappable ? (
    <button type="button" aria-label={labels.focusGap} onClick={() => onFocusGap!(trainTarget!)}
      style={{ ...shell, cursor: "pointer", border: "none", borderTop: "1px solid var(--line)", fontFamily: "inherit", color: "var(--text)" }}>
      {body}
    </button>
  ) : (
    <div style={shell}>{body}</div>
  );
}

function fill(tpl: string, value: string): string {
  return tpl.replace(/\{[a-z]\}/i, value);
}
