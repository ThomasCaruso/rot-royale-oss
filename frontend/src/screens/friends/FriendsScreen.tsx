import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  api,
  type Friend,
  type FriendDuelSummary,
  type FriendRequest,
  type FriendsResponse,
} from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { useBackInterceptor } from "@/app/backInterceptors";
import { AppNav } from "@/screens/home/AppNav";
import { Avatar } from "@/screens/home/Avatar";
import { useOpenContest } from "@/screens/home/useOpenContest";
import { FriendsTodayModal } from "@/screens/friends/FriendsTodayModal";
import { LiveDuel } from "@/screens/friends/LiveDuel";
import { RivalCard } from "@/screens/friends/RivalCard";
import { SuggestedFromField } from "@/screens/friends/SuggestedFromField";
import { useSessionStore } from "@/store/session";
import { FitText } from "@/ui/FitText";

interface ActiveDuel {
  duelId: string;
  opponentName: string;
}

/**
 * Friends hub — add a friend by username, manage requests, and challenge a friend to a LIVE duel.
 * Owns the small state machine that bridges the friend graph to live play: tapping Duel creates a
 * challenge (pending) and waits for the friend to accept; accepting an incoming challenge (or
 * resuming an active one) mounts <LiveDuel>, the WebSocket-driven head-to-head. Lists poll on a
 * short interval so an incoming challenge / an accept lands without a manual refresh.
 */
