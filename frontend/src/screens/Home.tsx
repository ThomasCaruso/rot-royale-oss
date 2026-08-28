import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type CurrentContest, type FieldEntry, type HistoryItem, type PendingUnlock, type BrainBoostToday, type WindowOut } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { trackFunnel } from "@/lib/analytics";
import { deriveHeroPhase, formatDuration, windowProgress } from "@/lib/home";
import { pickAutoRevealResult } from "@/lib/results";
import { hasSeenResult, markResultSeen } from "@/lib/seenResults";
import { rotReportFromApi } from "@/lib/rotReport";
import { loadRotReport, type StoredRotReport } from "@/lib/rotReportStore";
import { resumeAudio } from "@/lib/sfx";
import { formatLocalTime } from "@/lib/time";
import { DuelCard } from "@/screens/duel/DuelCard";
import { BottomNav } from "@/screens/home/BottomNav";
import { SaveProfileScreen } from "@/screens/brainboost/SaveProfileScreen";
import { HeroCard, type HeroState } from "@/screens/home/HeroCard";
import { HomeBackdrop } from "@/screens/home/HomeBackdrop";
import { HomeHeader } from "@/screens/home/HomeHeader";
import { titleCase } from "@/lib/titleCase";
import { HubTiles } from "@/screens/home/HubTiles";
import { MonoBattleHero } from "@/screens/home/MonoBattleHero";
import { MonoHubList, type MonoHubRow } from "@/screens/home/MonoHubList";

import { UnlockReveal } from "@/screens/home/UnlockReveal";
import { ThemeChoiceModal } from "@/screens/home/ThemeChoiceModal";
import {
  ProfileMenu,
  RotReportReplay,
  RoyaleResultsModal,
} from "@/screens/home/lazyOverlays";
import { useBackInterceptor } from "@/app/backInterceptors";
import { useSessionStore } from "@/store/session";
import { getPreset } from "@/theme/identity";
import { useArtStyle, useThemeArt } from "@/theme/useArtStyle";
import { BoltIcon, BrainIcon, SparkIcon, SwordIcon, SwordsIcon, TrendIcon, UsersIcon } from "@/ui/icons";
import { CrownIcon } from "@/ui/CrownIcon";

/** A hub-row RIGHT-side illustration (the Starter brain/shield art) — the contextual visual,
 * never the left feature icon. */
function RowArt({ src, size = 40 }: { src: string; size?: number }) {
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{
        display: "block",
        width: `min(${size}px, 21vw)`,
        height: "auto",
        aspectRatio: "1 / 1",
        objectFit: "contain",
      }}
    />
  );
}

/** A little 4-point sparkle — the "AI energy" accent flecks around the brain. */
function Spark({ style }: { style: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden style={{ position: "absolute", width: "1em", height: "1em", ...style }}>
      <path d="M12 1.5 L13.7 9.5 L22 12 L13.7 14.5 L12 22.5 L10.3 14.5 L2 12 L10.3 9.5 Z" fill="currentColor" />
    </svg>
  );
}

/** Brain Boost row RIGHT visual: the brain over a cool, organic purple "AI energy" haze that bleeds
 * off into the pill (not a tidy circle), dusted with a few sparkles. */
function BrainVisual({ src }: { src: string }) {
  return (
    <span style={{ position: "relative", display: "grid", placeItems: "center", flex: "none", width: 62 }}>
      {/* Organic blurred haze — two offset lobes, tilted, hugging the brain (a small spill, not a
          takeover of the pill). */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: "-24% -14% -20% -30%",
          background:
            "radial-gradient(58% 76% at 62% 44%, color-mix(in srgb, var(--brand) 34%, transparent) 0%, transparent 66%), radial-gradient(50% 62% at 30% 64%, color-mix(in srgb, var(--brand-2) 24%, transparent) 0%, transparent 70%)",
          filter: "blur(6px)",
          transform: "rotate(-8deg)",
          pointerEvents: "none",
        }}
      />
      <Spark style={{ top: "-6%", left: "-6%", fontSize: 11, color: "var(--brand-2)" }} />
      <Spark style={{ bottom: "2%", right: "-4%", fontSize: 8, color: "var(--amber)" }} />
      {/* `art.brain` is the theme's own brain: the dark skins carry `brain-dark.png`, drawn to sit on
       * a dark card, and everything else keeps the ivory-page `brain.png` (theme/tokens.ts).
       *
       * There used to be a white silhouette of the brain blurred in behind this one. `brain.png` has
       * real alpha GAPS in its wispy upper edge — it expects a light page to show through them — so
       * on the dark skins the card showed through instead and the brain read chewed and speckled;
       * the underlay pushed light into the gaps to hide that. It was a workaround for artwork that
       * did not exist, and now it does, so it is gone rather than stacked on top. */}
      <RowArt src={src} size={62} />
    </span>
  );
}

