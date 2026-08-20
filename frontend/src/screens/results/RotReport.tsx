import { useCallback, useMemo, useState } from "react";
import { fmt, useT } from "@/i18n/useT";
import {
  buildDailyShareUrl,
  buildRotShareText,
  buildRoundBoxes,
  formatSeconds,
  type RotReportData,
  rotTitleKey,
} from "@/lib/rotReport";
import { formatLocalTime } from "@/lib/time";
import { Confetti } from "@/ui/Confetti";
import { FitText } from "@/ui/FitText";
import { useReducedMotion } from "@/ui/useReducedMotion";
import { FriendsTodayBoard } from "./FriendsTodayBoard";
import { activeTag } from "@/i18n/format";

/** Today's Daily Royale app URL (origin + path, no query/hash) to hang the neutral share ref on.
 * Falls back to the prod domain when there's no window (SSR / tests) so the share text stays useful. */
function shareBase(): string {
  if (typeof window !== "undefined" && window.location) {
    return window.location.origin + window.location.pathname;
  }
  return "https://rotroyale.live/";
}

/**
 * ROT REPORT — the INSTANT personal result card, shown the moment a player finishes their 8 Daily
 * Royale questions. Minimal editorial redesign: an airy, hairline-ruled layout that reads as clean
 * ink-on-paper under the default (mono) theme and stays consistent on every skin via theme tokens
 * (--bg / --text / --brand / --line / --cta) — no hardcoded gold/glow arcade chrome.
 *
 * Daily Royale is a Wordle-style PUBLIC score flex: you share how you did and friends play the SAME
 * daily game and compare — it is NOT a 1v1 challenge (direct friend challenges are Duel mode's job).
 * So the card shows the player's OWN run (score / timing / round-by-round grid + funny title) with
 * social-comparison share CTAs and a plain link to today's game — never challenge language and never
 * a per-friend score-vs-score state. The 24h ranked placement isn't known yet, so it's a clearly
 * separated pending line; the only live comparison number shown is the honest real attempt count
 * (`attempts`, from WindowOut.entry_count) when available. Nothing is fabricated (no percentile/
 * average/rank pre-settlement; no money/"player" framing — DESIGN §7). Pure given its props.
 */
