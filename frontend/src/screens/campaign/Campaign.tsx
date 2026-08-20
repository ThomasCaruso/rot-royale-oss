import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type CampaignCompleteResponse,
  type CampaignLadderResponse,
  type CampaignStartResponse,
  type CampaignWorld,
} from "@/api/client";
import { refreshMe } from "@/api/session";
import { useT } from "@/i18n/useT";
import { worldJustCompleted } from "@/lib/campaign";
import { useNetwork } from "@/store/network";
import { useSessionStore } from "@/store/session";
import { getLadder, getCampaignLevel } from "@/offline/db";
import { cacheLadder, downloadCampaign } from "@/offline/content";
import { loadProvisional, overlayLadder } from "@/offline/campaignLocal";
import type { OfflineRound } from "@/offline/types";
import { FitText } from "@/ui/FitText";
import { GoldButton } from "@/ui/GoldButton";
import { Skeleton, SkeletonRow } from "@/ui/Skeleton";
import { CampaignLadder } from "@/screens/campaign/CampaignLadder";
import { CampaignPlay } from "@/screens/campaign/CampaignPlay";
import { CampaignWorlds } from "@/screens/campaign/CampaignWorlds";
import { LevelComplete } from "@/screens/campaign/LevelComplete";
import { BottomNav } from "@/screens/home/BottomNav";
import { useStarterSystem } from "@/theme/useArtStyle";
import { errorMessage } from "@/i18n/errors";

type View = "worlds" | "ladder" | "playing" | "complete";

// Last ladder this JS context loaded, so re-opening the campaign paints instantly from memory while
// a background refresh replaces it (stale-while-revalidate). App unmounts Campaign on nav-away, so
// without this every Home↔Campaign bounce was a full cold reload behind a blocking spinner.
let lastLadder: CampaignLadderResponse | null = null;

/**
 * Campaign container: owns the worlds → ladder → play → completion flow and the ladder data. Play
 * reuses the practice round loop; completion settles rewards server-side (CampaignPlay) and this
 * refreshes the ladder + profile so unlocks and the coin balance reflect immediately.
 */
