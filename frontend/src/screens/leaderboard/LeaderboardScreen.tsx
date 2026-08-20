import { useEffect, useMemo, useState } from "react";
import { lobbyArt } from "@/assets/lobby";
import { api, type FieldEntry, type HistoryItem } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { Avatar } from "@/screens/home/Avatar";
import { FitText } from "@/ui/FitText";
import { GoldButton } from "@/ui/GoldButton";
import { Skeleton, SkeletonRow } from "@/ui/Skeleton";
import { useSessionStore } from "@/store/session";
import { useArtStyle, useThemeArt } from "@/theme/useArtStyle";
import { LeaderboardRow, type LeaderboardRowData } from "./LeaderboardRow";
import { MonoLeaderboard } from "./MonoLeaderboard";
import { StarterLeaderboard } from "./StarterLeaderboard";
import { LeaderboardTabs, type LeaderboardTab } from "./LeaderboardTabs";
import { PodiumTopThree } from "./PodiumTopThree";
import { SeasonBanner } from "./SeasonBanner";
import { StandingCard } from "./StandingCard";
import { activeTag } from "@/i18n/format";

const shell: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  margin: "0 auto",
  position: "relative",
  // The page scrolls naturally (flick anywhere) like a game feed. 24px horizontal padding aligns the
  // standing card + arena. Real safe-area top padding (+12px) so the top bar/crown/title never clip.
  // Bottom padding clears BOTH the floating nav and the pinned "your rank" bar so the last field row
  // can always scroll into view above them.
  minHeight: "100dvh",
  padding: "calc(env(safe-area-inset-top, 0px) + 12px) 24px calc(152px + env(safe-area-inset-bottom))",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  WebkitOverflowScrolling: "touch",
};

// The unified "leaderboard arena" — one subtle stage surface that tabs, podium and rows all sit on,
// so they read as a single composed screen rather than stacked rectangles. Exact recipe per spec.
const arena: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "12px 12px 14px",
  borderRadius: 28,
  background:
    "radial-gradient(circle at 50% 25%, rgba(124,58,237,.18), rgba(18,8,38,.72) 60%, rgba(10,4,24,.88))",
  border: "1px solid rgba(167, 110, 255, .22)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.06), 0 18px 50px rgba(0,0,0,.28)",
};

