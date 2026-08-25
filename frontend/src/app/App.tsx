import { Suspense, useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import {
  completeGoogleHandoff,
  recoverSessionIfNeeded,
  restoreSession,
  startGuest,
} from "@/api/session";
import { trackFunnel } from "@/lib/analytics";
import { takeGoogleReturn } from "@/lib/googleReturn";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import { loadStarterDone, markStarterDone, resolveFirstRunStep } from "@/lib/firstRun";
import { restoreLocale, useI18n } from "@/store/i18n";
import { Home } from "@/screens/Home";
import { AppNav } from "@/screens/home/AppNav";
import { LevelUpCelebration } from "@/screens/growth/LevelUpCelebration";
import {
  Campaign,
  CategorySelect,
  ChallengeLanding,
  CognitionPlaytest,
  Contest,
  DuelFlow,
  FirstRun,
  FriendsScreen,
  GrowthScreen,
  LeaderboardScreen,
  Practice,
  VaultScreen,
  warmScreens,
} from "@/app/lazyScreens";
import { useSessionStore } from "@/store/session";
import { DEFAULT_THEME_ID, getTheme } from "@/theme/tokens";
import { Starfield } from "@/ui/Starfield";
import { startNetworkWatch, useNetwork } from "@/store/network";
import { refreshOutboxCount } from "@/offline/outbox";
import { onReconnect, onForegroundDrain } from "@/app/reconnect";
import { requiresOnline, type Surface } from "@/app/offlineGate";
import { useAndroidBackButton } from "@/app/useAndroidBackButton";
import { PromptHost } from "@/screens/prompts/PromptHost";
import { reportTimezone } from "@/lib/reportTimezone";
import { primeProvisionalPush } from "@/lib/push";
import { OfflineStatus } from "@/app/OfflineStatus";
import { OnlineRequired } from "@/app/OnlineRequired";

/**
 * App shell. Applies the equipped theme's CSS variables + art-style class, and gates first render
 * on session restore so a cold start never flashes the login screen before /auth/refresh resolves.
 */
export function App() {
  const status = useSessionStore((s) => s.status);
  const equippedTheme = useSessionStore((s) => s.me?.equipped_theme);
  const isGuest = useSessionStore((s) => s.me?.is_guest ?? false);
  const userId = useSessionStore((s) => s.me?.user_id);
  const provisionalPush = useSessionStore((s) => s.me?.provisional_push ?? false);
  const localeReady = useI18n((s) => s.ready);
  // First-run (Daily Royale intro) gate: null while the device flag is loading.
  const [starterDone, setStarterDone] = useState<boolean | null>(null);
  // Viral share loop: a `…/c/<id>` link lands here as `/?c=<id>`. When present, the challenge
  // landing takes over BEFORE the Brain Boost first-run — the visitor sees the sharer's result and
  // jumps straight into today's Daily Royale (as a guest if anonymous). Read once from the URL.
  const [challengeId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("c"),
  );
  const [challengeConsumed, setChallengeConsumed] = useState(false);
  const [contestWindowId, setContestWindowId] = useState<string | null>(null);
  const [practiceFlow, setPracticeFlow] = useState<"off" | "select" | "playing">("off");
  const [practiceCategory, setPracticeCategory] = useState<string | null>(null); // null = mixed
  // "quick" = Quick Play (the centre-Play fallback once today's Royale is done): an 8-question
  // mixed-category trivia run on the practice path — never ranked, never wagered.
  const [practiceMode, setPracticeMode] = useState<"quick" | null>(null);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [growthOpen, setGrowthOpen] = useState(false);
  const [duelOpen, setDuelOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [playtestOpen, setPlaytestOpen] = useState(false);
  // Level-up celebration trigger: bumped whenever Home becomes the active view (initial authenticated
  // mount + every return to Home after a play flow), so the shell re-checks /me/mastery for a fresh
  // level-up right after the player finishes a session. Not a timer — one check per Home landing.
  const [levelUpCheck, setLevelUpCheck] = useState(0);
  // The equipped theme drives the skin once known; royale is the default before/without a session.
  const theme = getTheme(equippedTheme ?? DEFAULT_THEME_ID);

  useEffect(() => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.vars)) {
      root.style.setProperty(key, value);
    }
  }, [theme]);

  const online = useNetwork((s) => s.online);

  // Report the device's zone once we have a session — evening pushes are scheduled from it.
  useEffect(() => {
    if (status === "authenticated") reportTimezone();
  }, [status]);

  // Quiet-push rollout: only for players the SERVER puts in the cohort, so the blast radius is a
  // setting rather than a release. Registers a provisional token — reach, not consent, so the
  // upgrade prompt still fires later.
  useEffect(() => {
    if (status === "authenticated" && provisionalPush) void primeProvisionalPush();
  }, [status, provisionalPush]);

  useEffect(() => {
    void restoreLocale();
    // Returning from Google's redirect REPLACES the ordinary cold-start restore rather than racing
    // it. Both resolve the session, and running them together is a real bug rather than belt and
    // braces: the restore finds no persisted token (this browser was never signed in), calls
    // setAnonymous, and — landing after the handoff has already established the session — signs the
    // player straight back out at the moment they succeeded. Exactly one of these two runs.
    const ret = takeGoogleReturn();
    if (ret.kind === "handoff") {
      void completeGoogleHandoff(ret.code).catch(() => {
        // A spent, expired or unknown code. Nothing to recover, so fall back to the normal path and
        // let the front door say so; the player taps the tile again.
        useSessionStore.getState().setAuthFailed(true);
        void restoreSession();
      });
    } else {
      if (ret.kind === "error") useSessionStore.getState().setAuthFailed(true);
      void restoreSession();
    }
    void loadStarterDone().then(setStarterDone);
    // Offline play wiring: watch real connectivity, prime the outbox count, drain queued results on
    // reconnect (offline→online) and on app foreground, and re-pull the offline content bundle.
    const stopNetworkWatch = startNetworkWatch();
    void refreshOutboxCount();
    // Pre-fetch the one-tap-from-Home screen chunks once the shell is idle (see lazyScreens.ts).
    const stopWarm = warmScreens();
    let wasOnline = useNetwork.getState().online;
    const unsubscribe = useNetwork.subscribe((s) => {
      if (s.online && !wasOnline) {
        onReconnect(); // false → true edge only
        void recoverSessionIfNeeded();
      }
      wasOnline = s.online;
    });
    const onVisible = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible" &&
        useNetwork.getState().online
      ) {
        onForegroundDrain();
        void recoverSessionIfNeeded();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      stopNetworkWatch();
      stopWarm();
      unsubscribe();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, []);

  // Single point that clears every navigable overlay/flow. Nav intents close everything first, then
  // set their one target — so the floating nav can jump straight between Vault/Leaderboard/picker
  // without leaving a stale overlay flag set. The immersive question screens (Contest, Practice
  // playing, CampaignPlay) are reached via their own flows, never the App-level nav.
  function closeAllOverlays() {
    setVaultOpen(false);
    setGrowthOpen(false);
    setLeaderboardOpen(false);
    setCampaignOpen(false);
    setDuelOpen(false);
    setFriendsOpen(false);
    setPlaytestOpen(false);
    setPracticeFlow("off");
    setPracticeMode(null);
    setContestWindowId(null);
  }
  const goHome = () => closeAllOverlays();

  // Android BACK: close one layer at a time, topmost first. The order mirrors what's visually on
  // top, so back always dismisses the thing the player is actually looking at. Returns false when
  // nothing was open, which tells the handler it's at the root and may exit.
  const closeTopOverlay = useCallback((): boolean => {
    if (practiceFlow === "select") {
      setPracticeFlow("off");
      setPracticeMode(null);
      return true;
    }
    for (const [isOpen, close] of [
      [playtestOpen, () => setPlaytestOpen(false)],
      [duelOpen, () => setDuelOpen(false)],
      [friendsOpen, () => setFriendsOpen(false)],
      [growthOpen, () => setGrowthOpen(false)],
      [vaultOpen, () => setVaultOpen(false)],
      [leaderboardOpen, () => setLeaderboardOpen(false)],
      [campaignOpen, () => setCampaignOpen(false)],
    ] as const) {
      if (isOpen) {
        close();
        return true;
      }
    }
    return false;
  }, [
    practiceFlow,
    playtestOpen,
    duelOpen,
    friendsOpen,
    growthOpen,
    vaultOpen,
    leaderboardOpen,
    campaignOpen,
  ]);

  // A scored run is on screen — back must not drop out of it and burn the day's one attempt.
  const inImmersiveRun = contestWindowId !== null || practiceFlow === "playing";
  useAndroidBackButton({ inImmersiveRun, closeTopOverlay });
  const goCampaign = () => {
    closeAllOverlays();
    setCampaignOpen(true);
  };
  const goLeaderboard = () => {
    closeAllOverlays();
    setLeaderboardOpen(true);
  };
  const goVault = () => {
    closeAllOverlays();
    setVaultOpen(true);
  };
  const goGrowth = () => {
    closeAllOverlays();
    setGrowthOpen(true);
  };
  const goDuel = () => {
    closeAllOverlays();
    setDuelOpen(true);
  };
  const goFriends = () => {
    closeAllOverlays();
    setFriendsOpen(true);
  };
  const goPlay = (windowId: string) => {
    closeAllOverlays();
    setContestWindowId(windowId);
  };
  // Challenge landing → play today's Daily Royale. An anonymous visitor becomes a guest first (one
  // tap, no signup); a challenge visitor skips the Brain Boost first-run and goes straight to the
  // ranked daily. Clean `?c=` off the URL so a refresh doesn't relaunch the landing.
  const startChallenge = async (windowId: string) => {
    if (status !== "authenticated") await startGuest();
    void markStarterDone();
    setStarterDone(true);
    setChallengeConsumed(true);
    if (typeof window !== "undefined" && window.history?.replaceState) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    goPlay(windowId);
  };
  // First-run intro CTA → play today's real ranked Daily Royale (same destination as the share loop,
  // but the window is discovered from the current contest since there's no challenge link to carry
  // it). Become a guest first (one silent tap, no signup); the save-account moment comes AFTER the
  // run at the Daily Royale finish (RankedSaveGate). If no daily is open right now, marking first-run
  // done drops the (now-created) guest onto Home, where the hero shows the next Daily Royale.
  const startDailyFromIntro = async () => {
    if (status !== "authenticated") {
      await startGuest();
      trackFunnel("guest_created");
    }
    let windowId: string | null = null;
    try {
      windowId = (await api.currentContest()).open_window?.id ?? null;
    } catch {
      windowId = null; // best-effort: fall through to Home below
    }
    void markStarterDone();
    setStarterDone(true);
    if (windowId) goPlay(windowId);
  };
  // Quick Play: the centre Play button's destination once today's Daily Royale attempt is used up.
  const goQuickPlay = () => {
    closeAllOverlays();
    setPracticeCategory(null);
    setPracticeMode("quick");
    setPracticeFlow("playing");
  };

  // Map the overlay/flow flags to a single logical Surface, in the same precedence order the view
  // switch below resolves them. Used to gate ranked/social surfaces when offline.
  function currentSurface(): Surface {
    if (playtestOpen) return "playtest";
    if (friendsOpen) return "friends";
    if (duelOpen) return "duel";
    if (vaultOpen) return "vault";
    if (growthOpen) return "growth";
    if (leaderboardOpen) return "leaderboard";
    if (campaignOpen) return "campaign";
    if (practiceFlow === "select") return "category";
    if (practiceFlow === "playing") return "practice";
    if (contestWindowId) return "contest";
    return "home";
  }

  // Detect the transition INTO the Home view (and the initial authenticated landing): bump the
  // level-up check so the shell celebration re-reads mastery right after a play flow returns Home.
  const onHome = status === "authenticated" && currentSurface() === "home";
  useEffect(() => {
    if (onHome) setLevelUpCheck((n) => n + 1);
  }, [onHome]);

  function authenticatedView() {
    // Offline gate: a ranked/social surface can't run without the server — show a calm "back online"
    // panel instead. `goHome` clears every overlay, dropping the user onto the offline-OK Home.
    if (!online && requiresOnline(currentSurface())) {
      return <OnlineRequired onBack={goHome} />;
    }
    if (playtestOpen) {
      return <CognitionPlaytest onBack={goHome} />;
    }
    if (friendsOpen) {
      return (
        <FriendsScreen
          onBack={goHome}
          onCampaign={goCampaign}
          onLeaderboard={goLeaderboard}
          onVault={goVault}
          onPlayWindow={goPlay}
          onQuickPlay={goQuickPlay}
        />
      );
    }
    if (duelOpen) {
      return (
        <DuelFlow
          onExit={goHome}
          onCampaign={goCampaign}
          onLeaderboard={goLeaderboard}
          onVault={goVault}
          onPlay={goPlay}
          onQuickPlay={goQuickPlay}
        />
      );
    }
    if (vaultOpen) {
      return (
        <>
          <VaultScreen onBack={goHome} />
          <AppNav
            active="vault"
            onHome={goHome}
            onCampaign={goCampaign}
            onLeaderboard={goLeaderboard}
            onPlayWindow={goPlay}
            onQuickPlay={goQuickPlay}
          />
        </>
      );
    }
    if (growthOpen) {
      return (
        <>
          <GrowthScreen
            onBack={goHome}
            onTrainCategory={(category) => {
              closeAllOverlays();
              setPracticeCategory(category);
              setPracticeMode(null);
              setPracticeFlow("playing");
            }}
          />
          <AppNav
            active="none"
            onHome={goHome}
            onCampaign={goCampaign}
            onLeaderboard={goLeaderboard}
            onVault={goVault}
            onPlayWindow={goPlay}
            onQuickPlay={goQuickPlay}
          />
        </>
      );
    }
    if (leaderboardOpen) {
      return (
        <>
          <LeaderboardScreen onBack={goHome} onVault={goVault} />
          <AppNav
            active="leaderboard"
            onHome={goHome}
            onCampaign={goCampaign}
            onVault={goVault}
            onPlayWindow={goPlay}
            onQuickPlay={goQuickPlay}
          />
        </>
      );
    }
    if (campaignOpen) {
      return (
        <Campaign
          onExit={() => setCampaignOpen(false)}
          onPlay={(windowId) => {
            setCampaignOpen(false);
            setContestWindowId(windowId);
          }}
          onQuickPlay={goQuickPlay}
          onPractice={(category) => {
            setCampaignOpen(false);
            setPracticeCategory(category);
            setPracticeMode(null);
            setPracticeFlow("playing");
          }}
          onLeaderboard={() => {
            setCampaignOpen(false);
            setLeaderboardOpen(true);
          }}
          onVault={() => {
            setCampaignOpen(false);
            setVaultOpen(true);
          }}
        />
      );
    }
    if (practiceFlow === "select") {
      return (
        <>
          <CategorySelect
            onPick={(category) => {
              setPracticeCategory(category);
              setPracticeMode(null);
              setPracticeFlow("playing");
            }}
            onBack={() => setPracticeFlow("off")}
          />
          <AppNav
            active="none"
            onHome={goHome}
            onCampaign={goCampaign}
            onLeaderboard={goLeaderboard}
            onVault={goVault}
            onPlayWindow={goPlay}
            onQuickPlay={goQuickPlay}
          />
        </>
      );
    }
    if (practiceFlow === "playing") {
      return (
        <Practice
          category={practiceCategory}
          mode={practiceMode}
          onExit={() => setPracticeFlow("off")}
        />
      );
    }
    if (contestWindowId) {
      return (
        <Contest
          windowId={contestWindowId}
          onExit={() => setContestWindowId(null)}
          onPractice={() => {
            setContestWindowId(null);
            setPracticeCategory(null);
            setPracticeFlow("select");
          }}
        />
      );
    }
    return (
      <Home
        onPlay={setContestWindowId}
        onQuickPlay={goQuickPlay}
        onPractice={() => setPracticeFlow("select")}
        onTrainCategory={(category) => {
          closeAllOverlays();
          setPracticeCategory(category);
          setPracticeMode(null);
          setPracticeFlow("playing");
        }}
        onCampaign={() => setCampaignOpen(true)}
        onGrowth={goGrowth}
        onLeaderboard={() => setLeaderboardOpen(true)}
        onVault={() => setVaultOpen(true)}
        onDuel={goDuel}
        onFriends={goFriends}
        onPlaytest={() => setPlaytestOpen(true)}
      />
    );
  }

  return (
    <div className={`rr-root s-${theme.style}`}>
      <Starfield />
      {/* Offline banner + sync chip, visible across every screen. */}
      <OfflineStatus />
      {/* Authenticated language switching lives in the ProfileMenu; the floating selector only
          serves unauthenticated screens (login/signup) and the bootstrapping splash. */}
      {status !== "authenticated" && <LanguageSelector />}
      {/* One-time prompts (notifications opt-in, rating ask, the outage apology). Checked when the
          player lands back OUT of a run — never during one, and never on first open: the server
          holds the timing rules so they can be retuned without an App Store release. */}
      {status === "authenticated" && <PromptHost active={!inImmersiveRun} />}
      {/* Mobile app shell: on a wide desktop window the whole app stays a centered ~430px column so
          the layout always reads as the phone build (QA target 416×896). */}
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 430, margin: "0 auto" }}>
        {/* One boundary for every code-split screen (lazyScreens.ts). It sits INSIDE the themed
            column so the background, offline banner and theme vars stay painted while a chunk
            arrives — the swap reads as the screen loading, not as the app blanking. */}
        <Suspense fallback={<ScreenFallback />}>
        {(() => {
          // `localeReady` is false only while the code-split dictionary for a non-English locale is
          // in flight (store/i18n.ts) — holding the splash there avoids one English frame.
          if (status === "bootstrapping" || starterDone === null || !localeReady) return <Splash />;
          // Share loop: a `/?c=<id>` visitor sees the sharer's result + plays today's daily first —
          // ahead of the Brain Boost first-run — so the recruit lands straight in the game.
          if (challengeId && !challengeConsumed) {
            return (
              <ChallengeLanding
                challengeId={challengeId}
                onPlay={startChallenge}
                onSkip={() => setChallengeConsumed(true)}
              />
            );
          }
          // No signup wall: a brand-new visitor gets the Daily Royale intro — one tap drops them
          // straight into today's ranked daily as a guest, with a log-in link for returning players.
          // Registered accounts and guests past first-run go straight to the app.
          const firstRun = resolveFirstRunStep(status, isGuest, starterDone);
          if (firstRun !== "none") {
            return <FirstRun onPlayDaily={startDailyFromIntro} />;
          }
          return (
            <>
              {authenticatedView()}
              {/* Single owner of the category level-up celebration — fires right after play (on the
                  Home landing), overlaying whatever screen. */}
              {userId && <LevelUpCelebration userId={userId} trigger={levelUpCheck} />}
            </>
          );
        })()}
        </Suspense>
      </div>
    </div>
  );
}

/** Held while a screen chunk downloads. Deliberately empty — a spinner or a word that flashes for
 *  ~100ms (or 0ms, cached) is more noticeable than nothing. Keeps the column's height so the
 *  starfield/backdrop don't reflow. */
function ScreenFallback() {
  return <div aria-busy="true" style={{ minHeight: "100dvh" }} />;
}

function Splash() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        color: "var(--muted)",
        fontFamily: "Fredoka, sans-serif",
      }}
    >
      Rot Royale…
    </main>
  );
}