export function Campaign({
  onExit,
  onPlay,
  onQuickPlay,
  onPractice,
  onLeaderboard,
  onVault,
}: {
  onExit: () => void;
  onPlay: (windowId: string) => void;
  onQuickPlay?: () => void;
  onPractice: (category: string) => void;
  onLeaderboard?: () => void;
  onVault?: () => void;
}) {
  const t = useT();
  const online = useNetwork((s) => s.online);
  // Must match the branch CampaignWorlds takes — hence the one shared predicate.
  const starterHub = useStarterSystem();
  const userId = useSessionStore((s) => s.me?.user_id ?? "");
  const [ladder, setLadder] = useState<CampaignLadderResponse | null>(lastLadder);
  const [view, setView] = useState<View>("worlds");
  const [worldName, setWorldName] = useState<string | null>(null);
  const [session, setSession] = useState<CampaignStartResponse | null>(null);
  // When a level was started from cached content, we hold its raw OfflineRound[] so CampaignPlay can
  // reveal + record locally (offline mode). Null ⇒ online play (unchanged path).
  const [offlineRounds, setOfflineRounds] = useState<OfflineRound[] | null>(null);
  const [completion, setCompletion] = useState<CampaignCompleteResponse | null>(null);
  // The completion currently on screen was produced offline (provisional) — LevelComplete hides the
  // reward chrome and shows a "we'll sync" note instead.
  const [completionProvisional, setCompletionProvisional] = useState(false);
  // Only block the UI on the spinner when there's nothing to show; with a remembered ladder the
  // refresh happens behind the already-rendered map.
  const [loading, setLoading] = useState(lastLadder === null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  // Monotonic load sequence: only the newest in-flight load may write state, so a slow older
  // response (e.g. the network fetch racing the offline-cache read after an online flip) can't
  // clobber a newer ladder — and nothing writes after unmount.
  const loadSeqRef = useRef(0);
  // Download-for-offline control state (only meaningful online).
  const [downloadState, setDownloadState] = useState<"idle" | "busy" | "done" | "error">("idle");
  // Shared Battle affordance for the bottom nav (enabled only when a window is open and not entered).
  const [battle, setBattle] = useState<{ windowId: string; canPlay: boolean } | null>(null);

  // Load the ladder: online fetches + best-effort caches it; offline reads the cache and overlays
  // any levels cleared offline (so a just-cleared level shows cleared + pending and unlocks the next).
  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const apply = (l: CampaignLadderResponse) => {
      if (loadSeqRef.current !== seq) return;
      lastLadder = l;
      setLadder(l);
    };
    if (online) {
      const l = await api.campaign();
      apply(l);
      void cacheLadder(l).catch(() => undefined); // best-effort so the map renders offline later
      return l;
    }
    const cached = await getLadder();
    if (!cached) {
      if (loadSeqRef.current === seq) setError(t.campaign.errNotDownloaded);
      return null;
    }
    // The store user id is read at call time (not a hook dep): during session bootstrap it flips
    // "" → real id, and having it as a dependency used to refire this effect into a guaranteed
    // second GET /campaign on every cold start.
    const overlaid = overlayLadder(
      cached,
      loadProvisional(useSessionStore.getState().me?.user_id ?? ""),
    );
    apply(overlaid);
    return overlaid;
  }, [online, t]);

  useEffect(() => {
    let cancelled = false;
    setError("");
    load()
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, t, t.campaign.errLoad));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, t, reloadKey]);

  // Mirror Home's Battle affordance once at the container level so both the worlds hub and the
  // ladder share the same bottom nav (Battle enabled only when a window is open and not yet entered).
  useEffect(() => {
    let cancelled = false;
    api
      .currentContest()
      .then(async (c) => {
        const open = c.open_window;
        if (!open) return;
        const mine = await api.myEntry(open.id).catch(() => null);
        if (cancelled) return;
        setBattle({ windowId: open.id, canPlay: !mine?.entry_id });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const world: CampaignWorld | null =
    (worldName && ladder?.worlds.find((w) => w.world === worldName)) || null;

  const startLevel = useCallback(
    async (w: string, level: number) => {
      // Offline: build the session from cached level content — never touches the network.
      if (!online) {
        try {
          const lvl = await getCampaignLevel(w, level);
          if (!lvl) {
            setError(t.campaign.errLevelNotCached);
            return;
          }
          setOfflineRounds(lvl.rounds);
          setSession({
            entry_id: "",
            world: w,
            level,
            title: lvl.title,
            is_boss: lvl.is_boss,
            rounds: lvl.rounds.map((r) => ({
              idx: r.idx,
              type: "trivia",
              client_spec: r.client_spec as unknown as Record<string, unknown>,
            })),
          });
          setView("playing");
        } catch {
          setError(t.campaign.errLevelNotCached);
        }
        return;
      }
      try {
        const s = await api.campaignStart(w, level);
        setOfflineRounds(null);
        setSession(s);
        setView("playing");
      } catch (err) {
        setError(errorMessage(err, t, t.campaign.errStart));
      }
    },
    [online, t],
  );

  const onFinished = useCallback(
    async (c: CampaignCompleteResponse, opts?: { provisional?: boolean }) => {
      const provisional = Boolean(opts?.provisional);
      setCompletion(c);
      setCompletionProvisional(provisional);
      setView("complete");
      if (provisional) {
        // Offline finish: no server to refresh. Re-run load(), which offline reads the cache +
        // overlays the just-recorded provisional clear so the ladder reflects it. Best-effort:
        // callers don't await onFinished, so a rejection here would be an unhandled rejection.
        await load().catch(() => undefined);
        return;
      }
      await Promise.allSettled([load(), refreshMe()]); // unlocks + coin balance refresh
    },
    [load],
  );

  // Download for offline: prefetch every level's rounds + cache the current ladder so the campaign
  // map and its levels play offline later. Best-effort; only meaningful online.
  const download = useCallback(async () => {
    setDownloadState("busy");
    try {
      await downloadCampaign();
      if (ladder) await cacheLadder(ladder);
      setDownloadState("done");
    } catch {
      setDownloadState("error");
    }
  }, [ladder]);

  // Every pre-content state keeps a way out: the request deadline in the API client bounds how
  // long "loading" can last, and both the error and the (defensive) no-data state offer retry +
  // back instead of trapping the player — iOS has no hardware back to rescue a stuck screen.
  if (loading && !ladder) {
    // Skeleton of the worlds hub (hero card + world rows) so the wait keeps the page's shape;
    // the back button stays so a slow network never traps the player here.
    return (
      <main
        aria-busy
        aria-label={t.campaign.loading}
        style={{
          minHeight: "100dvh",
          padding: "calc(20px + env(safe-area-inset-top)) 16px 32px",
          display: "grid",
          gap: 16,
          alignContent: "start",
        }}
      >
        <Skeleton height={170} radius={22} />
        {[0, 1, 2, 3, 4].map((i) => (
          <SkeletonRow key={i} style={{ padding: "6px 2px" }} />
        ))}
        <GoldButton
          idlePulse={false}
          onClick={onExit}
          style={{ maxWidth: 240, margin: "16px auto 0" }}
        >
          {t.common.backToHub}
        </GoldButton>
      </main>
    );
  }
  if (!ladder) {
    return (
      <Centered>
        <div style={{ color: "var(--pink)", marginBottom: 16, fontWeight: 700 }}>
          {error || t.campaign.errLoad}
        </div>
        <GoldButton
          idlePulse={false}
          onClick={() => {
            setLoading(true);
            setReloadKey((k) => k + 1);
          }}
          style={{ maxWidth: 240 }}
        >
          {t.common.retry}
        </GoldButton>
        <GoldButton idlePulse={false} onClick={onExit} style={{ maxWidth: 240, marginTop: 8 }}>
          {t.common.backToHub}
        </GoldButton>
      </Centered>
    );
  }

  if (view === "playing" && session) {
    return (
      <CampaignPlay
        session={session}
        offlineRounds={offlineRounds ?? undefined}
        userId={userId}
        onFinished={onFinished}
        onAbort={() => setView("ladder")}
      />
    );
  }

  if (view === "complete" && completion && world) {
    const nextLevel =
      completion.next_level_unlocked && completion.level < world.total_levels
        ? completion.level + 1
        : null;
    return (
      <LevelComplete
        completion={completion}
        provisional={completionProvisional}
        worldIconName={world.world}
        dailyEarned={ladder.daily_coins_earned}
        dailyCap={ladder.daily_coins_cap}
        worldComplete={worldJustCompleted(world, completion)}
        onNext={nextLevel ? () => startLevel(world.world, nextLevel) : undefined}
        onReplay={() => startLevel(world.world, completion.level)}
        onBackToCampaign={() => setView("ladder")}
        onPractice={() => onPractice(world.category)}
        onVault={onVault}
      />
    );
  }

  // The worlds hub and the ladder are peer destinations to Home — both carry the shared bottom nav
  // (Campaign active) so Home/Battle/Leaderboard/Vault stay one tap away. A level in progress
  // ("playing") and the completion screen ("complete") stay immersive and render no nav.
  const nav = (
    <BottomNav
      active="campaign"
      onHome={onExit}
      onLeaderboard={onLeaderboard}
      onVault={onVault}
      onPlay={battle?.canPlay ? () => onPlay(battle.windowId) : onQuickPlay}
      playTarget={battle?.canPlay ? "royale" : "quick"}
    />
  );

  if (view === "ladder" && world) {
    return (
      <>
        <CampaignLadder
          world={world}
          dailyEarned={ladder.daily_coins_earned}
          dailyCap={ladder.daily_coins_cap}
          onBack={() => setView("worlds")}
          onPlay={(level) => startLevel(world.world, level)}
        />
        {nav}
      </>
    );
  }

  // The Starter hub (the normal themes) renders its own branded header into the top-right corner, so
  // the download control goes in-flow THERE and the fixed overlay is reserved for the other paths.
  const offlineControl = online ? (
    <DownloadButton
      banner={starterHub}
      label={
        downloadState === "busy"
          ? t.campaign.downloading
          : downloadState === "done"
            ? t.campaign.downloaded
            : downloadState === "error"
              ? t.campaign.downloadFailed
              : t.campaign.download
      }
      busy={downloadState === "busy"}
      done={downloadState === "done"}
      onClick={() => void download()}
    />
  ) : null;

  return (
    <>
      <CampaignWorlds
        ladder={ladder}
        onPick={(w) => {
          setWorldName(w.world);
          setView("ladder");
        }}
        onExit={onExit}
        onVault={onVault}
        offlineAction={starterHub ? offlineControl : undefined}
      />
      {!starterHub && offlineControl}
      {nav}
    </>
  );
}

/** A minimal control to prefetch campaign content for offline play. Honest copy: it only makes
 * levels playable offline; it never fabricates progress or rewards.
 *
 * `banner` renders it as a small frosted pill (with a download/check glyph) that the Starter hero
 * card pins inside its own top-right corner — the Starter hub's branded header owns the page's
 * top-right, so a fixed overlay would sit on top of it. Otherwise it pins to the page's top-right. */
function DownloadButton({
  label,
  busy,
  done,
  onClick,
  banner = false,
}: {
  label: string;
  busy: boolean;
  done: boolean;
  onClick: () => void;
  banner?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || done}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        ...(banner
          ? {
              // A frosted, lightly-opaque pill so it reads as a banner sitting ON the hero card
              // (the artwork shows faintly through) rather than a solid block cut out of it.
              padding: "5px 11px",
              background: "color-mix(in srgb, var(--panel) 78%, transparent)",
              border: "1px solid color-mix(in srgb, var(--line) 80%, transparent)",
              boxShadow: "0 4px 12px rgba(17,17,17,.12), inset 0 1px 0 var(--sheen)",
              backdropFilter: "blur(7px)",
              WebkitBackdropFilter: "blur(7px)",
              fontSize: 11,
              maxWidth: "100%",
              minWidth: 0,
            }
          : {
              position: "fixed",
              top: "calc(10px + env(safe-area-inset-top))",
              right: 12,
              zIndex: 5,
              padding: "6px 12px",
              background: "var(--panel)",
              border: "1px solid var(--line)",
              fontSize: 12,
            }),
        borderRadius: 999,
        color: done ? "var(--lime)" : "var(--muted)",
        fontWeight: 800,
        cursor: busy || done ? "default" : "pointer",
        opacity: busy ? 0.7 : 1,
      }}
    >
      <DownloadGlyph done={done} />
      {/* In the hero-card banner the label shrinks to hold the pill within its top-right cap so it
          can't grow left over the wordmark; the fixed overlay variant keeps the plain label. */}
      {banner ? (
        <FitText as="span" size={11} min={0.55} style={{ flex: "0 1 auto", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
          {label}
        </FitText>
      ) : (
        label
      )}
    </button>
  );
}

/** A compact download-tray glyph, swapped for a check once the content is cached. */
function DownloadGlyph({ done }: { done: boolean }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: "block", flex: "none" }}
    >
      {done ? (
        <path d="M5 12.5 10 17.5 19.5 6.5" />
      ) : (
        <>
          <path d="M12 3.5v10.5" />
          <path d="M7.5 10 12 14.5 16.5 10" />
          <path d="M5 20h14" />
        </>
      )}
    </svg>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        color: "var(--muted)",
        fontWeight: 700,
        padding: 24,
      }}
    >
      {children}
    </main>
  );
}