export function FriendsScreen({
  onBack,
  onCampaign,
  onLeaderboard,
  onVault,
  onPlayWindow,
  onQuickPlay,
}: {
  onBack: () => void;
  onCampaign: () => void;
  onLeaderboard: () => void;
  onVault: () => void;
  onPlayWindow: (windowId: string) => void;
  onQuickPlay?: () => void;
}) {
  const t = useT();
  const [data, setData] = useState<FriendsResponse | null>(null);
  const [duels, setDuels] = useState<{ incoming: FriendDuelSummary[]; outgoing: FriendDuelSummary[]; active: FriendDuelSummary[] }>({
    incoming: [],
    outgoing: [],
    active: [],
  });
  const [username, setUsername] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // While a challenge we just sent is still pending, show a focused waiting card.
  const [pending, setPending] = useState<ActiveDuel | null>(null);
  const [active, setActive] = useState<ActiveDuel | null>(null);
  // The friend whose detail page (head-to-head + remove) is open, by id so it stays fresh on refresh.
  const [detailId, setDetailId] = useState<string | null>(null);
  // "Friends today" popup — the daily friends leaderboard for the open royale window.
  const [todayOpen, setTodayOpen] = useState(false);
  const { windowId: todayWindowId } = useOpenContest();

  // Android BACK, innermost first. Without these, back on any of these layers matched no
  // App-level branch: the friend detail and the today popup would have closed the whole Friends
  // screen, and a LIVE duel would have been torn down mid-match against a real person.
  useBackInterceptor(
    active !== null,
    useCallback(() => true, []), // a live duel swallows back; leave via its own exit control
  );
  useBackInterceptor(
    detailId !== null,
    useCallback(() => {
      setDetailId(null);
      return true;
    }, []),
  );
  useBackInterceptor(
    todayOpen,
    useCallback(() => {
      setTodayOpen(false);
      return true;
    }, []),
  );
  // Needed only to keep the player out of their own suggestion list.
  const me = useSessionStore((s) => s.me);
  const [suggestionCount, setSuggestionCount] = useState(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [f, d] = await Promise.all([api.friends(), api.friendDuels()]);
      if (!mounted.current) return;
      setData(f);
      setDuels(d);
      // Promote a pending challenge to live the moment the friend accepts it.
      setPending((p) => {
        if (!p) return p;
        const nowActive = d.active.find((x) => x.duel_id === p.duelId);
        if (nowActive) {
          setActive({ duelId: p.duelId, opponentName: p.opponentName });
          return null;
        }
        const stillPending = d.outgoing.find((x) => x.duel_id === p.duelId);
        return stillPending ? p : null; // declined / cancelled / expired → drop the wait
      });
    } catch {
      // transient — keep the last good lists, retry on the next tick
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const id = window.setInterval(() => void refresh(), 4000);
    return () => {
      mounted.current = false;
      window.clearInterval(id);
    };
  }, [refresh]);

  const mapError = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        switch (err.message) {
          case "user_not_found":
            return t.friends.errUserNotFound;
          case "cannot_friend_self":
          case "cannot_duel_self":
            return t.friends.errSelf;
          case "already_friends":
            return t.friends.errAlreadyFriends;
          case "request_exists":
            return t.friends.errRequestExists;
          case "not_friends":
            return t.friends.errNotFriends;
          case "duel_already_exists":
            return t.friends.errDuelExists;
        }
      }
      return t.friends.errGeneric;
    },
    [t],
  );

  const addFriend = useCallback(async () => {
    const name = username.trim();
    if (!name || busy) return;
    setBusy(true);
    setNotice("");
    try {
      await api.sendFriendRequest(name);
      setUsername("");
      await refresh();
    } catch (err) {
      setNotice(mapError(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [username, busy, refresh, mapError]);

  const challenge = useCallback(
    async (friend: Friend) => {
      if (busy) return;
      setBusy(true);
      setNotice("");
      try {
        const duel = await api.createFriendDuel(friend.username);
        setPending({ duelId: duel.duel_id, opponentName: friend.username });
        await refresh();
      } catch (err) {
        setNotice(mapError(err));
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [busy, refresh, mapError],
  );

  const acceptDuel = useCallback(async (duel: FriendDuelSummary) => {
    try {
      await api.respondFriendDuel(duel.duel_id, true);
      setActive({ duelId: duel.duel_id, opponentName: duel.opponent_username });
    } catch {
      setNotice(t.friends.errGeneric);
    }
  }, [t]);

  const leaveDuel = useCallback(() => {
    setActive(null);
    void refresh();
  }, [refresh]);

  const removeFriend = useCallback(
    async (userId: string) => {
      await api.removeFriend(userId).catch(() => undefined);
      setDetailId(null);
      void refresh();
    },
    [refresh],
  );

  // --- Live duel takes over the whole screen. ---
  if (active) {
    return <LiveDuel duelId={active.duelId} opponentName={active.opponentName} onExit={leaveDuel} />;
  }

  // --- Per-friend detail page: head-to-head score + remove (the only place to unadd). ---
  const detail = data?.friends.find((f) => f.user_id === detailId) ?? null;
  if (detailId && detail) {
    return (
      <FriendDetail
        friend={detail}
        onBack={() => setDetailId(null)}
        onDuel={() => {
          setDetailId(null);
          void challenge(detail);
        }}
        onRemove={() => removeFriend(detail.user_id)}
        t={t}
      />
    );
  }

  return (
    <>
    <main style={shell}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <button type="button" aria-label={t.friends.back} onClick={onBack} style={backBtn}>
          <BackChevron />
        </button>
        <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
          <h1
            style={{
              fontFamily: SERIF,
              fontSize: 38,
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: "-0.01em",
              color: "var(--text)",
              margin: 0,
            }}
          >
            {t.friends.title}
          </h1>
          <div style={{ color: "var(--muted)", fontSize: 15, fontWeight: 500, marginTop: 7 }}>
            {t.friends.subtitle}
          </div>
        </div>
      </header>

      {/* "Friends today" — the daily friends leaderboard, opened as a popup. Shown while today's
          royale window is resolvable (whole active ET day); the popup handles its own empty state. */}
      {todayWindowId && (
        <button type="button" className="rr-tap" onClick={() => setTodayOpen(true)} style={todayBtn}>
          <span aria-hidden style={todayEmblem}>
            <PodiumIcon />
          </span>
          <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <FitText as="span" size={15} min={0.7} style={{ display: "block", fontWeight: 800, color: "var(--text)", width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}>
              {t.friendsToday.title}
            </FitText>
            <FitText as="span" size={12} min={0.7} style={{ display: "block", color: "var(--muted)", fontWeight: 600, marginTop: 1, width: "100%", whiteSpace: "nowrap", overflow: "hidden" }}>
              {t.friendsToday.subtitle}
            </FitText>
          </span>
          <span aria-hidden style={{ color: "var(--brand)", fontSize: 20, fontWeight: 700, flex: "none" }}>
            ›
          </span>
        </button>
      )}

      {/* Add a friend by username — a calm module: hairline input with a quiet user glyph and a
          soft-lavender Add, helper line beneath. */}
      <section style={addCard}>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <span aria-hidden style={inputIcon}>
              <UserIcon />
            </span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addFriend()}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "color-mix(in srgb, var(--brand) 55%, transparent)";
                e.currentTarget.style.boxShadow = "0 0 0 3px color-mix(in srgb, var(--brand) 12%, transparent)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--line)";
                e.currentTarget.style.boxShadow = "none";
              }}
              placeholder={t.friends.addPlaceholder}
              style={input}
              maxLength={32}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
          <button type="button" className="rr-tap" onClick={addFriend} style={softBtn}>
            <FitText as="span" size={15} min={0.6} style={{ display: "inline-block", maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden" }}>
              {t.friends.addButton}
            </FitText>
          </button>
        </div>
        <div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 500, marginTop: 14 }}>{t.friends.addHint}</div>
        {notice && (
          <div role="status" style={{ color: "var(--pink)", fontSize: 13, fontWeight: 700, marginTop: 10 }}>
            {notice}
          </div>
        )}
      </section>

      {/* Pending challenge we just sent — a quiet open row with a cancel. */}
      {pending && (
        <section style={softCallout}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: "var(--text)" }}>{pending.opponentName}</div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>{t.friends.duelOutgoing}</div>
          </div>
          <button
            type="button"
            onClick={async () => {
              await api.cancelFriendDuel(pending.duelId).catch(() => undefined);
              setPending(null);
              void refresh();
            }}
            style={ghostPill}
          >
            {t.friends.duelCancel}
          </button>
        </section>
      )}

      {/* Incoming duel challenges (others challenged me) + resumable active duels. */}
      {(duels.incoming.length > 0 || duels.active.length > 0) && (
        <section>
          <SectionTitle>{t.friends.sectionChallenges}</SectionTitle>
          <div style={list}>
            {duels.active.map((d, i) => (
              <Row key={d.duel_id} divider={i > 0} avatar={d.opponent_avatar} name={d.opponent_username} sub={t.friends.joinDuel}>
                <button type="button" className="rr-tap" onClick={() => setActive({ duelId: d.duel_id, opponentName: d.opponent_username })} style={softPill}>
                  {t.friends.joinDuel}
                </button>
              </Row>
            ))}
            {duels.incoming.map((d, i) => (
              <Row key={d.duel_id} divider={i > 0 || duels.active.length > 0} avatar={d.opponent_avatar} name={d.opponent_username} sub={t.friends.duelIncoming}>
                <button type="button" className="rr-tap" onClick={() => acceptDuel(d)} style={softPill}>
                  {t.friends.duelAccept}
                </button>
                <button type="button" onClick={async () => { await api.respondFriendDuel(d.duel_id, false).catch(() => undefined); void refresh(); }} style={ghostPill}>
                  {t.friends.duelDecline}
                </button>
              </Row>
            ))}
          </div>
        </section>
      )}

      {/* Friend requests. */}
      {data && (data.incoming.length > 0 || data.outgoing.length > 0) && (
        <section>
          <SectionTitle>{t.friends.sectionRequests}</SectionTitle>
          <div style={list}>
            {data.incoming.map((r, i) => (
              <RequestRow
                key={r.request_id}
                divider={i > 0}
                req={r}
                sub={t.friends.incomingLabel}
                acceptLabel={t.friends.accept}
                declineLabel={t.friends.decline}
                onAccept={async () => { await api.respondFriendRequest(r.request_id, true).catch(() => undefined); void refresh(); }}
                onDecline={async () => { await api.respondFriendRequest(r.request_id, false).catch(() => undefined); void refresh(); }}
              />
            ))}
            {data.outgoing.map((r, i) => (
              <Row key={r.request_id} divider={i > 0 || data.incoming.length > 0} avatar={r.avatar_preset} name={r.username} sub={t.friends.outgoingLabel}>
                <button type="button" onClick={async () => { await api.removeFriend(r.user_id).catch(() => undefined); void refresh(); }} style={ghostPill}>
                  {t.friends.decline}
                </button>
              </Row>
            ))}
          </div>
        </section>
      )}

      {/* Rival card — shown above the friends list when the backend designates a rival. */}
      {data?.rival_user_id && (() => {
        const rv = data.friends.find((f) => f.user_id === data.rival_user_id);
        return rv ? <RivalCard rival={rv} onSettle={() => challenge(rv)} /> : null;
      })()}

      {/* Friends list — an open luxury table: hairline dividers, no per-row boxes. */}
      <section style={{ marginTop: 20 }}>
        <SectionTitle>{t.friends.sectionFriends}</SectionTitle>
        {/* "Add one by username above" is only true advice when there's nothing better on offer;
            with suggestions below it, it would contradict the one-tap buttons. */}
        {data && data.friends.length === 0 && suggestionCount === 0 && (
          <div style={{ color: "var(--muted)", fontSize: 14, fontWeight: 500, padding: "10px 2px" }}>
            {t.friends.noFriends}
          </div>
        )}
        {/* An empty list used to end the journey here. Offer the people they just played instead —
            no typing, no remembering a handle. Renders nothing when there's nobody to suggest. */}
        {data && data.friends.length === 0 && me?.username && (
          <SuggestedFromField
            windowId={todayWindowId}
            myUsername={me.username}
            exclude={
              new Set(
                [
                  ...data.friends.map((f) => f.username),
                  ...data.incoming.map((r) => r.username),
                  ...data.outgoing.map((r) => r.username),
                ].map((n) => n.toLowerCase()),
              )
            }
            onCount={setSuggestionCount}
          />
        )}
        <div style={list}>
          {data?.friends.map((f, i) => (
            <Row
              key={f.user_id}
              divider={i > 0}
              avatar={f.avatar_preset}
              frame={f.equipped_frame}
              name={f.username}
              sub={
                f.wins + f.losses > 0
                  ? `${fmt(t.friends.record, { w: f.wins, l: f.losses })}${
                      f.streak > 0 ? ` · ${fmt(t.rivalry.wonStreak, { n: f.streak })}` :
                      f.streak < 0 ? ` · ${fmt(t.rivalry.lostStreak, { n: -f.streak })}` : ""
                    }`
                  : t.friends.noDuelsYet
              }
              onAvatarClick={() => setDetailId(f.user_id)}
              avatarLabel={f.username}
            >
              <button type="button" className="rr-tap" onClick={() => challenge(f)} style={ghostPill}>
                {t.friends.challenge}
              </button>
            </Row>
          ))}
        </div>
      </section>
    </main>
    {todayOpen && todayWindowId && (
      <FriendsTodayModal windowId={todayWindowId} onClose={() => setTodayOpen(false)} />
    )}
    <AppNav
      active="none"
      onHome={onBack}
      onCampaign={onCampaign}
      onLeaderboard={onLeaderboard}
      onVault={onVault}
      onPlayWindow={onPlayWindow}
      onQuickPlay={onQuickPlay}
    />
    </>
  );
}

/**
 * Per-friend page reached by tapping their icon — the head-to-head score (running duel record) and
 * the ONLY place to remove the friend (kept off the duel list so a misfire can't unadd someone).
 */
function FriendDetail({
  friend,
  onBack,
  onDuel,
  onRemove,
  t,
}: {
  friend: Friend;
  onBack: () => void;
  onDuel: () => void;
  onRemove: () => void;
  t: ReturnType<typeof useT>;
}) {
  const played = friend.wins + friend.losses;
  return (
    <main style={shell}>
      <header style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button type="button" aria-label={t.friends.back} onClick={onBack} style={backBtn}>
          <BackChevron />
        </button>
        <h1 style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 600, color: "var(--text)", lineHeight: 1, margin: 0 }}>
          {t.friends.profileTitle}
        </h1>
      </header>

      <section style={{ ...card, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, paddingTop: 22, paddingBottom: 22 }}>
        <Avatar size={88} preset={friend.avatar_preset} frame={friend.equipped_frame} ring="var(--amber)" />
        <div className="display" style={{ fontSize: 22, color: "var(--text)" }}>{friend.username}</div>

        <div style={{ color: "var(--muted)", fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", marginTop: 6 }}>
          {t.friends.headToHead}
        </div>
        {played > 0 ? (
          <>
            <div className="display" style={{ fontSize: 40, lineHeight: 1 }}>
              <span style={{ color: "var(--lime)" }}>{friend.wins}</span>
              <span style={{ color: "var(--muted)", margin: "0 8px" }}>–</span>
              <span style={{ color: "var(--pink)" }}>{friend.losses}</span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>
              {fmt(t.duel.recordLine, { w: friend.wins, l: friend.losses })}
            </div>
          </>
        ) : (
          <div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 600 }}>{t.friends.noDuelsYet}</div>
        )}
      </section>

      <button
        type="button"
        className="rr-tap"
        onClick={onDuel}
        style={{ ...ghostPill, width: "100%", padding: "14px", borderRadius: 16 }}
      >
        <FitText as="span" size={15} min={0.6} style={{ display: "block", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textAlign: "center" }}>
          {t.friends.challenge}
        </FitText>
      </button>
      <button type="button" onClick={onRemove} style={dangerBtn}>
        <FitText as="span" size={14} min={0.6} style={{ display: "block", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textAlign: "center" }}>
          {t.friends.removeFriend}
        </FitText>
      </button>

      <div style={{ flex: 1 }} />
    </main>
  );
}

