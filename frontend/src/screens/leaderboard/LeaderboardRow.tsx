import { Avatar } from "@/screens/home/Avatar";
import { getBadge } from "@/theme/identity";
import { CrownIcon } from "@/ui/CrownIcon";
import { activeTag } from "@/i18n/format";

export interface LeaderboardRowData {
  rank: number;
  username: string;
  score: number;
  isMe?: boolean;
  /** Identity fields are optional with safe defaults (ninja, frameless, no honors) so existing
   * constructors/fixtures keep working; real data threads them from FieldEntry. */
  avatar_preset?: string;
  equipped_frame?: string | null;
  equipped_badges?: string[];
  equipped_title?: string | null;
}

const MEDAL_COLORS: Record<number, { bg: string; color: string }> = {
  1: { bg: "linear-gradient(135deg, #ffe680, #f59e0b)", color: "#3a1c04" },
  2: { bg: "linear-gradient(135deg, #d7ccff, #a994d9)", color: "#241044" },
  3: { bg: "linear-gradient(135deg, #d28b4a, #b9793d)", color: "#1a0a00" },
};

function RankBadge({ rank }: { rank: number }) {
  const c = MEDAL_COLORS[rank];
  return (
    <span
      style={{
        width: 36,
        height: 36,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        flex: "none",
        fontWeight: 900,
        fontSize: 14,
        fontFamily: "Fredoka, sans-serif",
        background: c?.bg ?? "color-mix(in srgb, var(--line) 80%, transparent)",
        color: c?.color ?? "var(--muted)",
        boxShadow: rank <= 3 ? "0 2px 8px rgba(0,0,0,.4)" : "none",
      }}
    >
      {rank}
    </span>
  );
}

export function LeaderboardRow({ row, youLabel }: { row: LeaderboardRowData; youLabel: string }) {
  // Pinned honors as tiny emoji after the name (≤3, sliced defensively; unknown ids drop out).
  // Rendered only when present — no reserved space, so badge-less rows keep an identical layout.
  const badgeEmojis = (row.equipped_badges ?? [])
    .slice(0, 3)
    .map((id) => getBadge(id)?.emoji)
    .filter(Boolean)
    .join(" ");
  return (
    <div
      role="row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 11px",
        borderRadius: 14,
        // Rows are embedded ON the arena surface: subtle translucent fill + faint hairline border.
        // The "You" row warms slightly with a THIN gold border (a row, not a banner — no outer glow).
        background: row.isMe
          ? "linear-gradient(180deg, color-mix(in srgb, var(--amber) 13%, var(--panel2)), color-mix(in srgb, var(--panel) 78%, transparent))"
          : "color-mix(in srgb, var(--panel2) 42%, transparent)",
        border: `1px solid ${row.isMe ? "color-mix(in srgb, var(--amber) 50%, transparent)" : "color-mix(in srgb, var(--line) 55%, transparent)"}`,
        boxShadow: row.isMe ? "inset 0 1px 0 color-mix(in srgb, var(--amber) 10%, transparent)" : "none",
        transition: "background 200ms",
      }}
    >
      <RankBadge rank={row.rank} />
      {/* Frame (when equipped) wins over the plain ring; a frameless "me" row keeps the amber
       * ring. The avatar cell stays overflow-visible so frame ornaments (~24% overhang above the
       * disc) render uncropped — at size 32 they stay inside the row's 9px top padding.
       * animated=false: scroll-heavy row lists run ZERO animation — a prestige frame here keeps
       * its static glow but never the infinite pulse. */}
      <Avatar
        size={36}
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
          fontSize: 16,
          fontFamily: "Fredoka, sans-serif",
          color: row.isMe ? "var(--amber)" : "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {row.isMe ? `${row.username} · ${youLabel}` : row.username}
        {/* Honors ride inline right after the name (inside the ellipsizing span, so a long name
         * truncates them gracefully) — quiet status, not noise: tiny, slightly desaturated. */}
        {badgeEmojis && (
          <span
            aria-hidden
            className="emoji"
            style={{
              marginLeft: 6,
              fontSize: 12.5,
              letterSpacing: 2,
              opacity: 0.85,
              filter: "saturate(0.8)",
            }}
          >
            {badgeEmojis}
          </span>
        )}
      </span>
      {/* Star + score. */}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: "none" }}>
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          style={{ width: 13, height: 13 }}
          fill={row.isMe ? "var(--amber)" : "color-mix(in srgb, var(--amber) 70%, var(--faint))"}
        >
          <path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.8 6.1 20.8l1.2-6.6L2.5 9l6.6-.9z" />
        </svg>
        <span
          style={{
            fontWeight: 800,
            fontSize: 16,
            fontFamily: "Fredoka, sans-serif",
            color: row.isMe ? "var(--amber)" : "var(--text)",
          }}
        >
          {row.score.toLocaleString(activeTag())}
        </span>
      </span>
      {row.rank === 1 && (
        <CrownIcon size={14} style={{ filter: "drop-shadow(0 0 6px rgba(255,193,52,.6))" }} />
      )}
      {/* Chevron affordance — reads as a tappable standings entry. */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        style={{ width: 15, height: 15, flex: "none", opacity: 0.7 }}
        fill="none"
        stroke={row.isMe ? "var(--amber)" : "var(--faint)"}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="9 6 15 12 9 18" />
      </svg>
    </div>
  );
}