const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function LeaderboardScreen({ onBack, onVault }: { onBack: () => void; onVault?: () => void }) {
  const t = useT();
  const me = useSessionStore((s) => s.me);
  const mono = useArtStyle() === "mono";
  const art = useThemeArt();
  const [tab, setTab] = useState<LeaderboardTab>("window");
  const [windowEntries, setWindowEntries] = useState<FieldEntry[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loadingWindow, setLoadingWindow] = useState(true);
  const [openWindowId, setOpenWindowId] = useState<string | null>(null);
  // The state of the royale window whose field we're showing (OPEN/CLOSED → provisional, SETTLED →
  // final). Drives the provisional-vs-final banner; honest "field" language, never "players".
  const [windowState, setWindowState] = useState<string | null>(null);
  // When the window's standings finalize (close_at + 15min), so the context line can show a real
  // viewer-local "final at …" time instead of inventing one.
  const [settleAt, setSettleAt] = useState<string | null>(null);
  // The caller's server-computed rank/score over the whole field. `windowEntries` is only the top
  // slice (bounded for scale), so a player ranked below the slice is absent from it but still gets a
  // correct standing here. Within the slice these agree with the list — unchanged at real-world sizes.
  const [myWindowRank, setMyWindowRank] = useState<number | null>(null);
  const [myWindowScore, setMyWindowScore] = useState(0);
  // A failed board load is an ERROR, not an empty field. Before this, every failure was swallowed
  // into "No scores yet" — indistinguishable from a genuinely empty board and with no way to retry.
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingWindow(true);
    setLoadError(false);

    api
      .currentContest()
      .then(async (c) => {
        if (cancelled) return;
        // Prefer the open (live) royale; otherwise the latest royale in the schedule so a closed-but-
        // settled field can still show a Final banner. open_window is always OPEN.
        const win =
          c.open_window ??
          [...c.schedule].reverse().find((w) => w.slot === "royale") ??
          null;
        setOpenWindowId(win?.id ?? null);
        setWindowState(win?.state ?? null);
        setSettleAt(win?.settle_at ?? null);
        if (win) {
          const f = await api.windowField(win.id);
          if (!cancelled) {
            setWindowEntries(f.entries);
            setMyWindowRank(f.my_rank ?? null);
            setMyWindowScore(f.my_score ?? 0);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => !cancelled && setLoadingWindow(false));

    api
      .history()
      .then((h) => {
        if (!cancelled) setHistory(h.items);
      })
      .catch(() => undefined); // stat cards degrade to "—"; the board itself doesn't need history

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const rows: LeaderboardRowData[] = useMemo(() => {
    const sorted = [...windowEntries]
      .map((e) => ({
        username: e.username,
        score: e.points.reduce((a, b) => a + b, 0),
        isMe: e.username === me?.username,
        avatar_preset: e.avatar_preset,
        equipped_frame: e.equipped_frame,
        equipped_badges: e.equipped_badges,
        equipped_title: e.equipped_title,
      }))
      .sort((a, b) => b.score - a.score)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    return sorted;
  }, [windowEntries, me?.username]);

  const top3Finishes = useMemo(
    () => history.filter((h) => h.place != null && h.place <= 3).length,
    [history],
  );

  // Rating swing from the most recent SETTLED game (history is most-recent-first). Null when there's
  // no settled game with rating data yet — the card then shows "—" rather than a fabricated 0.
  const lastGameDelta = useMemo(() => {
    const last = history.find(
      (h) => h.state === "SETTLED" && h.rating_before != null && h.rating_after != null,
    );
    return last ? (last.rating_after as number) - (last.rating_before as number) : null;
  }, [history]);

  // Both pre-content dead-ends render a way out instead of a blank/false-empty screen: session
  // gone → generic error + back; board load failed with nothing to show → error + retry + back.
  if (!me) {
    return (
      <FallbackPanel message={t.errors.server_error}>
        <GoldButton idlePulse={false} onClick={onBack} style={{ maxWidth: 240 }}>
          {t.common.back}
        </GoldButton>
      </FallbackPanel>
    );
  }
  if (loadError && !loadingWindow && windowEntries.length === 0) {
    return (
      <FallbackPanel message={t.leaderboard.errLoad}>
        <GoldButton
          idlePulse={false}
          onClick={() => setReloadKey((k) => k + 1)}
          style={{ maxWidth: 240 }}
        >
          {t.common.retry}
        </GoldButton>
        <GoldButton idlePulse={false} onClick={onBack} style={{ maxWidth: 240 }}>
          {t.common.back}
        </GoldButton>
      </FallbackPanel>
    );
  }

  const myRank = me.rank;
  const podiumEntries = rows.slice(0, 3); // top 3 (real field) for the frozen podium

  // The user's own row: their real field row when they entered this window. If they HAVEN'T entered,
  // there is no window rank, so they sit just past the field (rows.length + 1) with a 0 score — honest
  // ("not on the board yet"), never the profile's global rank.
  const meFieldRow = rows.find((r) => r.isMe) ?? null;
  const userRow: LeaderboardRowData | null =
    meFieldRow ??
    (rows.length > 0
      ? {
          rank: rows.length + 1,
          username: me.username,
          score: 0,
          isMe: true,
          avatar_preset: me.avatar_preset,
          equipped_frame: me.equipped_frame,
        }
      : null);
  // The scrollable field list: the whole field from rank 1 down, EXCLUDING the user (their row is
  // shown as a persistent footer beneath the list so it's always visible without hunting for it).
  // The top three repeat here under the podium on purpose — a list that opens at 4th reads like the
  // numbering is broken, and the podium is a flourish over the ranking rather than its first page.
  const listRows = rows.filter((r) => !r.isMe);

  // Normal themes (Starter + its skins — mono surface WITH the Starter art set): the premium
  // reference leaderboard — branded header, serif title, segmented filters, a top-three podium of
  // equipped avatars, a pinned Your Rank card, and only ranks 4-5 beneath.
  if (mono && art) {
    return (
      <StarterLeaderboard
        me={me}
        rows={rows}
        windowState={windowState}
        settleAt={settleAt}
        openWindowId={openWindowId}
        loading={loadingWindow}
        serverMyRank={myWindowRank}
        serverMyScore={myWindowScore}
        onVault={onVault}
      />
    );
  }

  // Mono ("Blank"): the market-desk leaderboard — a position card (rating as the ticker price,
  // real last-game delta, real settled-rating sparkline, Top-% percentile) over a minimal field
  // list with relative-score bars. Same fetched data; entirely different composition.
  if (mono) {
    return (
      <MonoLeaderboard
        onBack={onBack}
        me={me}
        rows={rows}
        history={history}
        lastGameDelta={lastGameDelta}
        windowState={windowState}
        loading={loadingWindow}
      />
    );
  }

  return (
    <main style={shell}>
      {/* Visually-hidden live status for screen readers (the provisional/final pill is intentionally
          NOT in the visual layout — it competed with the hierarchy). */}
      <span style={srOnly} role="status">
        {windowState === "SETTLED" ? t.leaderboard.finalStandings : t.leaderboard.provisional}
      </span>

      {/* Top bar — IN FLOW (no longer absolute) so the safe-area padding above it can never clip the
          back button / coin pill / avatar. */}
      <div
        style={{
          height: 44,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <button
          type="button"
          aria-label={t.leaderboard.ariaBack}
          onClick={onBack}
          style={{
            display: "grid",
            placeItems: "center",
            width: 48,
            height: 48,
            flex: "none",
            borderRadius: "50%",
            background: "color-mix(in srgb, var(--panel2) 80%, transparent)",
            border: "1px solid var(--line)",
            color: "var(--muted)",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06)",
          }}
          onPointerDown={(e) => (e.currentTarget.style.transform = "scale(.92)")}
          onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
          onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          <svg aria-hidden viewBox="0 0 24 24" style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 6 9 12 15 18" />
          </svg>
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 11px",
              borderRadius: 999,
              background: "linear-gradient(180deg, var(--panel2), var(--panel))",
              border: "1px solid var(--line)",
            }}
          >
            <img
              src={lobbyArt.coin}
              alt=""
              aria-hidden
              draggable={false}
              style={{ width: 18, height: 18, objectFit: "contain", display: "block" }}
            />
            <span className="display" style={{ fontSize: 16, color: "var(--amber)", lineHeight: 1 }}>
              {me.coins_balance}
            </span>
          </div>
          <button
            type="button"
            aria-label={t.home.profileAndSettings}
            onClick={onBack}
            style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", borderRadius: "50%" }}
          >
            <Avatar
              size={38}
              online
              ring="var(--brand)"
              preset={me.avatar_preset}
              frame={me.equipped_frame}
            />
          </button>
        </div>
      </div>

      {/* Header — small crown EMBLEM beside a white/silver premium title, gold-accented subtitle. */}
      <LeaderboardHeader title={t.leaderboard.title} subtitle={t.leaderboard.subtitle} />

      {/* Your Standing card */}
      <StandingCard
        rank={myRank}
        division={me.division}
        rating={me.rating}
        top3Finishes={top3Finishes}
        fromLastGame={lastGameDelta}
        labels={{
          yourStanding: t.leaderboard.yourStanding,
          unranked: t.leaderboard.unranked,
          rating: t.leaderboard.rating,
          topFinishes: t.leaderboard.topFinishes,
          fromLastGame: t.leaderboard.fromLastGame,
        }}
      />

      <SeasonBanner />

      {/* The unified arena: tabs + podium + rows live on ONE surface. */}
      <div style={arena}>
        <LeaderboardTabs
          active={tab}
          onSwitch={setTab}
          labels={{ currentWindow: t.leaderboard.currentWindow, globalRank: t.leaderboard.globalRank }}
        />

        {tab === "window" ? (
          <WindowTab
            fieldEmpty={rows.length === 0}
            podiumEntries={podiumEntries}
            listRows={listRows}
            userRow={userRow}
            loading={loadingWindow}
            openWindowId={openWindowId}
            youLabel={t.leaderboard.youLabel}
            noScoresYet={t.leaderboard.noScoresYet}
            noOpenWindow={t.leaderboard.noOpenWindow}
            playRanked={t.leaderboard.playRanked}
          />
        ) : (
          <GlobalTab
            rank={myRank}
            totalPlayers={me.total_players}
            division={me.division}
            rating={me.rating}
            labels={{
              yourStanding: t.leaderboard.yourStanding,
              unranked: t.leaderboard.unranked,
              inTheField: t.leaderboard.inTheField,
              rating: t.leaderboard.rating,
              globalStanding: t.leaderboard.globalStanding,
              globalComingSoon: t.leaderboard.globalComingSoon,
              ofTotal: t.home.ofTotal,
            }}
          />
        )}
      </div>
    </main>
  );
}

// --- Header ---

/** A faint CSS/SVG laurel branch (one side); the caller mirrors it for the other. Pure decoration. */
function Laurel({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 40 60"
      style={{
        width: 22,
        height: 34,
        flex: "none",
        opacity: 0.32,
        transform: flip ? "scaleX(-1)" : undefined,
        color: "color-mix(in srgb, var(--brand) 60%, var(--line))",
      }}
      fill="currentColor"
    >
      {/* central stem */}
      <path d="M30 4 C 18 18, 14 36, 18 56" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* leaves down the stem */}
      {[8, 18, 28, 38, 47].map((y, i) => (
        <ellipse key={i} cx={26 - i * 2.4} cy={y} rx={6 - i * 0.5} ry={3} transform={`rotate(${40 - i * 6} ${26 - i * 2.4} ${y})`} />
      ))}
    </svg>
  );
}

/** Centered crown ABOVE a large white/silver premium title (subtle purple shadow), flanked by faint
 * laurels. The subtitle's second clause ("HOLD THE CROWN.") is accented gold. */
function LeaderboardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  // Split "CLIMB THE FIELD. HOLD THE CROWN." into the lead-in + the gold accent clause. Works across
  // locales (each subtitle is two sentences joined by ". "); falls back to all-muted if unsplit.
  const at = subtitle.indexOf(". ");
  const lead = at >= 0 ? subtitle.slice(0, at + 1) : subtitle;
  const accent = at >= 0 ? subtitle.slice(at + 2) : "";

  return (
    <div style={{ position: "relative", textAlign: "center", padding: "0" }}>
      {/* Soft halo behind the crown. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: -6,
          left: "50%",
          transform: "translateX(-50%)",
          width: 150,
          height: 96,
          background: "radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--amber) 22%, transparent), transparent 66%)",
          pointerEvents: "none",
        }}
      />
      <img
        src={lobbyArt.crownHero}
        alt=""
        aria-hidden
        draggable={false}
        style={{
          position: "relative",
          width: "clamp(38px, 9vw, 44px)",
          height: "clamp(38px, 9vw, 44px)",
          objectFit: "contain",
          margin: "0 auto -4px",
          display: "block",
          filter: "drop-shadow(0 4px 12px rgba(255,193,52,.5))",
        }}
      />
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Laurel />
        <FitText
          as="div"
          size="clamp(34px, 9.2vw, 44px)"
          min={0.58}
          style={{
            // Premium blocky/metallic wordmark — Sora 800 (NOT the cartoon display face), tight and
            // upright (no warp), brushed white→silver gradient with a subtle emboss.
            fontFamily: "Sora, system-ui, sans-serif",
            fontWeight: 800,
            lineHeight: 0.9,
            letterSpacing: "-0.015em",
            textTransform: "uppercase",
            backgroundImage: "linear-gradient(180deg, #ffffff 0%, #e3e6f1 44%, #b6bcd2 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            WebkitTextFillColor: "transparent",
            filter: "drop-shadow(0 1px 0 rgba(255,255,255,.2)) drop-shadow(0 2px 2px rgba(22,13,48,.7))",
            // Shrink a longer localized title to hold one line rather than pushing the flanking
            // laurels; English is short → content width, so the laurels still hug it.
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {title}
        </FitText>
        <Laurel flip />
      </div>
      <div
        style={{
          position: "relative",
          marginTop: 4,
          fontSize: "clamp(9.5px, 2.8vw, 11px)",
          fontWeight: 800,
          letterSpacing: "0.13em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: "var(--muted)" }}>{lead}</span>
        {accent && <span style={{ color: "var(--amber)" }}> {accent}</span>}
      </div>
    </div>
  );
}

// --- Window Tab ---

function WindowTab({
  fieldEmpty,
  podiumEntries,
  listRows,
  userRow,
  loading,
  openWindowId,
  youLabel,
  noScoresYet,
  noOpenWindow,
  playRanked,
}: {
  fieldEmpty: boolean;
  podiumEntries: LeaderboardRowData[];
  /** Every player from rank 4 down (excluding the user) — the scrollable field list. */
  listRows: LeaderboardRowData[];
  /** The current user's own row — shown as a persistent footer beneath the scroll list. */
  userRow: LeaderboardRowData | null;
  loading: boolean;
  openWindowId: string | null;
  youLabel: string;
  noScoresYet: string;
  noOpenWindow: string;
  playRanked: string;
}) {
  if (loading) {
    // Skeleton of the board shape (podium + rows) instead of a text-only wait.
    return (
      <div aria-busy style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 14, padding: "10px 0 4px" }}>
          <Skeleton width={64} height={84} radius={14} />
          <Skeleton width={72} height={104} radius={14} />
          <Skeleton width={64} height={72} radius={14} />
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <SkeletonRow key={i} style={{ padding: "6px 4px" }} />
        ))}
      </div>
    );
  }

  if (!openWindowId) {
    return <EmptyState icon="🌙" message={noOpenWindow} />;
  }

  if (fieldEmpty) {
    return <EmptyState icon="🏆" message={noScoresYet} cta={playRanked} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {/* Top 3 podium — the focal point, sitting on the arena surface. */}
      <PodiumTopThree entries={podiumEntries} youLabel={youLabel} />

      {/* The field list (ranks 4 → N) — a plain stack that scrolls with the page (the whole screen
       * flicks like a game feed). The user's row is excluded here; it's pinned below so it's always
       * visible while you scroll the field. */}
      <div role="table" aria-label="Leaderboard" style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {listRows.map((row) => (
          <LeaderboardRow key={`${row.rank}-${row.username}`} row={row} youLabel={youLabel} />
        ))}
      </div>

      {/* Your rank — a slim bar pinned just above the nav, so you always see where you stand while the
       * field scrolls. Centered to the same content column; row height (not a banner). */}
      {userRow && (
        <div
          aria-label="Your rank"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: "calc(86px + env(safe-area-inset-bottom))",
            zIndex: 25,
            display: "flex",
            justifyContent: "center",
            padding: "0 24px",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 430,
              pointerEvents: "auto",
              // Opaque backdrop so the scrolling field never bleeds through the pinned row, plus a
              // soft top shadow that lifts it above the list.
              borderRadius: 16,
              background: "rgba(12,6,26,.94)",
              boxShadow: "0 -8px 22px rgba(0,0,0,.45)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
            }}
          >
            <LeaderboardRow row={userRow} youLabel={youLabel} />
          </div>
        </div>
      )}
    </div>
  );
}

