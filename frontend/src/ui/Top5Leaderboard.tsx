import { activeTag } from "@/i18n/format";
// Reusable top-5 leaderboard (royale theme). Used in the per-round interstitial (cumulative
// through-N) and the post-play lobby state (final). Shows the top 5; if "me" is outside the top 5,
// appends my own ranked row. Honest about a thin field — renders whatever real rows exist (no padding).

export interface LeaderRow {
  username: string;
  score: number;
  isMe?: boolean;
}

function Row({ rank, username, score, isMe }: LeaderRow & { rank: number }) {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        borderRadius: 12,
        background: isMe ? "color-mix(in srgb, var(--brand-2) 16%, var(--panel))" : "var(--panel)",
        border: `1px solid ${isMe ? "var(--brand-2)" : "var(--line)"}`,
      }}
    >
      <span
        className={medal ? "emoji" : undefined}
        style={{
          width: 26,
          textAlign: "center",
          fontWeight: 800,
          color: "var(--muted)",
          fontSize: medal ? 16 : 14,
        }}
      >
        {medal ?? rank}
      </span>
      <span style={{ flex: 1, fontWeight: 700, color: isMe ? "var(--brand-2)" : "var(--text)" }}>
        {username}
        {isMe ? " (you)" : ""}
      </span>
      <span style={{ fontWeight: 800, color: "var(--amber)" }}>{score.toLocaleString(activeTag())}</span>
    </div>
  );
}

export function Top5Leaderboard({
  rows,
  emptyHint = "No finishers yet. You're early in the window!",
}: {
  rows: LeaderRow[];
  emptyHint?: string;
}) {
  if (rows.length === 0) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "8px 0" }}>
        {emptyHint}
      </div>
    );
  }
  const ranked = [...rows]
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ ...r, rank: i + 1 }));
  const top5 = ranked.slice(0, 5);
  const me = ranked.find((r) => r.isMe);
  const meOutside = me && me.rank > 5;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {top5.map((r) => (
        <Row key={r.rank} {...r} />
      ))}
      {meOutside && (
        <>
          <div style={{ textAlign: "center", color: "var(--faint)", fontWeight: 800 }}>···</div>
          <Row {...me} />
        </>
      )}
    </div>
  );
}
