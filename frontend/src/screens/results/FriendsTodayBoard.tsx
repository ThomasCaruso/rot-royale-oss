import { useEffect, useState } from "react";
import { api, type FriendsBoardResponse } from "@/api/client";
import { Avatar } from "@/screens/home/Avatar";
import { useT } from "@/i18n/useT";

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 22,
  padding: 18,
  boxShadow: "0 14px 40px rgba(20, 16, 10, 0.06)",
};

// When shown inside a popup, the modal panel IS the surface — the board drops its own card chrome
// so there's one clean surface (no card-in-card). Inline (results) keeps the full card above.
const bareCard: React.CSSProperties = {
  background: "none",
  border: "none",
  borderRadius: 0,
  padding: 0,
  boxShadow: "none",
};

function fmt(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--muted)",
      }}
    >
      {children}
    </div>
  );
}

export function FriendsTodayBoard({ windowId, bare = false }: { windowId: string; bare?: boolean }) {
  const t = useT();
  const ft = t.friendsToday;
  const surface = bare ? bareCard : card;
  const [board, setBoard] = useState<FriendsBoardResponse | null>(null);
  const [challenged, setChallenged] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    api
      .friendsBoard(windowId)
      .then((b) => alive && setBoard(b))
      .catch(() => {
        /* best-effort; the board just omits itself */
      });
    return () => {
      alive = false;
    };
  }, [windowId]);

  if (!board) return null;
  const { played, yet_to_play, my_rank, friend_field_size } = board;

  if (played.length === 0 && yet_to_play.length === 0) {
    return (
      <section style={surface}>
        <Label>{ft.title}</Label>
        <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>{ft.noFriends}</div>
      </section>
    );
  }

  // Show at most 3 FRIENDS — friends who played today (by score) first, then the not-yet-played
  // ones the server already ordered most-recent-first. Never a random slice, never an endless list.
  // My own row is shown for standing context and doesn't count against the cap.
  const FRIEND_CAP = 3;
  const meIdx = played.findIndex((r) => r.is_me);
  const meRow = meIdx >= 0 ? played[meIdx] : null;
  const ahead = meIdx > 0 ? played[meIdx - 1] : null;
  const below = meIdx >= 0 && meIdx < played.length - 1 ? played[meIdx + 1] : null;

  const shownFriends = played.filter((r) => !r.is_me).slice(0, FRIEND_CAP);
  const shownYet = yet_to_play.slice(0, Math.max(0, FRIEND_CAP - shownFriends.length));
  const playedRows = (meRow ? [meRow, ...shownFriends] : shownFriends).sort(
    (a, b) => a.rank - b.rank,
  );

  // Challenge a friend who's yet to play to beat your Daily Royale score today — this pushes them a
  // nudge into today's game (async, not a live duel). Optimistic: the button flips to "Challenge
  // sent" immediately and stays calm on error (the results screen never surfaces a failure toast).
  async function challenge(username: string) {
    setChallenged((s) => new Set(s).add(username));
    try {
      await api.challengeFriendToDaily(username);
    } catch {
      /* stays calm on the results screen */
    }
  }

  return (
    <section style={surface}>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
      >
        <Label>{ft.title}</Label>
        {my_rank != null && (
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>
            {fmt(ft.placement, { rank: my_rank, n: friend_field_size })}
          </span>
        )}
      </div>

      {meRow &&
        (meRow.rank === 1 ? (
          <div
            style={{ fontSize: 13, color: "var(--lime)", fontWeight: 600, marginTop: 4 }}
          >
            {ft.onTop}
            {below
              ? ` · ${fmt(ft.ahead, { gap: meRow.score - below.score, name: below.username })}`
              : ""}
          </div>
        ) : ahead ? (
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
            {fmt(ft.behind, { gap: `−${ahead.score - meRow.score}`, name: ahead.username })}
          </div>
        ) : null)}

      <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
        {playedRows.map((r, idx) => (
          <div
            key={r.user_id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "11px 0",
              borderTop: idx > 0 ? "1px solid var(--line)" : "none",
            }}
          >
            <span
              style={{ width: 18, fontSize: 13, fontWeight: 700, color: "var(--muted)" }}
            >
              {r.rank}
            </span>
            <Avatar size={32} preset={r.avatar_preset} frame={r.equipped_frame} animated={false} />
            <span
              style={{
                flex: 1,
                fontSize: 14,
                fontWeight: r.is_me ? 800 : 600,
                color: r.is_me ? "var(--brand)" : "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {r.username}
            </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--text)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {r.score}
            </span>
          </div>
        ))}
      </div>

      {shownYet.length > 0 && (
        <div style={{ marginTop: 4, display: "flex", flexDirection: "column" }}>
          {shownYet.map((p, idx) => (
            <div
              key={p.user_id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "11px 0",
                borderTop: "1px solid var(--line)",
                ...(idx === 0 && playedRows.length === 0 ? { borderTop: "none" } : {}),
              }}
            >
              <Avatar size={32} preset={p.avatar_preset} frame={p.equipped_frame} animated={false} />
              <span
                style={{
                  flex: 1,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {p.username}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--faint)" }}>
                {ft.yetToPlay}
              </span>
              <button
                type="button"
                onClick={() => challenge(p.username)}
                disabled={challenged.has(p.username)}
                style={{
                  background: "none",
                  border: "none",
                  padding: "2px 0",
                  color: "var(--brand)",
                  fontSize: 13,
                  fontWeight: 700,
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                  cursor: "pointer",
                  opacity: challenged.has(p.username) ? 0.5 : 1,
                }}
              >
                {challenged.has(p.username) ? ft.challengeSent : ft.challenge}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