// --- Global Tab ---

function GlobalTab({
  rank,
  totalPlayers,
  division,
  rating,
  labels,
}: {
  rank: number | null;
  totalPlayers: number;
  division: string;
  rating: number;
  labels: {
    yourStanding: string;
    unranked: string;
    inTheField: string;
    rating: string;
    globalStanding: string;
    globalComingSoon: string;
    ofTotal: string;
  };
}) {
  const fieldLabel = fmt(labels.ofTotal, { total: totalPlayers.toLocaleString(activeTag()) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* User's global snapshot */}
      <div
        style={{
          borderRadius: 18,
          padding: "16px 18px",
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--brand) 35%, var(--panel2)), var(--panel))",
          border: "1px solid color-mix(in srgb, var(--brand) 30%, transparent)",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <img
          src={lobbyArt.shieldAvatar}
          alt=""
          aria-hidden
          draggable={false}
          style={{
            width: 52,
            height: 52,
            objectFit: "contain",
            flex: "none",
            filter: "drop-shadow(0 5px 12px rgba(0,0,0,.45))",
          }}
        />
        <div style={{ flex: 1 }}>
          <FitText
            as="div"
            size={10}
            min={0.66}
            style={{
              fontWeight: 800,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "var(--brand-2)",
              marginBottom: 4,
              width: "100%",
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {labels.globalStanding}
          </FitText>
          <div
            className="display"
            style={{ fontSize: 28, fontWeight: 900, color: "var(--text)", lineHeight: 1 }}
          >
            {rank != null ? `#${rank}` : labels.unranked}
          </div>
          {totalPlayers > 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              {fieldLabel} {labels.inTheField}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "none" }}>
          <MiniStat label={labels.rating} value={rating.toLocaleString(activeTag())} />
          {division && <MiniStat label="Division" value={division} gold />}
        </div>
      </div>

      {/* Coming soon */}
      <div
        style={{
          borderRadius: 18,
          padding: "22px 18px",
          background: "color-mix(in srgb, var(--panel) 40%, transparent)",
          border: "1px dashed var(--line)",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span aria-hidden style={{ fontSize: 26 }} className="emoji">🏆</span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--muted)",
            letterSpacing: "0.04em",
          }}
        >
          {labels.globalComingSoon}
        </span>
      </div>
    </div>
  );
}