/** Minimal three-bar podium mark for the "Friends today" entry emblem (center bar tallest). */
function PodiumIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 14h4v6H4zM10 8h4v12h-4zM16 11h4v9h-4z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Thin left chevron for the circular back button. */
function BackChevron() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Quiet person glyph for the add-friend input (minimal, muted). */
function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5.5 19.5c1.2-3.4 4-5 6.5-5s5.3 1.6 6.5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: "var(--muted)",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

/** An open luxury table row (no per-row box). `divider` draws a hairline above it (rows 2+). */
function Row({
  avatar,
  frame = null,
  name,
  sub,
  divider = false,
  onAvatarClick,
  avatarLabel,
  children,
}: {
  avatar: string;
  /** The row subject's equipped frame, where the payload carries one. Pending friend REQUESTS and
   *  duel summaries don't include it, so those rows stay frameless rather than showing a wrong one. */
  frame?: string | null;
  name: string;
  sub?: string;
  divider?: boolean;
  onAvatarClick?: () => void;
  avatarLabel?: string;
  children?: React.ReactNode;
}) {
  const avatarEl = <Avatar size={52} preset={avatar} frame={frame} animated={false} />;
  return (
    <div style={divider ? { ...listRow, ...listDivider } : listRow}>
      {onAvatarClick ? (
        <button type="button" onClick={onAvatarClick} aria-label={avatarLabel} style={avatarBtn}>
          {avatarEl}
        </button>
      ) : (
        avatarEl
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name}
        </div>
        {sub && <div style={{ color: "var(--muted)", fontSize: 14, fontWeight: 500, marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>{children}</div>
    </div>
  );
}

function RequestRow({
  req,
  sub,
  divider = false,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
}: {
  req: FriendRequest;
  sub: string;
  divider?: boolean;
  acceptLabel: string;
  declineLabel: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <Row avatar={req.avatar_preset} name={req.username} sub={sub} divider={divider}>
      <button type="button" className="rr-tap" onClick={onAccept} style={softPill}>
        {acceptLabel}
      </button>
      <button type="button" onClick={onDecline} style={ghostPill}>
        {declineLabel}
      </button>
    </Row>
  );
}

// Editorial display serif — reserved for the page titles (matches the Growth screen). Playfair is
// pulled in via the global.css Google-Fonts import; Georgia is the graceful fallback.
const SERIF = '"Playfair Display", "Cormorant Garamond", Georgia, serif';

const shell: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  margin: "0 auto",
  padding: "calc(28px + env(safe-area-inset-top)) 22px calc(132px + env(safe-area-inset-bottom))",
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

/** Circular back button — hairline border, faint panel, one soft shadow. */
const backBtn: React.CSSProperties = {
  flex: "none",
  width: 44,
  height: 44,
  borderRadius: 999,
  border: "1px solid var(--line)",
  background: "color-mix(in srgb, var(--panel) 65%, transparent)",
  color: "var(--text)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  boxShadow: "0 4px 14px rgba(20, 16, 10, 0.05)",
};

/** "Friends today" callout — a slim faint-lavender wash with a soft-lavender icon pill. No shadow. */
const todayBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  width: "100%",
  padding: "20px 20px",
  borderRadius: 22,
  cursor: "pointer",
  fontFamily: "inherit",
  border: "1px solid color-mix(in srgb, var(--brand) 25%, transparent)",
  background: "color-mix(in srgb, var(--brand) 7%, transparent)",
};

const todayEmblem: React.CSSProperties = {
  flex: "none",
  width: 48,
  height: 48,
  borderRadius: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--brand)",
  background: "color-mix(in srgb, var(--brand) 13%, transparent)",
};

/** Add-friend module — one calm translucent container, hairline border. */
const addCard: React.CSSProperties = {
  padding: 20,
  borderRadius: 24,
  background: "color-mix(in srgb, var(--panel) 45%, transparent)",
  border: "1px solid color-mix(in srgb, var(--line) 80%, transparent)",
};

const input: React.CSSProperties = {
  width: "100%",
  height: 58,
  padding: "0 16px 0 44px",
  borderRadius: 16,
  border: "1px solid var(--line)",
  background: "color-mix(in srgb, var(--panel) 60%, transparent)",
  color: "var(--text)",
  fontSize: 15,
  fontWeight: 600,
  outline: "none",
  transition: "border-color 160ms ease, box-shadow 160ms ease",
};

const inputIcon: React.CSSProperties = {
  position: "absolute",
  left: 15,
  top: "50%",
  transform: "translateY(-50%)",
  color: "var(--faint)",
  display: "flex",
  pointerEvents: "none",
};

/** Soft-lavender primary — the Add button (rounded rect, matches input height). */
const softBtn: React.CSSProperties = {
  flex: "none",
  height: 58,
  minWidth: 96,
  padding: "0 24px",
  borderRadius: 16,
  border: "1px solid color-mix(in srgb, var(--brand) 28%, transparent)",
  background: "linear-gradient(180deg, color-mix(in srgb, var(--brand) 14%, var(--panel)), color-mix(in srgb, var(--brand) 22%, var(--panel)))",
  color: "var(--text)",
  fontWeight: 700,
  fontSize: 15,
  fontFamily: "inherit",
  cursor: "pointer",
};

/** Soft-lavender pill — accept / join (radius 999 variant of softBtn). */
const softPill: React.CSSProperties = {
  padding: "9px 18px",
  borderRadius: 999,
  border: "1px solid color-mix(in srgb, var(--brand) 30%, transparent)",
  background: "color-mix(in srgb, var(--brand) 14%, var(--panel))",
  color: "var(--text)",
  fontWeight: 700,
  fontSize: 13.5,
  fontFamily: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** Ghost pill — the quiet outlined action (Duel, Decline, Cancel). */
const ghostPill: React.CSSProperties = {
  padding: "9px 20px",
  borderRadius: 999,
  border: "1px solid color-mix(in srgb, var(--text) 16%, transparent)",
  background: "transparent",
  color: "var(--text)",
  fontWeight: 600,
  fontSize: 13.5,
  fontFamily: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** A quiet inline callout (pending challenge) — faint lavender wash, hairline, open row. */
const softCallout: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "16px 18px",
  borderRadius: 20,
  border: "1px solid color-mix(in srgb, var(--brand) 22%, transparent)",
  background: "color-mix(in srgb, var(--brand) 6%, transparent)",
};

/** Open list container + row (no per-row box). */
const list: React.CSSProperties = { display: "flex", flexDirection: "column" };

const listRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "16px 2px",
  minHeight: 84,
  boxSizing: "border-box",
};

const listDivider: React.CSSProperties = {
  borderTop: "1px solid color-mix(in srgb, var(--text) 8%, transparent)",
};

/** Profile card (FriendDetail) — one refined translucent card. */
const card: React.CSSProperties = {
  padding: 22,
  borderRadius: 26,
  background: "color-mix(in srgb, var(--panel) 62%, transparent)",
  border: "1px solid color-mix(in srgb, var(--line) 85%, transparent)",
  boxShadow: "0 18px 50px rgba(37, 31, 23, 0.06)",
};

const avatarBtn: React.CSSProperties = {
  flex: "none",
  padding: 0,
  border: "none",
  background: "none",
  borderRadius: "50%",
  cursor: "pointer",
  lineHeight: 0,
};

const dangerBtn: React.CSSProperties = {
  width: "100%",
  padding: "13px 16px",
  borderRadius: 16,
  border: "1px solid color-mix(in srgb, var(--pink) 40%, transparent)",
  background: "color-mix(in srgb, var(--pink) 10%, transparent)",
  color: "var(--pink)",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};