/** A character portrait disc for the rows' right-side visuals — the illustrated hoodie busts
 * (/avatars/portraits/*.png) in a clean circular crop over a soft lavender disc with a hairline
 * ring from the theme tokens. */
function RowPortrait({ src, size = 54, overlap = false, flip = false, clean = false }: { src: string; size?: number; overlap?: boolean; flip?: boolean; clean?: boolean }) {
  return (
    <span
      style={{
        display: "block",
        flex: "none",
        // Scale down with the viewport so the centre copy keeps room on narrow phones.
        width: `min(${size}px, 11.4vw)`,
        aspectRatio: "1 / 1",
        borderRadius: "50%",
        overflow: "hidden",
        // `clean` (Friends cluster): just the image — no disc, no haze, and no outline ring; only a
        // white hairline so overlapping avatars still separate (invisible against the card).
        background: clean ? "transparent" : "color-mix(in srgb, var(--brand) 10%, var(--panel2))",
        border: "1.5px solid var(--panel)",
        boxShadow: clean
          ? "none"
          : "0 0 0 1px color-mix(in srgb, var(--brand) 20%, var(--line)), 0 3px 6px color-mix(in srgb, var(--brand) 16%, transparent)",
        marginLeft: overlap ? -Math.round(size * 0.22) : 0,
      }}
    >
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", transform: flip ? "scaleX(-1)" : undefined }}
      />
    </span>
  );
}

/** Battle row right visual: the player's own character VS a rival character (the blonde `bishop`,
 * or `crescent` when the player themselves wears bishop). */
function VsPair({ myPreset }: { myPreset?: string }) {
  const mine = getPreset(myPreset);
  const rival = mine.id === "bishop" ? getPreset("crescent") : getPreset("bishop");
  return (
    <span style={{ display: "flex", alignItems: "center" }}>
      {mine.portrait && <RowPortrait src={mine.portrait} size={50} />}
      {/* The VS clash mark — no badge, just bold italic letters with a gold outline, sitting over
          the two fighters so Battle Mode reads unmistakably as a head-to-head. */}
      <span
        aria-hidden
        style={{
          position: "relative",
          zIndex: 2,
          flex: "none",
          margin: "0 -8px",
          color: "#fff",
          fontStyle: "italic",
          fontWeight: 900,
          fontSize: 20,
          letterSpacing: "0.02em",
          lineHeight: 1,
          WebkitTextStroke: "1.4px var(--amber)",
          paintOrder: "stroke",
          textShadow: "0 1px 3px rgba(0,0,0,.45)",
        }}
      >
        VS
      </span>
      {rival.portrait && <RowPortrait src={rival.portrait} size={50} />}
    </span>
  );
}

// Curated 'friends' faces for the row's decorative cluster — the blonde `sol` stands in for the
// bespectacled `rook`, and ginger `ember` stands in for the blonde-girl `bishop` (who now appears as
// the Battle rival). The player's own character is filtered out and the next face backfills.
const FRIEND_SHOWCASE = ["crescent", "sol", "ember", "bishop", "willow", "onyx"];

/** Friends row right visual: an overlapping cluster of the OTHER characters (not the player's). */
function FriendCluster({ myPreset }: { myPreset?: string }) {
  const mine = getPreset(myPreset);
  const others = FRIEND_SHOWCASE.map(getPreset).filter((p) => p.id !== mine.id && p.portrait).slice(0, 3);
  return (
    <span style={{ display: "flex", alignItems: "center" }}>
      {others.map(
        (p, i) => p.portrait && <RowPortrait key={p.id} src={p.portrait} size={44} overlap={i > 0} flip={i === 1} clean />,
      )}
    </span>
  );
}

/** Growth row right visual: a premium upward-trend graph drawn straight into the row — no icon
 * tile, no container. A soft gradient area sits under a smooth rising brand line with two data
 * nodes, and a gold arrowhead breaks up-and-to-the-right off the top. Part of the page, not a boxed
 * icon. Decorative — the connotation is "your growth is climbing", not a real data series. */