export function RotReport({
  report,
  resultsAt,
  attempts = null,
  windowId,
  challengeUrl,
  challengeScore,
  challengeNo,
  onExit,
  onPractice,
}: {
  report: RotReportData;
  /** UTC ISO of when daily placement finalizes (settle_at, or close_at fallback); null → generic. */
  resultsAt: string | null;
  /** Honest real attempt count today (WindowOut.entry_count); null/0 → the line is hidden. */
  attempts?: number | null;
  /** Window id for the friends-today board; omitted in tests / non-contest callers. */
  windowId?: string;
  /** The real `…/c/<id>` share link for this run + its point-score/number (the viral loop). When
   * present the Share action produces a spoiler-free "beat my {score} 👇 <link>" instead of the
   * neutral app link; absent (tests / creation failed) falls back to the plain link. */
  challengeUrl?: string;
  challengeScore?: number;
  challengeNo?: number;
  onExit: () => void;
  onPractice: () => void;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const [feedback, setFeedback] = useState<"share" | null>(null);

  const titleText = t.rotReport[rotTitleKey(report.score)];

  const { shareText, link } = useMemo(() => {
    // Viral loop: when a real challenge link exists, share the spoiler-free, score-only recruit text
    // ("Rot Royale #142 · beat my 742 👇 <link>") that opens the challenge page → guest play.
    if (challengeUrl) {
      const text = fmt(t.rotReport.shareBeat, {
        no: challengeNo ?? "",
        score: challengeScore ?? report.score,
        link: challengeUrl,
      });
      return { shareText: text, link: challengeUrl };
    }
    const linkUrl = buildDailyShareUrl(shareBase());
    // Wordle-style stat lines (own-run facts only), included when the data is real. The tick/cross
    // row leads: it is the part that renders as a picture of the run in any chat client, and it
    // spoils nothing — it says WHERE the run broke, never which answer was right.
    const statLines = [
      report.rounds.length > 0 ? buildRoundBoxes(report.rounds) : "",
      report.avgMs != null ? `${t.rotReport.avgTime}: ${formatSeconds(report.avgMs)}` : "",
    ].filter(Boolean);
    const text = buildRotShareText({
      heading: t.rotReport.shareHeading,
      correctLine: fmt(t.rotReport.shareCorrect, { score: report.score, total: report.total }),
      titleLine: fmt(t.rotReport.shareTitle, { title: titleText }),
      statLines,
      taglineLink: fmt(t.rotReport.shareTagline, { link: linkUrl }),
    });
    return { shareText: text, link: linkUrl };
  }, [
    challengeUrl,
    challengeScore,
    challengeNo,
    report.score,
    report.total,
    report.avgMs,
    report.rounds,
    titleText,
    t,
  ]);

  const copy = useCallback(async (value: string): Promise<boolean> => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }, []);

  // "Share Rot Report": native share the report + today's link when available, else copy the text.
  const shareReport = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.share) {
      void navigator.share({ text: shareText, url: link }).catch(() => {});
      return;
    }
    void copy(shareText).then((ok) => ok && setFeedback("share"));
  }, [shareText, link, copy]);

  // Earned celebration: a genuine top run (7–8 / 8) is a real achievement (DESIGN §7) — one calm,
  // minimal burst, reserved so it feels earned, not routine. Self-disables under reduced motion.
  const celebrate = !reduced && report.score >= 7;

  // Only the stats backed by real data render (no fabricated zeros). Correct/incorrect always exist;
  // timing only when a round timed cleanly. Laid out as a hairline-ruled 2-up grid (2 or 4 cells).
  const stats: { label: string; value: string }[] = [
    { label: t.rotReport.correct, value: `${report.score}` },
    { label: t.rotReport.incorrect, value: `${report.incorrect}` },
    ...(report.avgMs != null
      ? [{ label: t.rotReport.avgTime, value: formatSeconds(report.avgMs) }]
      : []),
    ...(report.fastestMs != null
      ? [{ label: t.rotReport.fastest, value: formatSeconds(report.fastestMs) }]
      : []),
  ];

  return (
    <main style={wrap}>
      {celebrate && <Confetti burstKey={report.score + 1} count={70} />}
      <div style={inner}>
        {/* Header — violet eyebrow over the wordmark. */}
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={eyebrow}>{t.rotReport.eyebrow}</div>
          <div className="display" style={title}>
            {t.rotReport.title}
          </div>
        </div>

        {/* Hero — the big X / Y score over the funny verdict, then a short centred rule. */}
        <div style={{ textAlign: "center" }}>
          <div className="display" style={scoreNum}>
            {report.score}
            <span style={scoreDen}> / {report.total}</span>
          </div>
          <div className="display" style={verdict}>
            {titleText}
          </div>
          <div style={heroRule} />
        </div>

        {/* Stat grid — hairline-ruled, no boxes. */}
        <div style={statGrid}>
          {stats.map((s, i) => (
            <div key={s.label} style={statCell(i, stats.length)}>
              <FitText as="div" size={10.5} min={0.66} style={{ ...statLabelBase, width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}>{s.label}</FitText>
              {/* A longer localized value/unit shrinks to fit the cell (FitText) rather than
                  ellipsizing; the numbers that are pure digits already fit and are untouched. */}
              <FitText as="div" className="display" size={27} min={0.55} style={{ fontWeight: 700, color: "var(--text)", width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}>
                {s.value}
              </FitText>
            </div>
          ))}
        </div>

        {/* Below-the-fold detail: the round-by-round grid + the played/pending meta, under one rule. */}
        <div style={metaBlock}>
          {report.rounds.length > 0 && (
            <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
              <FitText as="div" size={10.5} min={0.66} style={{ ...statLabelBase, width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}>{t.rotReport.roundByRound}</FitText>
              <RoundGrid rounds={report.rounds} label={fmt(t.rotReport.roundGridLabel, { score: report.score, total: report.total })} />
            </div>
          )}

          {/* Honest live comparison (real attempt count, entry_count) · pending placement. No
           * percentile/average/rank pre-settlement — DESIGN §7. Attempt line hidden when zero. */}
          <div style={metaRow}>
            {attempts != null && attempts > 0 && (
              <>
                <span style={metaItem}>
                  <span aria-hidden style={dot} />
                  {fmt(t.rotReport.playedToday, { n: attempts.toLocaleString(activeTag()) })}
                </span>
                <span aria-hidden style={metaSep} />
              </>
            )}
            <span style={metaItem}>
              {resultsAt
                ? fmt(t.rotReport.pendingAt, { time: formatLocalTime(resultsAt) })
                : `${t.rotReport.pendingLabel} · ${t.rotReport.pendingGeneric}`}
            </span>
          </div>
        </div>

        {/* Friends-today social board — bare, under a rule, so it reads as one clean surface. */}
        {windowId && (
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 18 }}>
            <FriendsTodayBoard windowId={windowId} bare />
          </div>
        )}

        {/* CTA — the single ink Share pill, then plain nav links. */}
        <button type="button" onClick={shareReport} style={primaryBtn}>
          {feedback === "share" ? t.rotReport.copied : t.rotReport.shareReport}
        </button>

        <div style={footerRow}>
          <button type="button" onClick={onExit} style={footerLink}>
            {t.common.backToHub}
          </button>
          <span aria-hidden style={metaSep} />
          <button type="button" onClick={onPractice} style={footerLink}>
            {t.results.practice}
          </button>
        </div>
      </div>
    </main>
  );
}

