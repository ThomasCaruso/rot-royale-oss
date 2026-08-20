import { fmt, useT } from "@/i18n/useT";
import { Avatar } from "@/screens/home/Avatar";
import { FitText } from "@/ui/FitText";

export interface LeaderRow {
  username: string;
  score: number;
  isMe?: boolean;
  /** Identity fields are optional with safe defaults (ninja, frameless) so existing
   * constructors/fixtures keep working — same pattern as LeaderboardRowData. Real data
   * threads them from FieldEntry (avatar_preset / equipped_frame). */
  avatar_preset?: string;
  equipped_frame?: string | null;
}

const RANK_COLORS: Record<number, { bg: string; fg: string }> = {
  1: { bg: "linear-gradient(180deg, #ffe680, #f59e0b)", fg: "#3a1c04" },
  2: { bg: "linear-gradient(180deg, #d7ccff, #a994d9)", fg: "#241044" },
  3: { bg: "linear-gradient(180deg, #d28b4a, #b9793d)", fg: "#241044" },
};

/**
 * Top-of-field preview for the current window. Renders the field (REAL entries only, sorted desc —
 * the cold-start bot padding was removed). The count chip says "N players" — honest now that every
 * one of them is a real entrant. Early in a window the field is genuinely thin, so any row beyond
 * the real entries reads "Waiting for players…" rather than being filled with a synthetic name.
 */
export function LeaderboardPreview({
  rows,
  fieldCount,
  rowsShown = 5,
}: {
  rows: LeaderRow[];
  fieldCount: number;
  rowsShown?: number;
}) {
  const t = useT();
  const ranked = [...rows].sort((a, b) => b.score - a.score).slice(0, rowsShown);
  const pad = Math.max(0, rowsShown - ranked.length);

  return (
    <section
      style={{
        borderRadius: 28,
        padding: 18,
        background: "linear-gradient(180deg, var(--panel2), var(--panel))",
        border: "1px solid var(--line)",
        boxShadow: "0 18px 40px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <FitText
          as="span"
          size={11}
          min={0.66}
          style={{
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            fontWeight: 800,
            color: "var(--muted)",
            flex: "0 1 auto",
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {t.home.leaderboard}
        </FitText>
        <span
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            background: "color-mix(in srgb, var(--panel2) 60%, transparent)",
            border: "1px solid var(--line)",
            fontSize: 11,
            fontWeight: 800,
            color: "var(--brand-2)",
          }}
        >
          {fmt(t.home.fieldOf, { n: fieldCount })}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {ranked.map((r, i) => (
          <Row key={`r${i}`} rank={i + 1} row={r} />
        ))}
        {Array.from({ length: pad }, (_, k) => (
          <WaitingRow key={`w${k}`} rank={ranked.length + k + 1} />
        ))}
      </div>
    </section>
  );
}

function rankBadge(rank: number) {
  const c = RANK_COLORS[rank];
  return (
    <span
      style={{
        width: 26,
        height: 26,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        flex: "none",
        fontWeight: 800,
        fontSize: 13,
        background: c?.bg ?? "color-mix(in srgb, var(--line) 80%, transparent)",
        color: c?.fg ?? "var(--muted)",
        boxShadow: rank === 1 ? "0 0 12px rgba(255,193,52,.5)" : "none",
      }}
    >
      {rank}
    </span>
  );
}

function Row({ rank, row }: { rank: number; row: LeaderRow }) {
  const top = rank === 1;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 16,
        background: row.isMe
          ? "color-mix(in srgb, var(--amber) 12%, var(--panel))"
          : "color-mix(in srgb, var(--panel) 40%, transparent)",
        border: `1px solid ${row.isMe ? "color-mix(in srgb, var(--amber) 50%, transparent)" : "var(--line)"}`,
        boxShadow: row.isMe ? "0 0 16px color-mix(in srgb, var(--amber) 22%, transparent)" : "none",
      }}
    >
      {rankBadge(rank)}
      {/* Frame (when equipped) wins over the plain ring; a frameless "me" row keeps the amber
       * ring. At size 30 the ornament overhang (~7px) sits inside the row's 8px top padding.
       * animated=false: row lists stay animation-free (same rule as the full leaderboard). */}
      <Avatar
        size={30}
        ring={row.isMe ? "var(--amber)" : "var(--line)"}
        preset={row.avatar_preset}
        frame={row.equipped_frame ?? null}
        animated={false}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontWeight: 800,
          fontSize: 14,
          color: row.isMe ? "var(--amber)" : "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {row.username}
      </span>
      <span
        aria-hidden
        className={top ? "emoji" : undefined}
        style={{ color: top ? "var(--amber)" : "var(--faint)", fontWeight: 800 }}
      >
        {top ? "👑" : "—"}
      </span>
    </div>
  );
}

function WaitingRow({ rank }: { rank: number }) {
  const t = useT();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 16,
        background: "color-mix(in srgb, var(--panel) 25%, transparent)",
        border: "1px dashed var(--line)",
        opacity: 0.7,
      }}
    >
      {rankBadge(rank)}
      <Avatar size={30} ring="var(--line)" />
      <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: "var(--faint)", fontStyle: "italic" }}>
        {t.home.waitingForPlayers}
      </span>
      <span aria-hidden style={{ color: "var(--faint)", fontWeight: 800 }}>
        —
      </span>
    </div>
  );
}
