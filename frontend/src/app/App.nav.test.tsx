// @vitest-environment jsdom
/**
 * App-level navigation contract: the floating bottom nav must be present on the flat screens
 * (Vault / Leaderboard / practice category picker) and ABSENT on the immersive question screens
 * (Contest, Practice while playing). This pins the "menus everywhere except the actual questions"
 * requirement at the App wiring level.
 *
 * Practice is no longer a Home CTA (the Practice Mode card was removed) — it is reached from the
 * settled-result reveal's "Practice" action. The two practice tests drive that real path: a settled
 * result auto-opens the reveal, "Reveal Results" → (reduced motion jumps to the final stage) →
 * "Practice" opens the category picker.
 */
import { cleanup, render, fireEvent, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test mounts the WHOLE App (all providers + bootstrap effects, incl. the LevelUpCelebration
// mastery check on Home landing). Under full-suite CPU contention these heavy integration mounts sit
// just over the 5s default and flake — give them ample headroom (passing runs finish in ~5s, so this
// never slows a green run).
vi.setConfig({ testTimeout: 20000 });

// --- API: stub every endpoint the touched screens call. No open window (keeps Battle simple).
// `history` is a vi.fn so the two practice tests can inject a settled result for that run only. ---
vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    currentContest: () => Promise.resolve({ open_window: null, schedule: [] }),
    myEntry: () => Promise.resolve({ entry_id: null }),
    windowField: () => Promise.resolve({ entries: [] }),
    // Surfaces that show other players read the friend graph to decide whether to offer "add".
    friends: () => Promise.resolve({ friends: [], incoming: [], outgoing: [], rival_user_id: null }),
    history: vi.fn(() => Promise.resolve({ items: [] })),
    vault: () => Promise.resolve({ items: [], coins_balance: 0 }),
    categories: () => Promise.resolve({ categories: [] }),
    contest: () => Promise.resolve({ open_window: null, schedule: [] }),
    // Practice keeps "loading" forever here (never resolves) — we only assert the nav is absent.
    startPractice: () => new Promise(() => {}),
    aiStatus: vi.fn(async () => ({ coverage: 0, ready: false })),
    // The App-shell LevelUpCelebration checks mastery on every Home landing — stub it (no level-ups).
    getMastery: vi.fn(async () => ({ categories: [] })),
    friendsBoard: vi.fn(async () => ({ my_rank: null, friend_field_size: 0, played: [], yet_to_play: [] })),
    createFriendDuel: vi.fn(async () => ({})),
  },
}));

// Session/locale restore are fire-and-forget effects; stub so imports resolve and nothing throws.
vi.mock("@/api/session", () => ({
  restoreSession: () => Promise.resolve(),
  refreshMe: () => Promise.resolve(),
}));
// Offline-play bootstrap side effects (IndexedDB / Capacitor Network) are inert in jsdom — stub the
// network watcher + outbox count so the bootstrap effect doesn't touch indexedDB or native plugins.
// The real useNetwork/useOutbox stores stay (they default online:true / pending:0), so OfflineStatus
// renders nothing and no ranked surface is gated here.
vi.mock("@/store/network", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/network")>()),
  startNetworkWatch: () => () => {},
}));
vi.mock("@/offline/outbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/offline/outbox")>()),
  refreshOutboxCount: () => Promise.resolve(),
}));
// Only stub restoreLocale — keep the real useI18n store so useT() still resolves the dictionary.
vi.mock("@/store/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/i18n")>()),
  restoreLocale: () => Promise.resolve(),
}));
// The results reveal fires audio/haptics on reveal — no-op them under jsdom (no AudioContext).
vi.mock("@/lib/sfx", () => ({
  coinChime: () => {},
  haptic: () => {},
  isSfxEnabled: () => true,
  placementImpact: () => {},
  podiumFanfare: () => {},
  ratingRise: () => {},
  resumeAudio: () => {},
  scoreImpact: () => {},
  setSfxEnabled: () => {},
  uiTap: () => {},
}));

// jsdom has no matchMedia; force prefers-reduced-motion so the reveal jumps straight to its final
// stage (the "Practice" CTA) instead of running the multi-second staged animation.
window.matchMedia = ((query: string) => ({
  matches: /reduced-motion/.test(query),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

import { App } from "./App";
import { api } from "@/api/client";
import { useSessionStore, type Me } from "@/store/session";

const ME: Me = {
  user_id: "u1",
  email: "t@example.com",
  username: "Tester",
  is_guest: false,
  rating: 1200,
  rank: 5,
  total_players: 100,
  division: "Bronze",
  streak_count: 0,
  sharpness: 50,
  coins_balance: 200,
  gems_balance: 0,
  equipped_theme: "royale",
  avatar_preset: "fox",
  equipped_frame: null,
  equipped_badges: [],
  equipped_title: null,
};

// A settled, placed result so the reveal can auto-open (the only path to practice now).
const SETTLED_RESULT = {
  window_id: "w1",
  contest_date: "2026-06-01",
  slot: "royale",
  state: "SETTLED",
  total_score: 100,
  place: 5,
  field_size: 8,
  coins_awarded: 0,
  rating_before: 1200,
  rating_after: 1208,
};

beforeEach(() => {
  useSessionStore.setState({ status: "authenticated", accessToken: "tok", me: ME });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // The hero's "ready" reveal CTA only shows for an UNSEEN result; clear the per-device seen-state
  // (localStorage) so each practice-flow test starts from an unrevealed result.
  localStorage.clear();
});

/**
 * `waitFor` budget for a wait that spans a code-split screen chunk (app/lazyScreens.ts). In the
 * browser these chunks are precompiled files; under vitest each one is transformed on demand the
 * first time it's imported, and 30–50 KB of screen + its dependency tree routinely blows past
 * waitFor's 1000 ms default when the full suite is competing for CPU. This is transform latency, not
 * app latency — the testTimeout above is what actually bounds a hung test.
 */
const CHUNK_WAIT = { timeout: 15000 };

async function renderApp() {
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<App />);
  });
  return utils;
}