function GrowthVisual() {
  return (
    <svg
      width={92}
      height={50}
      viewBox="0 0 92 50"
      aria-hidden
      shapeRendering="geometricPrecision"
      style={{ display: "block", flex: "none", overflow: "visible" }}
    >
      <defs>
        {/* A rich area wash with real body — the fill that lifts it from a thin sketch to a chart. */}
        <linearGradient id="rrGrowthArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.4} />
          <stop offset="68%" stopColor="var(--brand)" stopOpacity={0.08} />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
        </linearGradient>
        {/* The line sweeps from soft violet at the low start into deep brand at the rising peak. */}
        <linearGradient id="rrGrowthLine" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--brand-2)" />
          <stop offset="100%" stopColor="var(--brand)" />
        </linearGradient>
      </defs>
      {/* Gradient area under the rally. Same vertices as the line — a Catmull-Rom spline through the
          exact points (4,40)(18,26)(32,31)(46,18)(60,23)(84,5), so the trajectory/motion is
          unchanged; only the rendering is smoothed from a jagged polyline to a flowing curve. */}
      <path
        d="M4,40 C6.3,37.7 13.3,27.5 18,26 C22.7,24.5 27.3,32.3 32,31 C36.7,29.7 41.3,19.3 46,18 C50.7,16.7 53.7,25.2 60,23 C66.3,20.8 80,8 84,5 L84,46 L4,46 Z"
        fill="url(#rrGrowthArea)"
      />
      {/* The rally line — the same up/down/up/down climb, now a silky gradient curve through those
          exact points, with round caps/joins and a soft brand lift. Higher quality, identical path. */}
      <path
        d="M4,40 C6.3,37.7 13.3,27.5 18,26 C22.7,24.5 27.3,32.3 32,31 C36.7,29.7 41.3,19.3 46,18 C50.7,16.7 53.7,25.2 60,23 C66.3,20.8 80,8 84,5"
        fill="none"
        stroke="url(#rrGrowthLine)"
        strokeWidth={3.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: "drop-shadow(0 2px 4px color-mix(in srgb, var(--brand) 36%, transparent))" }}
      />
      {/* The breakout point — a gold arrowhead pointing up-and-to-the-right, over a soft gold glow. */}
      <circle cx={84} cy={5} r={6.5} fill="color-mix(in srgb, var(--amber) 26%, transparent)" />
      <path
        d="M75,6 L84,5 L80.5,13.3"
        fill="none"
        stroke="var(--amber)"
        strokeWidth={3.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Friends-duel row — the same premium violet-glass language as the hub tiles (gradient panel,
 * accent rim, top sheen, controlled shadow — depth without glow), so it never reads as a flat
 * settings row sandwiched between game cards. */
const friendsBtn: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: "12px 16px",
  borderRadius: 20,
  border: "1px solid color-mix(in srgb, var(--brand-2) 42%, var(--line))",
  background:
    "radial-gradient(130% 140% at 88% 0%, color-mix(in srgb, var(--brand-2) 22%, var(--panel2)) 0%, color-mix(in srgb, var(--panel) 96%, black) 70%)",
  boxShadow:
    "0 12px 26px rgba(0,0,0,.4), inset 0 0 0 1px color-mix(in srgb, var(--brand-2) 18%, transparent), inset 0 2px 0 rgba(255,255,255,.12), inset 0 -18px 26px rgba(0,0,0,.28)",
  color: "var(--text)",
  fontWeight: 700,
  fontSize: 13.5,
  cursor: "pointer",
};

/** The sword emblem's disc — dark violet glass with a thin gold rim (matches the CTA plaque family). */
const friendsEmblem: React.CSSProperties = {
  flex: "none",
  width: 34,
  height: 34,
  borderRadius: 11,
  display: "grid",
  placeItems: "center",
  background: "linear-gradient(180deg, color-mix(in srgb, var(--brand) 52%, #0d0620), #0c0518)",
  border: "1px solid color-mix(in srgb, var(--amber) 55%, #7a4d00)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.16), inset 0 -2px 5px rgba(0,0,0,.5)",
};

const shell: React.CSSProperties = {
  // position/zIndex keep the content above the fixed HomeBackdrop glow layer (z 0).
  position: "relative",
  zIndex: 1,
  width: "100%",
  maxWidth: 480,
  margin: "0 auto",
  // Bottom padding clears the (taller) floating nav: 10 offset + 74 bar + 14 play-lift + breathing room.
  padding: "calc(clamp(14px, 5vw, 22px) + env(safe-area-inset-top)) clamp(14px, 4vw, 20px) calc(150px + env(safe-area-inset-bottom))",
  display: "flex",
  flexDirection: "column",
  // Themable stack density (--gap-shell): arcade keeps today's tight stack; mono opens it up.
  gap: "var(--gap-shell, clamp(10px, 3vw, 13px))",
};

/** Full-screen scrim for the re-opened Rot Report — sits above the fixed nav on the theme bg. */
const reportOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  overflowY: "auto",
  background: "var(--bg)",
};

/** The royale window the hero is "about" right now: an OPEN/CLOSED one dominates (the live/settling
 * event); otherwise the soonest SCHEDULED royale (the next open we count down to). */
function pickActiveRoyale(contest: CurrentContest | null): WindowOut | null {
  if (!contest) return null;
  const open = contest.open_window;
  if (open?.slot === "royale" && (open.state === "OPEN" || open.state === "CLOSED")) return open;
  const royales = contest.schedule.filter((w) => w.slot === "royale");
  const live = royales.find((w) => w.state === "OPEN" || w.state === "CLOSED");
  return live ?? null;
}