const wrap: React.CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  // No `justify-content: center` — that clips a tall card on short phones. `margin: auto` on `inner`
  // centres when there's room AND stays fully scrollable when content is taller than the viewport.
  padding:
    "calc(clamp(20px, 5vh, 44px) + env(safe-area-inset-top)) clamp(20px, 6vw, 28px) calc(30px + env(safe-area-inset-bottom))",
};

const inner: React.CSSProperties = {
  width: "100%",
  maxWidth: 400,
  margin: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "clamp(18px, 5vw, 26px)",
};

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: "var(--brand)",
};

const title: React.CSSProperties = {
  fontSize: "clamp(30px, 9.5vw, 46px)",
  lineHeight: 1.02,
  letterSpacing: "0.01em",
  fontWeight: 700,
  color: "var(--text)",
};

const scoreNum: React.CSSProperties = {
  fontSize: "clamp(60px, 20vw, 96px)",
  lineHeight: 1,
  fontWeight: 700,
  color: "var(--text)",
};

const scoreDen: React.CSSProperties = {
  color: "var(--faint)",
  fontSize: "0.46em",
  fontWeight: 500,
};

const verdict: React.CSSProperties = {
  fontSize: "clamp(20px, 5.6vw, 27px)",
  fontWeight: 600,
  color: "var(--text)",
  marginTop: 10,
};

const heroRule: React.CSSProperties = {
  width: 46,
  height: 1,
  background: "var(--line)",
  margin: "18px auto 0",
};

const statGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
};

function statCell(i: number, len: number): React.CSSProperties {
  const col = i % 2;
  return {
    minWidth: 0,
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "16px 10px",
    borderRight: col === 0 && i + 1 < len ? "1px solid var(--line)" : "none",
    borderBottom: i + 2 < len ? "1px solid var(--line)" : "none",
  };
}

/** Stat label styling minus font-size — the size is owned by the FitText that renders it (10.5px
 *  design ceiling), so a longer localized label shrinks to one line instead of wrapping. */
const statLabelBase: React.CSSProperties = {
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: "var(--muted)",
};

const metaBlock: React.CSSProperties = {
  borderTop: "1px solid var(--line)",
  paddingTop: 18,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const metaRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "center",
  alignItems: "center",
  gap: 12,
};

const metaItem: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--muted)",
};

const dot: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: "var(--brand)",
  marginRight: 8,
};

const metaSep: React.CSSProperties = {
  width: 1,
  height: 13,
  background: "var(--line)",
};

const primaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "16px 22px",
  borderRadius: 14,
  border: "none",
  background: "var(--cta)",
  color: "var(--ctaText)",
  fontFamily: "var(--font-display)",
  fontSize: 16.5,
  fontWeight: 700,
  letterSpacing: "0.01em",
  cursor: "pointer",
};

const footerRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: 20,
};

const footerLink: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: "2px 0",
  color: "var(--muted)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

/**
 * The run as a row of tick/cross boxes, in play order — the Wordle-style shape of the run.
 *
 * Correctness is carried by the GLYPH as well as the fill, so the row reads without relying on
 * telling green from red (roughly 1 in 12 men can't). Green/red follow the app-wide convention
 * (`--lime` correct, `--pink` wrong — the same pair `AnswerPill` uses on the reveal), so a box here
 * means the same thing it meant during play.
 *
 * The row wraps rather than shrinking: eight boxes fit one line on every phone width, but a longer
 * run (or a large accessibility text size) folds to a second line instead of squeezing the boxes
 * below a comfortable tap-sized target.
 */
function RoundGrid({ rounds, label }: { rounds: boolean[]; label: string }) {
  return (
    <div role="img" aria-label={label} style={gridRow}>
      {rounds.map((ok, i) => (
        <span key={i} aria-hidden style={gridBox(ok)}>
          {ok ? "✓" : "✕"}
        </span>
      ))}
    </div>
  );
}

const gridRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "center",
  gap: 7,
};

const gridBox = (ok: boolean): React.CSSProperties => ({
  display: "grid",
  placeItems: "center",
  width: 32,
  height: 32,
  flex: "none",
  borderRadius: 9,
  background: ok ? "var(--lime)" : "var(--pink)",
  // The glyph sits on a saturated fill in both states; white holds contrast on either.
  color: "#fff",
  fontSize: 16,
  fontWeight: 800,
  lineHeight: 1,
});
