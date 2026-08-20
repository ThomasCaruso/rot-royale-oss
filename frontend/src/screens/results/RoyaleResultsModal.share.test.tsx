// @vitest-environment jsdom
/**
 * The Daily-Royale results share MUST carry the `…/c/<id>` challenge link.
 *
 * This is the game's primary acquisition surface: it's the screen every player sees the moment
 * they finish their one daily run. Sharing a bare brag ("I placed #3 of 12 …") gives the recipient
 * nothing to tap, which makes the entire share loop — OG card, landing page, guest play — dead on
 * arrival from the surface that matters most. It shipped that way once; these tests exist so it
 * cannot happen again.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryItem } from "@/api/client";
import type { Me } from "@/store/session";

const myEntry = vi.fn();
const createChallenge = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    myEntry: (...a: unknown[]) => myEntry(...a),
    createChallenge: (...a: unknown[]) => createChallenge(...a),
    // The modal also pulls the standings and the friend graph (to decide whether an add button
    // belongs on each row); irrelevant here, so keep both empty and quiet.
    windowField: () =>
      Promise.resolve({ entries: [], field_size: 0, my_rank: null, my_score: 0, window_id: "w1" }),
    friends: () =>
      Promise.resolve({ friends: [], incoming: [], outgoing: [], rival_user_id: null }),
  },
}));

// Audio/haptics touch browser APIs jsdom doesn't implement.
vi.mock("@/lib/sfx", () => ({
  haptic: () => {},
  isSfxEnabled: () => false,
  placementImpact: () => {},
  podiumFanfare: () => {},
  ratingRise: () => {},
  resumeAudio: () => {},
  scoreImpact: () => {},
  setSfxEnabled: () => {},
  uiTap: () => {},
}));

const CHALLENGE_URL = "https://rotroyale.app/c/aZ3k9x";

const result = (over: Partial<HistoryItem> = {}): HistoryItem => ({
  window_id: "w1",
  contest_date: "2026-06-09",
  slot: "royale",
  state: "SETTLED",
  total_score: 8420,
  place: 3,
  field_size: 12,
  coins_awarded: 0,
  rating_before: 1204,
  rating_after: 1236,
  ...over,
});

const me = {
  user_id: "u1",
  email: "you@example.com",
  username: "You",
  is_guest: false,
} as Me;

let shareSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  myEntry.mockResolvedValue({ entry_id: "e1", status: "SUBMITTED", submitted_at: "now" });
  createChallenge.mockResolvedValue({
    id: "aZ3k9x",
    url: CHALLENGE_URL,
    contest_no: 142,
    score: 8420,
    place: 3,
    field_size: 12,
    percentile: 75,
  });
  shareSpy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "share", { value: shareSpy, configurable: true, writable: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Render, let the link mint, then drive the reveal choreography to the stage that shows the CTAs:
 * the results open behind a curtain, and only after "Reveal Results" do the staged sections land.
 * Tapping the dialog fast-forwards the remaining stages.
 */
async function openAndReveal(expectLink = true) {
  const { RoyaleResultsModal } = await import("@/screens/results/RoyaleResultsModal");
  render(<RoyaleResultsModal result={result()} me={me} onClose={() => {}} onPractice={() => {}} />);
  // Explicit budget: this waits on a CHAIN (myEntry -> createChallenge) plus React effect
  // scheduling, and testing-library's default is only 1000ms. These assert eventual state, not
  // latency, so a generous ceiling costs nothing when it resolves in a few ms — and removes the
  // last timing coupling that made this file intermittently red under a loaded suite run.
  const settle = { timeout: 8000 };
  if (expectLink) {
    await waitFor(() => expect(createChallenge).toHaveBeenCalledWith("e1"), settle);
  } else {
    await waitFor(() => expect(createChallenge).toHaveBeenCalled(), settle);
  }

  fireEvent.click(screen.getByText(/reveal results/i));
  // Wait for the staged reveal to land the CTAs rather than click-fast-forwarding it. The earlier
  // version tapped the dialog three times to skip ahead, which raced the real STAGE_DELAYS timers
  // (650ms/1300ms): fine in isolation, intermittently failing under a loaded full-suite run where
  // the taps landed before `revealed` was true and the button never appeared. The generous timeout
  // costs nothing when it resolves early.
  return screen.findByText(/share result/i, {}, { timeout: 8000 });
}

// Per-test budget for this file. Vitest defaults to 5000ms, and these specs legitimately need
// longer: the results screen plays a staged reveal on real timers (650ms + 1300ms) after an async
// myEntry -> createChallenge chain. The first attempt at fixing the flake set the waitFor budgets
// to 6000ms — LONGER than the test timeout — so under load the wait could never win: it blew the
// 5000ms test budget instead. Budget must exceed the waits, not the other way round.
describe("Daily Royale results — share", { timeout: 20_000 }, () => {
  it("sends the challenge LINK, not just the brag text", async () => {
    const button = await openAndReveal();
    fireEvent.click(button);

    await waitFor(() => expect(shareSpy).toHaveBeenCalled(), { timeout: 8000 });
    const payload = shareSpy.mock.calls[0][0];
    // The url field is what the OS turns into a rich preview…
    expect(payload.url).toBe(CHALLENGE_URL);
    // …and the text carries it too, for targets that drop `url` (SMS, some Android apps).
    expect(payload.text).toContain(CHALLENGE_URL);
    // The brag itself must survive alongside the link.
    expect(payload.text).toMatch(/#3 of 12/);
  });

  it("re-opening the results reuses the same link (createChallenge is idempotent per entry)", async () => {
    await openAndReveal();
    expect(createChallenge).toHaveBeenCalledTimes(1);
    expect(createChallenge).toHaveBeenCalledWith("e1");
  });

  it("still shares the brag when the link can't be minted — never blocks sharing", async () => {
    createChallenge.mockRejectedValue(new Error("rate limited"));
    fireEvent.click(await openAndReveal(false));

    await waitFor(() => expect(shareSpy).toHaveBeenCalled(), { timeout: 8000 });
    const payload = shareSpy.mock.calls[0][0];
    expect(payload.url).toBeUndefined();
    expect(payload.text).toMatch(/#3 of 12/);
  });

  it("does not await anything inside the click handler (iOS Safari gesture requirement)", async () => {
    // If the link were fetched on tap instead of prefetched, `navigator.share` would be called
    // after an await and iOS would refuse to open the sheet. Assert it fires synchronously.
    const button = await openAndReveal();
    fireEvent.click(button);
    expect(shareSpy).toHaveBeenCalledTimes(1); // no `await waitFor` — must already have fired
  });
});