/** The next royale to open — the soonest SCHEDULED royale by open time (today before open, or
 * tomorrow after settle). Used for the A/F "unlocks at {time}" countdown. */
function pickNextRoyale(contest: CurrentContest | null): WindowOut | null {
  if (!contest) return null;
  return (
    contest.schedule
      .filter((w) => w.slot === "royale" && w.state === "SCHEDULED")
      .sort((a, b) => Date.parse(a.open_at) - Date.parse(b.open_at))[0] ?? null
  );
}

export function Home({
  onPlay,
  onQuickPlay,
  onPractice,
  onTrainCategory,
  onCampaign,
  onGrowth,
  onLeaderboard,
  onVault,
  onDuel,
  onFriends,
}: {
  onPlay: (windowId: string) => void;
  onQuickPlay: () => void;
  onPractice: () => void;
  // Jump straight into a category practice session (the Brain Boost card's "train weak spot").
  onTrainCategory: (category: string) => void;
  onCampaign: () => void;
  onGrowth: () => void;
  onLeaderboard: () => void;
  onVault: () => void;
  onDuel: () => void;
  onFriends: () => void;
}) {
  const t = useT();
  const me = useSessionStore((s) => s.me);
  const mono = useArtStyle() === "mono";
  const art = useThemeArt();
  const [contest, setContest] = useState<CurrentContest | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastResult, setLastResult] = useState<HistoryItem | null>(null);
  const [field, setField] = useState<FieldEntry[]>([]);
  // Server-authoritative field metadata (the `field` list above is only the top slice, bounded for
  // scale). `fieldSize` is the TRUE count; `myFieldScore` is the caller's own score even when they
  // scored below the slice. Within the slice these agree with the list.
  const [fieldSize, setFieldSize] = useState(0);
  const [myFieldScore, setMyFieldScore] = useState(0);
  const [entered, setEntered] = useState(false);
  // Today's entry id, when the player has one — the handle for re-opening (and re-sharing) their
  // Rot Report, including rebuilding it from the server on a device that didn't play the run.
  const [playedEntryId, setPlayedEntryId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  // First-login "pick your look" popup — shown once ever (device flag), default dismissed on any error.
  const [themeIntroSeen, setThemeIntroSeen] = useState(() => {
    try {
      return localStorage.getItem("rr-theme-intro-seen") === "1";
    } catch {
      return true;
    }
  });
  const dismissThemeIntro = () => {
    try {
      localStorage.setItem("rr-theme-intro-seen", "1");
    } catch {
      /* non-persistent is fine — the picker just reappears next cold start */
    }
    setThemeIntroSeen(true);
  };
  // Re-open of today's own Rot Report from the completed Daily row (view + re-share after the fact).
  const [reportOpen, setReportOpen] = useState(false);
  // The unlock net: cosmetics earned since last seen (streak/rank/duel/level), revealed on Home load.
  const [pendingUnlocks, setPendingUnlocks] = useState<PendingUnlock[]>([]);

  // Android BACK on these full-screen layers matched no App-level branch and exited the app —
  // press back while reading your results and Rot Royale would simply close. Innermost first.
  useBackInterceptor(
    reportOpen,
    useCallback(() => {
      setReportOpen(false);
      return true;
    }, []),
  );
  useBackInterceptor(
    resultsOpen,
    useCallback(() => {
      setResultsOpen(false);
      return true;
    }, []),
  );
  useBackInterceptor(
    menuOpen,
    useCallback(() => {
      setMenuOpen(false);
      return true;
    }, []),
  );
  // Today's Brain Boost state (the primary daily ritual card) + guest save-profile overlay.
  const [rotToday, setRotToday] = useState<BrainBoostToday | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const autoOpenedRef = useRef(false); // auto-reveal fires at most once per Home mount
  const mountedRef = useRef(true); // guards setState across async refreshes / unmount
  const [now, setNow] = useState(() => Date.now());
  // Bump when a result is marked seen so the hero re-derives E→F without a refetch.
  const [seenTick, setSeenTick] = useState(0);

  // Re-fetch contest/field/history so the hero phase advances across close/settle/open boundaries
  // and the OPEN-window field count stays live. Called on mount and on the 30s interval below.
  const refresh = useCallback(async () => {
    try {
      const c = await api.currentContest();
      if (!mountedRef.current) return;
      setContest(c);
      const active = pickActiveRoyale(c);
      if (active) {
        // The entry id is read in EVERY played phase, not just while the window is OPEN: the
        // completed Daily row re-opens today's Rot Report, and rebuilding that from the server
        // (when this device holds no stash) needs the id through settling/viewed too. The live
        // field is still an OPEN-window-only read.
        const [mine, f] = await Promise.all([
          api.myEntry(active.id).catch(() => null),
          active.state === "OPEN"
            ? api
                .windowField(active.id)
                .catch(() => ({
                  entries: [] as FieldEntry[],
                  field_size: 0,
                  my_rank: null,
                  my_score: 0,
                }))
            : Promise.resolve(null),
        ]);
        if (!mountedRef.current) return;
        setEntered(Boolean(mine?.entry_id));
        setPlayedEntryId(mine?.entry_id ?? null);
        if (f) {
          setField(f.entries);
          setFieldSize(f.field_size ?? f.entries.length);
          setMyFieldScore(f.my_score ?? 0);
        }
      }
    } catch {
      // transient fetch failure — keep the last good state, retry next tick
    } finally {
      if (mountedRef.current) setLoading(false);
    }

    try {
      const h = await api.history();
      if (!mountedRef.current) return;
      setLastResult(h.items.find((i) => i.state === "SETTLED" && i.place != null) ?? null);
      // Auto-reveal: when the user returns after a participated contest has SETTLED, pop the
      // dramatic results once. Only the most-recent unseen settled+placed result qualifies (never
      // an active window), and only once per mount — `autoOpenedRef` is set on the first qualifying
      // refresh and never re-armed.
      const userId = useSessionStore.getState().me?.user_id;
      const candidate = userId
        ? pickAutoRevealResult(h.items, (wid) => hasSeenResult(userId, wid))
        : null;
      if (candidate && !autoOpenedRef.current) {
        autoOpenedRef.current = true;
        window.setTimeout(() => mountedRef.current && setResultsOpen(true), 600);
      }
    } catch {
      // ignore — last good history stays
    }

    // The unlock net: surface any cosmetics earned since last seen (streak/rank/duel/level). The
    // results screens catch most in-the-moment; this catches the rest (e.g. a streak crossing at
    // midnight) on the next Home load. Reveal only once we're not mid results-modal.
    try {
      const p = await api.pendingUnlocks();
      if (!mountedRef.current) return;
      setPendingUnlocks(p.items);
    } catch {
      // transient — the net simply retries next tick
    }

    // Today's Brain Boost + latest Brain Profile read — the daily-ritual card's state.
    try {
      const rc = await api.brainBoostToday();
      if (!mountedRef.current) return;
      setRotToday(rc);
    } catch {
      // transient — the card falls back to the pending-CTA state
    }
  }, []);

  // Refresh data + tick the countdown each half-minute, keeping the hero phase fresh across
  // OPEN→CLOSED→SETTLED→(next)OPEN boundaries; `now` updates immediately after each refresh.
  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const id = window.setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 30_000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(id);
    };
  }, [refresh]);

  // Standings within the open window — cumulative scores for hero rank + field size.
  const rows = useMemo(
    () =>
      field.map((e) => ({
        username: e.username,
        score: e.points.reduce((a, b) => a + b, 0),
        isMe: e.username === me?.username,
      })),
    [field, me?.username],
  );
  // Prefer the server's own-score (correct even below the top slice); fall back to the list for
  // older responses / the within-slice case where they're identical.
  const myScore = useMemo(
    () => rows.find((r) => r.isMe)?.score ?? myFieldScore,
    [rows, myFieldScore],
  );

  const active = pickActiveRoyale(contest);
  const next = pickNextRoyale(contest);

  // The settled result that drives E/F — the most recent settled+placed run (same one the reveal
  // modal opens). `seenTick` is a dep so this recomputes after we mark it seen (E→F).
  const resultSeen = useMemo(
    () => (lastResult != null && me != null ? hasSeenResult(me.user_id, lastResult.window_id) : false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lastResult, me, seenTick],
  );

  const phase = deriveHeroPhase({
    loading: loading && !contest,
    activeRoyale: active,
    entered,
    hasResult: lastResult != null,
    resultSeen,
    nowMs: now,
  });

  // The royale CTA: enter the open window (B) — the only state with a play action on the hero.
  const canPlay = Boolean(active && active.state === "OPEN" && !entered);
  // The TRUE field size from the server (the `rows` list is only the top slice). Falls back to the
  // list length for older responses / small fields where they match.
  const fieldCount = fieldSize || rows.length;
  const fieldText = fieldCount ? fmt(t.home.inField, { n: fieldCount }) : null;

  // Mono home state switch: today's attempt is spent (locked/settling/viewed) → Battle Mode takes
  // the hero and the Daily drops into the list as a completed row. "ready" deliberately keeps the
  // Daily hero — the Reveal CTA is that state's moment.
  const playedToday = phase === "locked" || phase === "settling" || phase === "viewed";
  // The Daily row, once played, re-opens today's OWN Rot Report (view + re-share) instead of being a
  // dead "done" row. The report is replayed from the client stash saved at finish; we only surface it
  // when the stash is for the window the player actually played today (never a stale earlier day).
  const playedWindowId = active?.id ?? lastResult?.window_id ?? null;
  const userId = me?.user_id ?? null;
  // Read once per user: the stash is written on the Contest finish screen, so by the time Home
  // (re)mounts the latest report is already present — no need to re-read on every Home tick.
  const savedReport = useMemo(() => (userId ? loadRotReport(userId) : null), [userId]);
  const stashedReport =
    savedReport && playedWindowId && savedReport.windowId === playedWindowId ? savedReport : null;
  // The stash is PER DEVICE. Play on your phone and this browser has none, so the row used to go
  // dead with no explanation. The server can rebuild the same report from the stored rounds, so fall
  // back to it — the completed row is never a dead end just because you switched devices.
  const [rebuiltReport, setRebuiltReport] = useState<StoredRotReport | null>(null);
  useEffect(() => {
    if (!playedToday || stashedReport || !playedEntryId || !playedWindowId) return;
    let alive = true;
    api
      .rotReport(playedEntryId)
      .then((res) => {
        if (!alive) return;
        setRebuiltReport({
          windowId: playedWindowId,
          entryId: playedEntryId,
          report: rotReportFromApi(res),
        });
      })
      .catch(() => undefined); // offline / transient — the row simply stays un-tappable this tick
    return () => {
      alive = false;
    };
  }, [playedToday, stashedReport, playedEntryId, playedWindowId]);
  // The stash wins when present: it is what this player actually saw at the finish line, so the
  // device that played the run never shows numbers rebuilt a second way. The rebuilt one is checked
  // against the current window too, so a report fetched before a day rollover is never re-shown.
  const replayReport =
    stashedReport ?? (rebuiltReport?.windowId === playedWindowId ? rebuiltReport : null);
  // Brain Boost lives IN the grouped list (directly above Friends, per the hierarchy: Daily/Battle →
  // Brain Boost → Friends → Campaign) — never as a second tile lower on the page. When today's check
  // is done the row wears a "✓ Brain Score N" badge but STAYS tappable (it trains the weakest
  // category; falls back to another check when no weakness is known).
  const brainSummary = rotToday?.completed_today === true ? (rotToday.latest ?? null) : null;
  const rotWeakest = brainSummary?.weaknesses[0] ?? null;
  // Premium (Starter) rows: LEFT a simple feature icon in a circle, CENTER title + subtitle,
  // RIGHT the contextual visual (illustration / avatars / badge) + chevron. The art-less Blank
  // pair keeps its flat single-label rows (no sub → plain dressing). The premium Brain Boost row
  // drops the Brain Score pill (cleaner, per the reference) — the score lives on Your Growth.
  const premium = art != null;
  const brainBoostRow: MonoHubRow = {
    key: "brainboost",
    label: t.brainBoost.introTitle,
    icon: premium ? <BrainIcon size={27} /> : <BoltIcon size={19} />,
    onClick: rotWeakest ? () => onTrainCategory(rotWeakest.category) : onQuickPlay,
    ...(art
      ? { sub: t.home.rowBrainSub, iconArt: art.iconBrain, right: <BrainVisual src={art.brain} /> }
      : brainSummary
        ? { done: `${t.brainBoost.brainScore} ${brainSummary.brain_score}` }
        : {}),
  };
  const friendsRow: MonoHubRow = {
    key: "friends",
    label: t.friends.title,
    icon: <UsersIcon size={premium ? 26 : 19} />,
    onClick: onFriends,
    ...(art ? { sub: t.home.rowFriendsSub, iconArt: art.iconFriends, right: <FriendCluster myPreset={me?.avatar_preset} /> } : {}),
  };
  const growthRow: MonoHubRow = {
    key: "growth",
    label: t.growth.title,
    icon: premium ? <TrendIcon size={26} /> : <SparkIcon size={19} />,
    onClick: onGrowth,
    ...(art ? { sub: t.home.rowGrowthSub, iconArt: art.iconGrowth, right: <GrowthVisual /> } : { iconAccent: true }),
  };

  // Vault deliberately has no hub row/card — it stays one tap away in the bottom nav + the header
  // coins pill, keeping Home focused on the daily ritual.
  const monoRows: MonoHubRow[] = playedToday
    ? [
        {
          key: "daily",
          label: titleCase(t.home.royaleTitle),
          icon: premium ? <CrownIcon size={24} style={{ filter: "none" }} /> : <SparkIcon size={19} />,
          done: t.home.completedToday,
          // Played rows aren't dead ends: tap re-opens today's own Rot Report to view + re-share. Only
          // wired when the stashed report is available (else it stays a plain completed row).
          onClick: replayReport ? () => setReportOpen(true) : undefined,
          // The new crown medallion renders through the SAME iconArt path as the other rows, so its
          // size/placement matches exactly (no CSS-glyph holder fallback). When re-openable, the
          // subtitle switches to a "tap to view & share" affordance.
          ...(art
            ? { sub: replayReport ? t.home.royaleReportTap : t.home.royaleTagline, iconArt: art.iconRoyale }
            : {}),
        },
        brainBoostRow,
        friendsRow,
        growthRow,
      ]
    : [
        {
          key: "battle",
          label: t.duel.cardTitle,
          icon: premium ? <SwordsIcon size={27} /> : <SwordIcon size={19} />,
          onClick: onDuel,
          ...(art ? { sub: t.home.rowBattleSub, iconArt: art.iconBattle, right: <VsPair myPreset={me?.avatar_preset} /> } : {}),
        },
        brainBoostRow,
        friendsRow,
        growthRow,
      ];

  const heroState: HeroState = (() => {
    switch (phase) {
      case "loading":
        return { kind: "loading" };
      case "live":
        return {
          kind: "live",
          // The brand tagline sits under the title; the Results time lives in the schedule rows.
          oneShotText: t.home.royaleTagline,
          fieldText,
          countdown: formatDuration(Date.parse(active!.close_at) - now),
          progress: windowProgress(active!.open_at, active!.close_at, now),
          onPlay: () => onPlay(active!.id),
        };
      case "locked":
        return {
          kind: "locked",
          scoreText: fmt(t.home.scoreValue, { n: myScore }),
          fieldText,
          countdown: formatDuration(Date.parse(active!.close_at) - now),
          progress: windowProgress(active!.open_at, active!.close_at, now),
        };
      case "settling":
        return {
          kind: "settling",
          settleText: fmt(t.home.settlesAt, { time: formatLocalTime(active!.settle_at) }),
          countdown: formatDuration(Date.parse(active!.settle_at) - now),
          progress: windowProgress(active!.close_at, active!.settle_at, now),
        };
      case "ready":
        return { kind: "ready", onReveal: () => { resumeAudio(); setResultsOpen(true); } };
      case "viewed":
        return {
          kind: "viewed",
          rank: lastResult?.place ?? null,
          opensText: next
            ? fmt(t.home.tomorrowUnlocks, { time: formatLocalTime(next.open_at) })
            : t.home.nextGame,
          countdown: next ? formatDuration(Date.parse(next.open_at) - now) : null,
        };
      case "before":
      default:
        return {
          kind: "before",
          opensText: next
            ? fmt(t.home.unlocksAt, { time: formatLocalTime(next.open_at) })
            : t.home.nextGame,
          countdown: next ? formatDuration(Date.parse(next.open_at) - now) : null,
        };
    }
  })();

  if (!me) return null;

  // Guest save-profile overlay ("save earned progress", not a signup wall). Rendered instead of
  // the dashboard; both exits simply return here — the guest keeps playing either way.
  if (saveOpen) {
    return (
      <SaveProfileScreen
        source="home_banner"
        onDone={() => setSaveOpen(false)}
        onSkip={() => setSaveOpen(false)}
      />
    );
  }

  return (
    <>
      <HomeBackdrop />
      <main
        style={{
          ...shell,
          // Premium (Starter system): wider page gutters + a touch more headroom, per the
          // reference's airier composition. Other themes keep the base shell verbatim.
          ...(art
            ? {
                // Reference geometry: 18px page gutters. Tightened for a single-screen fit — a
                // compact stack gap and just-enough bottom padding to clear the floating nav
                // (10 offset + 74 bar + ~34px air) so the whole page fits without scrolling.
                gap: "clamp(10px, 2.6vw, 13px)",
                padding:
                  "calc(clamp(10px, 3.4vw, 15px) + env(safe-area-inset-top)) 18px calc(128px + env(safe-area-inset-bottom))",
              }
            : null),
        }}
      >
        <HomeHeader
          coins={me.coins_balance}
          avatarPreset={me.avatar_preset}
          equippedFrame={me.equipped_frame}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenVault={onVault}
        />

        {/* Guests carry real progress on a device-bound session — one quiet line to save it. */}
        {me.is_guest && (
          <button
            type="button"
            className="rr-tap"
            onClick={() => {
              trackFunnel("save_profile_clicked", "home_banner");
              setSaveOpen(true);
            }}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 14,
              border: "1px dashed color-mix(in srgb, var(--amber) 55%, var(--line))",
              background: "var(--panel)",
              color: "var(--text)",
              fontWeight: 700,
              fontSize: 12.5,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {t.brainBoost.saveBanner} <span style={{ color: "var(--amber)" }}>›</span>
          </button>
        )}

        {/* Mono ("Blank") hero is STATE-AWARE: while today's Daily Royale attempt is available (or
            its results are waiting to be revealed), the Daily card owns the top; once the score is
            locked/settling/viewed, Battle Mode becomes the hero — the primary action is always
            playable. Other styles always render the Daily hero here. */}
        {mono && playedToday ? <MonoBattleHero onDuel={onDuel} myPreset={me?.avatar_preset} /> : <HeroCard state={heroState} />}

        {/* Mono ("Blank"): ONE quiet grouped list holds every destination (Daily/Battle → Rot
            Check → Friends → Your Growth) — no tile section, no repeated entries. The Brain Profile
            bars now live on the Your Growth screen, not Home. Other styles keep the full arcade
            lobby: Battle card, friends duel row, then the hub tile pair. */}
        {mono ? (
          // Mono: everything routable lives in the ONE grouped list (Daily/Battle → Brain Boost →
          // Friends → Your Growth) — no tile section below it, so nothing on the page repeats.
          <MonoHubList rows={monoRows} />
        ) : (
          <>
            <DuelCard onDuel={onDuel} gems={me.gems_balance} />

            <button type="button" className="rr-tap" onClick={onFriends} style={friendsBtn}>
              <span aria-hidden style={friendsEmblem}>
                <SwordIcon size={19} style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.5))" }} />
              </span>
              <span style={{ flex: 1, textAlign: "left", position: "relative" }}>{t.friends.subtitle}</span>
              <span aria-hidden className="display" style={{ color: "var(--amber)", fontSize: 18, position: "relative" }}>
                ›
              </span>
            </button>

            <HubTiles
              onGrowth={onGrowth}
              today={rotToday}
              onStartCheck={onQuickPlay}
              onTrainWeakSpot={onTrainCategory}
            />
          </>
        )}
      </main>

      {/* State-aware centre Play: today's Daily Royale while the attempt is available, Quick Play
          (no-stakes 8-question mixed trivia) once the score is locked. Only the brief first-load
          beat leaves Play unwired. */}
      <BottomNav
        onPlay={
          loading && !contest ? undefined : canPlay ? () => onPlay(active!.id) : onQuickPlay
        }
        playTarget={canPlay ? "royale" : "quick"}
        onCampaign={onCampaign}
        onLeaderboard={onLeaderboard}
        onVault={onVault}
      />

      {/* The three overlays below are code-split (home/lazyOverlays.ts) and share one boundary. A
          null fallback is right here: each is a panel that appears over Home on tap, so "not yet"
          simply looks like the panel hasn't opened — there is no layout underneath to hold. */}
      <Suspense fallback={null}>
      {menuOpen && (
        <ProfileMenu
          username={me.username}
          avatarPreset={me.avatar_preset}
          equippedFrame={me.equipped_frame}
          equippedBadges={me.equipped_badges}
          equippedTitle={me.equipped_title}
          onClose={() => setMenuOpen(false)}
          onOpenVault={() => { setMenuOpen(false); onVault(); }}
        />
      )}

      {/* Re-opened Rot Report (from the completed Daily row) — a full-screen overlay above Home + nav,
          reusing the exact finish card so the shared report looks identical. */}
      {reportOpen && replayReport && (
        <div style={reportOverlay}>
          <RotReportReplay
            report={replayReport.report}
            entryId={replayReport.entryId}
            windowId={replayReport.windowId}
            onClose={() => setReportOpen(false)}
            onPractice={() => {
              setReportOpen(false);
              onPractice();
            }}
          />
        </div>
      )}

      {resultsOpen && lastResult && lastResult.place != null && (
        <RoyaleResultsModal
          result={lastResult}
          me={me}
          nextOpenAt={next?.open_at ?? null}
          onClose={() => {
            setResultsOpen(false);
            // Mark seen on dismiss so it won't auto-open again (and the hero flips E→F).
            markResultSeen(me.user_id, lastResult.window_id);
            setSeenTick((n) => n + 1);
          }}
          onPractice={() => {
            setResultsOpen(false);
            markResultSeen(me.user_id, lastResult.window_id);
            setSeenTick((n) => n + 1);
            onPractice();
          }}
        />
      )}
      </Suspense>

      {/* First-login theme picker — the very first thing a new player sees; held above every other
          overlay (z 110) so it resolves before any unlock celebration underneath it. */}
      {!themeIntroSeen && <ThemeChoiceModal onDone={dismissThemeIntro} />}

      {/* The unlock net reveal — held back while the royale results modal (or the first-login theme
          picker) owns the screen so the celebrations never stack; ack clears it server-side. */}
      {!resultsOpen && themeIntroSeen && pendingUnlocks.length > 0 && (
        <UnlockReveal
          items={pendingUnlocks}
          onOpenVault={() => {
            const ids = pendingUnlocks.map((u) => u.id);
            setPendingUnlocks([]);
            void api.ackUnlocks(ids).catch(() => undefined);
            onVault();
          }}
          onDismiss={() => {
            const ids = pendingUnlocks.map((u) => u.id);
            setPendingUnlocks([]);
            void api.ackUnlocks(ids).catch(() => undefined);
          }}
        />
      )}
    </>
  );
}