function MiniStat({ label, value, gold = false }: { label: string; value: string; gold?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: 8,
        background: "color-mix(in srgb, var(--panel) 50%, transparent)",
        border: `1px solid ${gold ? "color-mix(in srgb, var(--amber) 24%, transparent)" : "var(--line)"}`,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 800, fontFamily: "Fredoka, sans-serif", color: gold ? "var(--amber)" : "var(--text)" }}>
        {value}
      </span>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)" }}>
        {label}
      </span>
    </div>
  );
}

// Provisional-vs-final banner for the daily royale standings. Final = a gold "settled" pill; while
// the field is still moving, an amber dot + honest "field still moving" copy (never "players").
export function StandingsStatus({
  isFinal,
  provisionalLabel,
  finalLabel,
}: {
  isFinal: boolean;
  provisionalLabel: string;
  finalLabel: string;
}) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        alignSelf: "center",
        background: isFinal
          ? "color-mix(in srgb, var(--amber) 12%, transparent)"
          : "color-mix(in srgb, var(--brand) 12%, transparent)",
        border: `1px solid ${isFinal ? "color-mix(in srgb, var(--amber) 35%, transparent)" : "color-mix(in srgb, var(--brand) 30%, transparent)"}`,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: isFinal ? "var(--amber)" : "var(--brand-2)",
          boxShadow: isFinal ? "0 0 8px var(--amber)" : "0 0 8px var(--brand-2)",
        }}
      />
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color: isFinal ? "var(--amber)" : "var(--brand-2)",
        }}
      >
        {isFinal ? finalLabel : provisionalLabel}
      </span>
    </div>
  );
}

/** Theme-agnostic full-screen fallback for the pre-content dead-ends (no session / load failed).
 * Rendered BEFORE the themed layout branches so every theme gets the same escape hatch. */
function FallbackPanel({ message, children }: { message: string; children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: 24,
      }}
    >
      <div style={{ color: "var(--pink)", fontWeight: 700, marginBottom: 8, textAlign: "center" }}>
        {message}
      </div>
      {children}
    </main>
  );
}

function EmptyState({ icon, message, cta }: { icon: string; message: string; cta?: string }) {
  return (
    <div
      style={{
        borderRadius: 18,
        padding: "32px 20px",
        background: "color-mix(in srgb, var(--panel) 40%, transparent)",
        border: "1px dashed var(--line)",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span aria-hidden className="emoji" style={{ fontSize: 28 }}>{icon}</span>
      <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 600 }}>{message}</span>
      {cta && (
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--brand-2)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {cta}
        </span>
      )}
    </div>
  );
}