/** Drive App from Home into the practice category picker via the settled-result reveal. */
async function openPracticePicker(utils: ReturnType<typeof render>) {
  const { getByText } = utils;
  // A settled, unseen result puts the hero in its "ready" state — its CTA opens the reveal curtain.
  await waitFor(() => getByText("Reveal Your Standing"));
  await act(async () => {
    fireEvent.click(getByText("Reveal Your Standing"));
  });
  await waitFor(() => getByText("Reveal Results"));
  await act(async () => {
    fireEvent.click(getByText("Reveal Results"));
  });
  await waitFor(() => getByText("Practice"), CHUNK_WAIT); // reduced motion → final stage shows the CTA
  await act(async () => {
    fireEvent.click(getByText("Practice"));
  });
}

describe("App nav presence — menus everywhere except the questions", () => {
  it("Home renders the nav (its own BottomNav)", async () => {
    const { getByLabelText } = await renderApp();
    await waitFor(() => getByLabelText("Home"));
  });

  it("Leaderboard shows the nav", async () => {
    const { getByLabelText, getAllByLabelText } = await renderApp();
    await waitFor(() => getByLabelText("Home"));
    // Tap the nav's Leaderboard slot to open the leaderboard screen.
    await act(async () => {
      fireEvent.click(getByLabelText("Leaderboard"));
    });
    // On the leaderboard, the nav is still there — Home is reachable from it — and the Leaderboard
    // slot is the active highlighted item (aria-current=page).
    // The assertion is inside waitFor because the screen is code-split (app/lazyScreens.ts): React
    // keeps Home mounted until the chunk lands, and Home's own nav also carries a "Home" label, so
    // waiting on that label alone would resolve before the swap. The active slot only exists on the
    // destination's AppNav, which makes it the real "we arrived" signal.
    await waitFor(
      () =>
        expect(
          getAllByLabelText("Leaderboard").some((el) => el.getAttribute("aria-current") === "page"),
        ).toBe(true),
      CHUNK_WAIT,
    );
    expect(getByLabelText("Home")).toBeTruthy();
  });

  it("Vault (shop) shows the nav", async () => {
    const { getByLabelText, getAllByLabelText } = await renderApp();
    await waitFor(() => getByLabelText("Vault"));
    await act(async () => {
      fireEvent.click(getByLabelText("Vault"));
    });
    // Same code-split wait as the leaderboard case above: the active Vault slot is the arrival signal.
    await waitFor(
      () =>
        expect(getAllByLabelText("Vault").some((el) => el.getAttribute("aria-current") === "page")).toBe(
          true,
        ),
      CHUNK_WAIT,
    );
    expect(getByLabelText("Home")).toBeTruthy();
  });

  it("Practice category picker shows the nav (active=none, every slot navigates)", async () => {
    vi.mocked(api.history).mockResolvedValueOnce({ items: [SETTLED_RESULT] });
    const utils = await renderApp();
    await openPracticePicker(utils);
    const { getByLabelText, getByText } = utils;
    // Wait for the picker's OWN content: it is code-split, and Home stays mounted until its chunk
    // lands (see the leaderboard case above).
    await waitFor(() => getByText("Mixed"), CHUNK_WAIT);
    // The picker carries the nav — Home/Vault are reachable, nothing is highlighted.
    expect(getByLabelText("Home").getAttribute("aria-current")).toBeNull();
    expect(getByLabelText("Vault").getAttribute("aria-current")).toBeNull();
  });

  it("the questions flow (Practice playing) renders NO nav — immersive", async () => {
    vi.mocked(api.history).mockResolvedValueOnce({ items: [SETTLED_RESULT] });
    const utils = await renderApp();
    await openPracticePicker(utils);
    const { getByText, queryByLabelText } = utils;
    await waitFor(() => getByText("Mixed"), CHUNK_WAIT);
    expect(queryByLabelText("Home")).not.toBeNull(); // nav on the picker
    // picker → playing (the Mixed card starts a session; Practice stays in "Setting up…")
    await act(async () => {
      fireEvent.click(getByText("Mixed"));
    });
    await waitFor(() => getByText("Setting up practice…"), CHUNK_WAIT);
    // No nav over the question flow.
    expect(queryByLabelText("Home")).toBeNull();
    expect(queryByLabelText("Vault")).toBeNull();
  });
});
