import { lazy } from "react";
import { HOME_OVERLAY_LOADERS } from "@/screens/home/lazyOverlays";

/**
 * Code-split screen entry points (CLAUDE.md §3 — `src/app` owns shell/routing).
 *
 * Every screen below is reached from a flag in `App.tsx`, never on the cold-start path: the shell
 * boots into Home (or the first-run intro), and everything else is a tap away. Importing them
 * statically put all of them — campaign, leaderboard, duel, vault, friends, the question flows — in
 * the single `main` chunk, so a player downloaded ~645 KB of JS before Home could paint. Each entry
 * here becomes its own chunk that is fetched on first use.
 *
 * Keep the shell's OWN pieces (Home, AppNav, OfflineStatus, LevelUpCelebration) statically imported:
 * they render on the first frame, so splitting them would only add a round trip.
 *
 * Named exports need the `{ default }` shim because `React.lazy` resolves a module's default export;
 * this repo exports components by name. Loaders are also reused by `warmScreens()` below, so a
 * warmed chunk and a rendered chunk are the same module request (the browser + module registry
 * dedupe it).
 */

const loadCampaign = () => import("@/screens/campaign/Campaign");
const loadCognitionPlaytest = () => import("@/screens/dev/CognitionPlaytest");
const loadCategorySelect = () => import("@/screens/CategorySelect");
const loadChallengeLanding = () => import("@/screens/challenge/ChallengeLanding");
const loadContest = () => import("@/screens/Contest");
const loadDuelFlow = () => import("@/screens/duel/DuelFlow");
const loadFirstRun = () => import("@/screens/brainboost/FirstRun");
const loadFriendsScreen = () => import("@/screens/friends/FriendsScreen");
const loadGrowthScreen = () => import("@/screens/growth/GrowthScreen");
const loadLeaderboardScreen = () => import("@/screens/leaderboard/LeaderboardScreen");
const loadPractice = () => import("@/screens/Practice");
const loadVaultScreen = () => import("@/screens/vault/VaultScreen");

export const Campaign = lazy(() => loadCampaign().then((m) => ({ default: m.Campaign })));
export const CognitionPlaytest = lazy(() =>
  loadCognitionPlaytest().then((m) => ({ default: m.CognitionPlaytest })),
);
export const CategorySelect = lazy(() =>
  loadCategorySelect().then((m) => ({ default: m.CategorySelect })),
);
export const ChallengeLanding = lazy(() =>
  loadChallengeLanding().then((m) => ({ default: m.ChallengeLanding })),
);
export const Contest = lazy(() => loadContest().then((m) => ({ default: m.Contest })));
export const DuelFlow = lazy(() => loadDuelFlow().then((m) => ({ default: m.DuelFlow })));
export const FirstRun = lazy(() => loadFirstRun().then((m) => ({ default: m.FirstRun })));
export const FriendsScreen = lazy(() =>
  loadFriendsScreen().then((m) => ({ default: m.FriendsScreen })),
);
export const GrowthScreen = lazy(() => loadGrowthScreen().then((m) => ({ default: m.GrowthScreen })));
export const LeaderboardScreen = lazy(() =>
  loadLeaderboardScreen().then((m) => ({ default: m.LeaderboardScreen })),
);
export const Practice = lazy(() => loadPractice().then((m) => ({ default: m.Practice })));
export const VaultScreen = lazy(() => loadVaultScreen().then((m) => ({ default: m.VaultScreen })));

/**
 * Fetch the screen chunks once the shell is IDLE, so the first tap after a cold start doesn't wait
 * on a network round trip.
 *
 * This is what keeps the split honest: splitting moves these bytes off the critical path (nothing
 * here blocks Home's first paint), it does not mean the player pays a stall later. React keeps the
 * current screen on-screen while a lazy chunk loads, so an un-warmed tap on a slow connection reads
 * as a dead button — warming removes that. It costs nothing extra in practice: the service worker
 * already precaches every built JS asset on install (vite.config.ts `globPatterns`), so these
 * requests are the same ones it would make, just earlier and de-duplicated by the browser cache.
 *
 * Ordered by how soon a player is likely to need it. Rejections are swallowed on purpose: a warm
 * that fails offline is a no-op, and the real render retries the import and surfaces the error.
 */
const WARM_ORDER = [
  loadContest, // the centre Play button — the primary action
  ...HOME_OVERLAY_LOADERS, // reachable from Home without leaving it
  loadCampaign,
  loadLeaderboardScreen,
  loadVaultScreen,
  loadGrowthScreen,
  loadDuelFlow,
  loadFriendsScreen,
  loadCategorySelect,
  loadPractice,
];

export function warmScreens(): () => void {
  if (typeof window === "undefined") return () => {};
  const warm = () => {
    for (const load of WARM_ORDER) void load().catch(() => {});
  };
  // requestIdleCallback isn't in Safari <17 (a real share of the iOS install base) — fall back to a
  // timeout that lands well after first paint.
  const ric = window.requestIdleCallback;
  if (typeof ric === "function") {
    const handle = ric(warm, { timeout: 4000 });
    return () => window.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(warm, 2000);
  return () => window.clearTimeout(handle);
}
