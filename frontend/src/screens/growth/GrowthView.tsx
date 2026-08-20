/**
 * GrowthView — the "Your Growth" screen composition (pure; the data-fetching GrowthScreen wraps it).
 *
 * Recomposed to read as ONE premium game screen, not a stack of analytics cards. The physique mirrors
 * the Home/Friends language: a SINGLE dominant surface up top (the Growth Hero — Brain Score + the
 * progression trail + the AI's read of that growth, fused into one experience), then quiet open rows
 * beneath it (the knowledge profile as a hairline-divided subject table, the streak as a footer row).
 * Nothing floats as its own equally-weighted white card; hierarchy comes from ONE anchor + descending
 * weight, from typography and space — never from boxes of the same radius/shadow stacked down a page.
 *
 * It flows naturally down the phone (no rigid 100dvh grid, no fixed-height sections, no shrink-to-fit):
 * every zone sizes to its real content, so sparse data simply makes the screen shorter instead of
 * leaving dead space, and rich data scrolls a little — both honest.
 */

import type { GrowthResponse, BrainBoostSummary } from "@/api/client";
import { GrowthHero } from "./GrowthHero";
import { KnowledgeStats } from "./KnowledgeStats";
import { GrowthStreakRow } from "./GrowthStreakRow";
import { BackButton } from "./ui";

// One small injected stylesheet: the page shell + the single narrow-width breakpoint (inline styles
// can't express media queries). Deliberate mobile values — never viewport clamps that shrink content.
// A restrained header (the signature is the growth hero, not the title) and a tight vertical rhythm
// keep the whole screen at Home/Friends density — one composed phone screen, not a stretched page.
const CSS = `
.grw-main{width:100%;max-width:440px;margin:0 auto;box-sizing:border-box;
  padding:calc(16px + env(safe-area-inset-top)) 20px calc(150px + env(safe-area-inset-bottom));
  display:flex;flex-direction:column;gap:18px}
.grw-header{display:flex;align-items:center;gap:13px}
.grw-title{font-family:var(--font-display);font-size:25px;line-height:1.02;font-weight:700;letter-spacing:-.01em;color:var(--text);margin:0}
.grw-sub{color:var(--muted);font-size:12.5px;font-weight:500;line-height:1.3;margin-top:3px}
.grw-eyebrow{font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
@media (max-width:360px){.grw-main{padding-left:16px;padding-right:16px}.grw-title{font-size:23px}}
`;

export interface GrowthLabels {
  title: string;
  subtitle: string;
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
  knowledgeProfile: string;
  emptyProfile: string;
  dayStreak: string;
  keepStreak: string;
  error: string;
  back: string;
}

export function GrowthView({
  data,
  summary,
  error,
  reduced,
  labels,
  onBack,
  onTrainCategory,
}: {
  data: GrowthResponse | null;
  summary: BrainBoostSummary | null;
  error: boolean;
  reduced: boolean;
  labels: GrowthLabels;
  onBack: () => void;
  onTrainCategory?: (category: string) => void;
}) {
  return (
    <main className="grw-main">
      <style>{CSS}</style>

      <header className="grw-header">
        <BackButton onClick={onBack} label={labels.back} />
        <div style={{ minWidth: 0 }}>
          <h1 className="grw-title">{labels.title}</h1>
          <div className="grw-sub">{labels.subtitle}</div>
        </div>
      </header>

      {/* THE dominant surface: Brain Score + growth trail + the AI's read of that growth, fused. */}
      {data ? (
        <GrowthHero
          current={data.brain_score.current}
          delta={data.brain_score.delta}
          trend={data.trend}
          summary={summary}
          reduced={reduced}
          onFocusGap={onTrainCategory}
          labels={labels}
        />
      ) : (
        <section
          className="rr-glass"
          style={{ borderRadius: 28, padding: 22, minHeight: 200, display: "grid", placeItems: "center" }}
        >
          <div style={{ color: "var(--muted)", fontSize: 14 }}>{error ? labels.error : "…"}</div>
        </section>
      )}

      {/* Knowledge Profile — a compact stat card in the Home hub language (full roster, honest neutral
          placeholders for unmeasured subjects), then the streak as a quiet footer row. */}
      <KnowledgeStats summary={summary} labels={{ eyebrow: labels.knowledgeProfile, empty: labels.emptyProfile }} />

      {data && (
        <GrowthStreakRow
          streak={data.consistency.streak}
          labels={{ dayStreak: labels.dayStreak, keepStreak: labels.keepStreak }}
        />
      )}
    </main>
  );
}
