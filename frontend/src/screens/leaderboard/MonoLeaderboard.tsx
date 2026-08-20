import { useMemo } from "react";
import type { HistoryItem } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { titleCase } from "@/lib/titleCase";
import { FitText } from "@/ui/FitText";
import { SkeletonRow } from "@/ui/Skeleton";
import type { Me } from "@/store/session";
import type { LeaderboardRowData } from "./LeaderboardRow";
import { SeasonBanner } from "./SeasonBanner";
import { activeTag } from "@/i18n/format";

/**
 * The mono ("Blank") leaderboard — a market desk, not an arena. Your standing reads like a
 * position: the rating is the big ticker figure, the last settled game's rating swing is a
 * green/red delta chip, the settled-rating history draws a real sparkline, and rank folds into a
 * percentile ("#3 · Top 4%"). Below it, today's field is a minimal ledger where every row carries
 * a thin relative-score bar against the leader. EVERY figure is real server data (history +
 * field entries) — nothing simulated, no fabricated movement.
 */
export function MonoLeaderboard({
  onBack,
  me,
  rows,
  history,
  lastGameDelta,
  windowState,
  loading,
}: {
  onBack: () => void;
  me: Me;
  rows: LeaderboardRowData[];
  history: HistoryItem[];
  lastGameDelta: number | null;
  windowState: string | null;
  loading: boolean;
}) {
  const t = useT();

  // Settled rating trajectory, oldest → newest (history arrives most-recent-first).
  const series = useMemo(
    () =>
      history
        .filter((h) => h.state === "SETTLED" && h.rating_after != null)
        .map((h) => h.rating_after as number)
        .reverse(),
    [history],
  );

  const pct =
    me.rank != null && me.total_players > 0
      ? Math.max(1, Math.round((me.rank / me.total_players) * 100))
      : null;
  const leaderScore = rows.length ? rows[0].score : 0;
  const isFinal = windowState === "SETTLED";
  // The user's row in TODAY's field — the rank that matters most right now. Null until they enter.
  const meRow = rows.find((r) => r.isMe) ?? null;

  return (
    <main style={shell}>
      {/* Top bar: a quiet back control + screen title. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44 }}>
        <button
          type="button"
          aria-label={t.leaderboard.ariaBack}
          onClick={onBack}
          style={{
            display: "grid",
            placeItems: "center",
            width: 40,
            height: 40,
            flex: "none",
            borderRadius: "50%",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            color: "var(--muted)",
            cursor: "pointer",
          }}
        >
          <svg aria-hidden viewBox="0 0 24 24" style={{ width: 17, height: 17 }} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 6 9 12 15 18" />
          </svg>
        </button>
        <FitText
          as="span"
          className="display"
          size={21}
          min={0.58}
          style={{ lineHeight: 1, color: "var(--text)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}
        >
          {titleCase(t.leaderboard.title)}
        </FitText>
      </div>

      {/* Position card — YOUR RANK is the hero figure: today's field rank when you've entered
          (with your banked score beside it), else your global rank. Rating, percentile and the
          real delta/sparkline support it underneath. */}
      <section className="rr-glass" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <FitText
            as="span"
            size={10.5}
            min={0.66}
            style={{
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--muted)",
              flex: "0 1 auto",
              minWidth: 0,
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {meRow ? t.leaderboard.todaysRoyale : t.leaderboard.yourStanding}
          </FitText>
          {me.division && <span style={caps}>{me.division}</span>}
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span
            className="display"
            style={{ fontSize: "clamp(42px, 13vw, 54px)", lineHeight: 1, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}
          >
            {meRow ? `#${meRow.rank}` : me.rank != null ? `#${me.rank}` : t.leaderboard.unranked}
          </span>
          {meRow && (
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
              {fmt(t.home.scoreValue, { n: meRow.score.toLocaleString(activeTag()) })}
            </span>
          )}
          {lastGameDelta != null && <DeltaChip delta={lastGameDelta} label={t.leaderboard.fromLastGame} />}
        </div>

        <div style={{ color: "var(--muted)", fontSize: 12.5, fontWeight: 500 }}>
          {me.rank != null ? (
            <>
              {t.leaderboard.globalRank} #{me.rank}
              {pct != null && <> · {fmt(t.leaderboard.topPercent, { pct })}</>}
              {" · "}
              {t.leaderboard.rating} {me.rating.toLocaleString(activeTag())}
              {me.total_players > 0 && <> · {fmt(t.home.ofTotal, { total: me.total_players.toLocaleString(activeTag()) })}</>}
            </>
          ) : (
            <>
              {t.leaderboard.rating} {me.rating.toLocaleString(activeTag())}
            </>
          )}
        </div>

        {series.length >= 2 && <Sparkline values={series} label={t.leaderboard.ratingTrend} />}
      </section>

      <SeasonBanner />

      {/* Today's field — a minimal ledger with relative-score bars (score / leader). */}
      <section className="rr-glass" style={{ display: "flex", flexDirection: "column", padding: "16px 22px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, paddingBottom: 8 }}>
          <FitText
            as="span"
            size={10.5}
            min={0.66}
            style={{
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--muted)",
              flex: "0 1 auto",
              minWidth: 0,
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {t.leaderboard.todaysRoyale}
          </FitText>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
            <span
              aria-hidden
              style={{ width: 6, height: 6, borderRadius: "50%", background: isFinal ? "var(--lime)" : "var(--brand)", flex: "none" }}
            />
            <span style={{ ...caps, color: isFinal ? "var(--lime)" : "var(--brand)" }}>
              {isFinal ? t.leaderboard.finalStandings : t.leaderboard.provisional}
            </span>
          </span>
        </div>

        {loading ? (
          <div aria-busy aria-label={t.common.loading} style={{ display: "grid", gap: 14, padding: "14px 0" }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: "18px 0", color: "var(--muted)", fontSize: 13, fontWeight: 500 }}>
            {t.leaderboard.noScoresYet}
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={`${row.rank}-${row.username}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: row.isMe ? "12px 12px" : "12px 0",
                borderTop: "1px solid var(--line)",
                // Your row is unmissable: a purple wash + rounded inset (the row bleeds slightly
                // wider than the ledger column so it reads as its own highlighted band).
                margin: row.isMe ? "0 -12px" : undefined,
                borderRadius: row.isMe ? 12 : undefined,
                background: row.isMe ? "color-mix(in srgb, var(--brand) 9%, transparent)" : undefined,
              }}
            >
              <span
                style={{
                  flex: "none",
                  width: 26,
                  fontSize: 12.5,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color: row.rank <= 3 ? "var(--brand)" : "var(--faint)",
                }}
              >
                {row.rank}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 14.5,
                    fontWeight: row.isMe ? 700 : 600,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.username}
                  {row.isMe && (
                    <span
                      style={{
                        flex: "none",
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "color-mix(in srgb, var(--brand) 14%, transparent)",
                        color: "var(--brand)",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {t.leaderboard.youLabel}
                    </span>
                  )}
                </span>
                {/* Relative-score bar vs the leader — a real ratio, rendered as market depth. */}
                <span aria-hidden style={{ display: "block", marginTop: 6, height: 2, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      width: `${leaderScore > 0 ? Math.max(2, Math.round((row.score / leaderScore) * 100)) : 0}%`,
                      borderRadius: 999,
                      background: row.isMe ? "var(--brand)" : "color-mix(in srgb, var(--text) 30%, transparent)",
                    }}
                  />
                </span>
              </span>
              <span
                style={{
                  flex: "none",
                  fontSize: 14.5,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--text)",
                }}
              >
                {row.score.toLocaleString(activeTag())}
              </span>
            </div>
          ))
        )}
      </section>

      {/* Pinned "you" bar — your exact field position stays on screen while the ledger scrolls
          (fixed just above the nav). Only when you're actually in today's field. */}
      {meRow && (
        <div
          aria-label={t.leaderboard.youLabel}
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: "calc(96px + env(safe-area-inset-bottom))",
            zIndex: 25,
            display: "flex",
            justifyContent: "center",
            padding: "0 clamp(14px, 4vw, 20px)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 440,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 18px",
              borderRadius: "var(--radius-card, 14px)",
              background: "color-mix(in srgb, var(--panel) 92%, transparent)",
              border: "1px solid color-mix(in srgb, var(--brand) 35%, var(--line))",
              boxShadow: "inset 0 1px 0 var(--sheen), 0 10px 30px rgba(17,17,17,.18)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
            }}
          >
            <span
              className="display"
              style={{ fontSize: 19, lineHeight: 1, color: "var(--brand)", fontVariantNumeric: "tabular-nums", flex: "none" }}
            >
              #{meRow.rank}
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {meRow.username}
            </span>
            <span style={{ flex: "none", fontSize: 14.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>
              {meRow.score.toLocaleString(activeTag())}
            </span>
          </div>
        </div>
      )}
    </main>
  );
}

/** Green/red rating-swing chip — market language for the last settled game's real Elo movement. */
function DeltaChip({ delta, label }: { delta: number; label: string }) {
  const up = delta >= 0;
  const color = up ? "var(--lime)" : "var(--pink)";
  return (
    <span
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 10px",
        borderRadius: 999,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        fontSize: 12.5,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span aria-hidden style={{ fontSize: 10 }}>{up ? "▲" : "▼"}</span>
      {Math.abs(delta)}
    </span>
  );
}

/** Real settled-rating sparkline (SVG polyline, accent stroke, end dot). Pure data → pure line. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 100;
  const h = 30;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? w : (i / (values.length - 1)) * w;
    const y = h - 4 - ((v - min) / span) * (h - 8);
    return [x, y] as const;
  });
  const last = pts[pts.length - 1];
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: 44, display: "block" }}
    >
      <line x1={0} y1={h - 1} x2={w} y2={h - 1} stroke="var(--line)" strokeWidth={0.6} />
      <polyline
        points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none"
        stroke="var(--brand)"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r={2.2} fill="var(--brand)" />
    </svg>
  );
}

const shell: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  margin: "0 auto",
  minHeight: "100dvh",
  // Bottom padding clears the nav PLUS the pinned "you" bar, so the last ledger row always scrolls
  // into view above both.
  padding:
    "calc(env(safe-area-inset-top, 0px) + 14px) clamp(14px, 4vw, 20px) calc(196px + env(safe-area-inset-bottom))",
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-shell, 14px)",
};

const caps: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--muted)",
};
