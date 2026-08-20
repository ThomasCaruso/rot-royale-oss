import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { useT } from "@/i18n/useT";
import { Avatar } from "@/screens/home/Avatar";
import { AddFriendButton } from "@/screens/friends/AddFriendButton";
import { FitText } from "@/ui/FitText";

/**
 * Suggestions seeded from TODAY'S FIELD — the people the player actually just competed against.
 *
 * This exists because the friends screen's empty state was a dead end: a player who tapped through
 * (already showing intent) met one line of grey text telling them to type a username they have no
 * way of knowing. Six friendships exist in the whole product and none were ever declined, so the
 * ceiling was never reluctance — it was that there was nothing to act on.
 *
 * No new data: the daily field is already fetched for the standings. Renders NOTHING at all when
 * there's nobody to suggest, so it can never become an empty box asking for something.
 */
export function SuggestedFromField({
  windowId,
  myUsername,
  exclude,
  onCount,
}: {
  windowId: string | null;
  myUsername: string;
  /** Handles already connected (friends + pending, either direction), lowercased. */
  exclude: Set<string>;
  /** How many suggestions rendered. Lets the parent drop its "add by username" line when this
   * block is doing the asking — otherwise the two contradict each other on screen. */
  onCount?: (n: number) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<
    { username: string; avatar_preset?: string; equipped_frame?: string | null; score: number }[]
  >([]);
  // The parent polls the friend graph every few seconds, so `exclude` grows the moment a request
  // is sent. Re-filtering on that would yank the row out from under the thumb that just tapped it
  // — the row must stay and read "Requested". So the exclusion set is read through a ref and
  // applied ONCE, at fetch time; later changes never re-filter what's already on screen.
  const excludeRef = useRef(exclude);
  excludeRef.current = exclude;

  useEffect(() => {
    if (!windowId) return;
    let alive = true;
    api
      .windowField(windowId)
      .then((res) => {
        if (!alive) return;
        const mine = myUsername.toLowerCase();
        const skip = excludeRef.current;
        setRows(
          res.entries
            .filter((e) => {
              const u = e.username.toLowerCase();
              return u !== mine && !skip.has(u);
            })
            .map((e) => ({
              username: e.username,
              avatar_preset: e.avatar_preset,
              equipped_frame: e.equipped_frame,
              // FieldEntry carries per-round points; the total is what a human recognises.
              score: (e.points ?? []).reduce((a, b) => a + b, 0),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 5),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [windowId, myUsername]);

  useEffect(() => {
    onCount?.(rows.length);
  }, [rows.length, onCount]);

  if (rows.length === 0) return null;

  return (
    <section style={{ marginTop: 22 }}>
      <div style={{ marginBottom: 10 }}>
        <FitText
          as="div"
          className="display"
          size={17}
          min={0.7}
          style={{ color: "var(--text)", width: "100%", whiteSpace: "nowrap" }}
        >
          {t.friends.suggestTitle}
        </FitText>
        <div style={{ color: "var(--muted)", fontSize: 12.5, fontWeight: 500, marginTop: 2 }}>
          {t.friends.suggestSub}
        </div>
      </div>

      <div
        style={{
          borderRadius: 18,
          border: "1px solid color-mix(in srgb, var(--line) 75%, transparent)",
          background: "var(--panel)",
          boxShadow: "inset 0 1px 0 var(--sheen), 0 8px 22px rgba(17,17,17,.05)",
          overflow: "hidden",
        }}
      >
        {rows.map((r, i) => (
          <div
            key={r.username}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "11px 13px",
              borderTop: i > 0 ? "1px solid color-mix(in srgb, var(--line) 60%, transparent)" : "none",
            }}
          >
            <Avatar size={34} preset={r.avatar_preset} frame={r.equipped_frame} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 700,
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.username}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginTop: 1 }}>
                {r.score.toLocaleString()}
              </div>
            </div>
            {/* The row deliberately STAYS after adding (the button flips to "Requested") rather
                than disappearing — a row vanishing under your thumb reads as a mis-tap. */}
            <AddFriendButton username={r.username} variant="pill" />
          </div>
        ))}
      </div>
    </section>
  );
}
