// @vitest-environment jsdom
/**
 * Home Daily Royale state-machine flow tests (jsdom + @testing-library/react). Same mock pattern as
 * IdentityEditor.flow.test.tsx: hoisted api/store mocks, English dictionary via the real useT.
 *
 * Asserts the hero renders the correct A–F state from mocked currentContest (royale window state +
 * settle_at) + entry/history/seen, and that the reveal CTA (E) opens the results modal. The phase
 * DECISION is unit-tested in home.test.ts; here we verify the screen wires data → the right hero copy.
 */
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentContest, HistoryItem, WindowOut } from "@/api/client";

// jsdom has no matchMedia; the DuelCard (Home #2) calls useReducedMotion. Stub a non-reduced result.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const {
  mockMe,
  mockCurrentContest,
  mockHistory,
  mockMyEntry,
  mockWindowField,
  mockRotReport,
  mockHasSeenResult,
  mockMarkResultSeen,
} = vi.hoisted(() => ({
  mockMe: {
    user_id: "u1",
    email: "you@example.com",
    username: "You",
    is_guest: false,
    rating: 1200,
    rank: 4,
    total_players: 50,
    division: "gold",
    streak_count: 1,
    sharpness: 40,
    coins_balance: 300,
    gems_balance: 0,
    equipped_theme: "royale",
    avatar_preset: "ninja",
    equipped_frame: null as string | null,
    equipped_badges: [] as string[],
    equipped_title: null as string | null,
  },
  mockCurrentContest: vi.fn(),
  mockHistory: vi.fn(),
  mockMyEntry: vi.fn(),
  mockWindowField: vi.fn(),
  mockRotReport: vi.fn(),
  mockHasSeenResult: vi.fn(),
  mockMarkResultSeen: vi.fn(),
}));

vi.mock("@/store/session", () => {
  function useSessionStore(selector: (s: unknown) => unknown) {
    return selector({ me: mockMe });
  }
  useSessionStore.getState = () => ({ me: mockMe });
  return { useSessionStore };
});

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    currentContest: (...a: unknown[]) => mockCurrentContest(...a),
    history: (...a: unknown[]) => mockHistory(...a),
    myEntry: (...a: unknown[]) => mockMyEntry(...a),
    windowField: (...a: unknown[]) => mockWindowField(...a),
    rotReport: (...a: unknown[]) => mockRotReport(...a),
    aiStatus: vi.fn(async () => ({ coverage: 0, ready: false })),
    friendsBoard: vi.fn(async () => ({ my_rank: null, friend_field_size: 0, played: [], yet_to_play: [] })),
    createFriendDuel: vi.fn(async () => ({})),
  },
}));

vi.mock("@/lib/seenResults", () => ({
  hasSeenResult: (...a: unknown[]) => mockHasSeenResult(...a),
  markResultSeen: (...a: unknown[]) => mockMarkResultSeen(...a),
}));

// SFX is a no-op in tests (no AudioContext in jsdom).
vi.mock("@/lib/sfx", () => ({ resumeAudio: vi.fn() }));

// The results reveal has its own suite (RoyaleResultsModal.test.tsx) and pulls in audio/canvas; here
// we only care that the hero's state-E CTA (and the ResultStrip) MOUNT it. Stub it to a marker.
vi.mock("@/screens/results/RoyaleResultsModal", () => ({
  RoyaleResultsModal: () => <div data-testid="results-modal">results modal</div>,
}));

import { Home } from "@/screens/Home";

// Window times are anchored to the REAL current time so phases resolve without faking the clock
// (fake timers would also stall RTL's async findBy* polling). The instants only need to be on the
// right side of now for each state; we don't assert exact countdown strings.
const HOUR = 3600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

/**
 * A royale window in `state`. By default it's the live event (opened 4h ago, closes in 8h, settles
 * 15m after close) so OPEN/CLOSED phases land correctly. CLOSED/SETTLED callers shift it into the
 * past via overrides.
 */
function royale(state: string, over: Partial<WindowOut> = {}): WindowOut {
  return {
    id: "rw1",
    slot: "royale",
    state,
    open_at: iso(-4 * HOUR),
    close_at: iso(8 * HOUR),
    settle_at: iso(8 * HOUR + 15 * 60_000),
    entry_count: 8,
    ...over,
  };
}

/** A CLOSED royale before settle_at: closed 5m ago, settles in 10m → state D (settling). */
function settlingRoyale(): WindowOut {
  return royale("CLOSED", { close_at: iso(-5 * 60_000), settle_at: iso(10 * 60_000) });
}

/** A SETTLED royale fully in the past (closed + settled hours ago). */
function settledRoyale(): WindowOut {
  return royale("SETTLED", { open_at: iso(-12 * HOUR), close_at: iso(-2 * HOUR), settle_at: iso(-2 * HOUR + 15 * 60_000) });
}

/** Tomorrow's royale — SCHEDULED, opens in 12h. */
function nextRoyale(): WindowOut {
  return {
    id: "rw2",
    slot: "royale",
    state: "SCHEDULED",
    open_at: iso(12 * HOUR),
    close_at: iso(24 * HOUR),
    settle_at: iso(24 * HOUR + 15 * 60_000),
    entry_count: 0,
  };
}

function settledResult(over: Partial<HistoryItem> = {}): HistoryItem {
  return {
    window_id: "rw1",
    contest_date: "2026-06-10",
    slot: "royale",
    state: "SETTLED",
    total_score: 4200,
    place: 3,
    field_size: 12,
    coins_awarded: 0,
    rating_before: 1180,
    rating_after: 1200,
    ...over,
  };
}

const noop = () => {};

function renderHome() {
  return render(
    <Home
      onPlay={noop}
      onQuickPlay={noop}
      onPractice={noop}
      onTrainCategory={noop}
      onCampaign={noop}
      onGrowth={noop}
      onLeaderboard={noop}
      onVault={noop}
      onDuel={noop}
      onFriends={noop}
     
    />,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockHistory.mockResolvedValue({ items: [] });
  mockMyEntry.mockResolvedValue({ entry_id: null, status: null, submitted_at: null });
  mockWindowField.mockResolvedValue({ entries: [] });
  // Default: no server-rebuilt report available (the completed row then relies on the local stash).
  mockRotReport.mockRejectedValue(new Error("no report"));
  mockHasSeenResult.mockReturnValue(false);
  localStorage.clear();
});

describe("Home — Daily Royale hero state machine", () => {
  it("A before: a scheduled royale, none open → 'unlocks at' + Daily Royale, no Enter CTA", async () => {
    mockCurrentContest.mockResolvedValue({ open_window: null, schedule: [nextRoyale()] } as CurrentContest);
    const { findByText, queryByText } = renderHome();
    await findByText("DAILY"); // the title is a two-tone DAILY / ROYALE split
    await findByText(/Today's Royale unlocks at/);
    expect(queryByText("ENTER DAILY ROYALE")).toBeNull();
  });

  it("B live: OPEN, not entered → Enter CTA + one-shot line + field of N + Open now", async () => {
    mockCurrentContest.mockResolvedValue({ open_window: royale("OPEN"), schedule: [royale("OPEN")] } as CurrentContest);
    mockWindowField.mockResolvedValue({
      entries: [{ username: "Rival", points: [100, 100], avatar_preset: "fox", equipped_frame: null, equipped_badges: [], equipped_title: null }],
    });
    const onPlay = vi.fn();
    const { findByText, getByText } = render(
      <Home onPlay={onPlay} onQuickPlay={noop} onPractice={noop} onTrainCategory={noop} onCampaign={noop} onGrowth={noop} onLeaderboard={noop} onVault={noop} onDuel={noop} onFriends={noop} />,
    );
    await findByText("ENTER DAILY ROYALE");
    // The brand tagline sits under the title; its gold tail ("One crown.") renders as its own span.
    expect(getByText("One crown.")).toBeTruthy();
    // Field label splits the leading count (gold number) from the label into separate spans.
    await waitFor(() => expect(getByText("players")).toBeTruthy());
    expect(getByText("Open now")).toBeTruthy();
    fireEvent.click(getByText("ENTER DAILY ROYALE"));
    expect(onPlay).toHaveBeenCalledWith("rw1");
  });

  it("C locked: OPEN + entered → Score Locked + provisional rank + 'field still moving', no CTA", async () => {
    mockCurrentContest.mockResolvedValue({ open_window: royale("OPEN"), schedule: [royale("OPEN")] } as CurrentContest);
    mockMyEntry.mockResolvedValue({ entry_id: "e1", status: "SUBMITTED", submitted_at: "x" });
    mockWindowField.mockResolvedValue({
      entries: [
        { username: "You", points: [200, 200], avatar_preset: "ninja", equipped_frame: null, equipped_badges: [], equipped_title: null },
        { username: "Rival", points: [50, 50], avatar_preset: "fox", equipped_frame: null, equipped_badges: [], equipped_title: null },
      ],
    });
    const { findByText, getByText, queryByText } = renderHome();
    await findByText("SCORE LOCKED");
    await waitFor(() => expect(getByText("400 points banked")).toBeTruthy());
    expect(getByText(/The field is still moving/)).toBeTruthy();
    expect(queryByText("ENTER DAILY ROYALE")).toBeNull();
  });

  it("D settling: CLOSED before settle_at → Field Closed + Results settling + settle time, no CTA", async () => {
    mockCurrentContest.mockResolvedValue({ open_window: null, schedule: [settlingRoyale()] } as CurrentContest);
    const { findByText, getByText, queryByText } = renderHome();
    await findByText("FIELD CLOSED");
    expect(getByText("Results settling")).toBeTruthy();
    // The settle time is rendered (not a computed-but-dead prop): "Settles at {time}".
    expect(getByText(/Settles at/)).toBeTruthy();
    expect(queryByText("ENTER DAILY ROYALE")).toBeNull();
    expect(queryByText("Reveal Your Standing")).toBeNull();
  });

  it("E ready: SETTLED + unseen result → Results Ready + Reveal CTA, which opens the modal", async () => {
    mockCurrentContest.mockResolvedValue({ open_window: null, schedule: [settledRoyale(), nextRoyale()] } as CurrentContest);
    mockHistory.mockResolvedValue({ items: [settledResult()] });
    mockHasSeenResult.mockReturnValue(false);
    const { findByText, getByText, queryByText, findByTestId } = renderHome();
    await findByText("RESULTS READY");
    // State E has its OWN subline (not the onboarding one-shot line meant for pre-play).
    expect(getByText("Your final standing is in.")).toBeTruthy();
    expect(queryByText(/One attempt\. One field\. Results at /)).toBeNull();
    fireEvent.click(getByText("Reveal Your Standing"));
    // The reveal modal mounts (stubbed marker).
    await findByTestId("results-modal");
  });

  it("F viewed: SETTLED + seen result → summary rank + tomorrow unlocks, no Reveal CTA", async () => {
    mockCurrentContest.mockResolvedValue({ open_window: null, schedule: [settledRoyale(), nextRoyale()] } as CurrentContest);
    mockHistory.mockResolvedValue({ items: [settledResult({ place: 2 })] });
    mockHasSeenResult.mockReturnValue(true); // already seen → no auto-reveal, phase F
    const { findByText, queryByText, container } = renderHome();
    await findByText(/Tomorrow's Royale unlocks at/);
    expect(queryByText("Reveal Your Standing")).toBeNull();
    // The summary surfaces the placement as calm subtitle copy ("Finished #2") — never as a giant
    // rank number (the card's layout stays identical across states).
    expect(container.textContent).toContain("Finished #2");
  });

  it("centre Play: routes to the open royale before entry, to Quick Play once the score is locked", async () => {
    // B live, not entered → the nav's Play enters the royale window.
    mockCurrentContest.mockResolvedValue({ open_window: royale("OPEN"), schedule: [royale("OPEN")] } as CurrentContest);
    const onPlay = vi.fn();
    const onQuickPlay = vi.fn();
    const live = render(
      <Home onPlay={onPlay} onQuickPlay={onQuickPlay} onPractice={noop} onTrainCategory={noop} onCampaign={noop} onGrowth={noop} onLeaderboard={noop} onVault={noop} onDuel={noop} onFriends={noop} />,
    );
    await live.findByLabelText("Play the open game");
    fireEvent.click(live.getByLabelText("Play the open game"));
    expect(onPlay).toHaveBeenCalledWith("rw1");
    expect(onQuickPlay).not.toHaveBeenCalled();
    cleanup();
    vi.clearAllMocks();

    // C locked (entered) → the nav's Play becomes Quick Play (the no-stakes mixed trivia loop).
    mockCurrentContest.mockResolvedValue({ open_window: royale("OPEN"), schedule: [royale("OPEN")] } as CurrentContest);
    mockMyEntry.mockResolvedValue({ entry_id: "e1", status: "SUBMITTED", submitted_at: "x" });
    mockWindowField.mockResolvedValue({ entries: [] });
    mockHistory.mockResolvedValue({ items: [] });
    mockHasSeenResult.mockReturnValue(false);
    const onPlay2 = vi.fn();
    const onQuickPlay2 = vi.fn();
    const locked = render(
      <Home onPlay={onPlay2} onQuickPlay={onQuickPlay2} onPractice={noop} onTrainCategory={noop} onCampaign={noop} onGrowth={noop} onLeaderboard={noop} onVault={noop} onDuel={noop} onFriends={noop} />,
    );
    await locked.findByLabelText("Play a quick mixed trivia round");
    fireEvent.click(locked.getByLabelText("Play a quick mixed trivia round"));
    expect(onQuickPlay2).toHaveBeenCalledTimes(1);
    expect(onPlay2).not.toHaveBeenCalled();
  });
});

/**
 * The completed Daily row re-opens today's own Rot Report. That report used to come ONLY from a
 * per-device localStorage stash, so playing on your phone left the row dead on every other device —
 * with no chevron, no message, nothing on tap. Home now falls back to the server, which rebuilds the
 * same report from the stored rounds.
 *
 * These run on the Starter theme (mono + art) because the completed Daily row lives in MonoHubList;
 * the arcade Rot Champion used by the tests above renders the older hub tiles instead.
 */
describe("Home — the completed Daily row's Rot Report", () => {
  const played = () => ({ open_window: royale("OPEN"), schedule: [royale("OPEN")] }) as CurrentContest;

  beforeEach(() => {
    mockMe.equipped_theme = "starter";
    mockCurrentContest.mockResolvedValue(played());
    mockMyEntry.mockResolvedValue({ entry_id: "e1", status: "SUBMITTED", submitted_at: "x" });
  });
  afterEach(() => {
    mockMe.equipped_theme = "royale";
  });

  it("rebuilds the report from the server when this device holds no stash", async () => {
    mockRotReport.mockResolvedValue({
      score: 6,
      total: 8,
      incorrect: 2,
      avg_ms: 5800,
      fastest_ms: 3100,
      worst_category: "Geography",
    });

    const { findByText } = renderHome();
    // The affordance copy is the tell: the row switches its subtitle only when a report is openable.
    await findByText("Tap to view & share your report");
    expect(mockRotReport).toHaveBeenCalledWith("e1");

    const row = (await findByText("Daily Royale")).closest("button");
    expect(row).not.toBeNull();
    expect(row?.disabled).toBe(false);
  });

  it("stays a plain completed row when neither the device nor the server has one", async () => {
    // mockRotReport rejects by default (see the outer beforeEach) — an offline tick, or an entry
    // with no stored rounds. The row must degrade quietly, never render as tappable-but-dead.
    const { findByText, queryByText } = renderHome();
    await findByText("Completed today");
    await waitFor(() => expect(mockRotReport).toHaveBeenCalledWith("e1"));

    expect(queryByText("Tap to view & share your report")).toBeNull();
    expect((queryByText("Daily Royale")?.closest("button"))?.disabled).toBe(true);
  });

  it("does not ask the server when the local stash already holds today's report", async () => {
    localStorage.setItem(
      "rot_royale_last_rot_report:u1",
      JSON.stringify({
        windowId: "rw1",
        entryId: "e1",
        report: { score: 5, total: 8, incorrect: 3, avgMs: 6000, fastestMs: 2900, worstCategory: "Sports" },
      }),
    );

    const { findByText } = renderHome();
    await findByText("Tap to view & share your report");
    expect(mockRotReport).not.toHaveBeenCalled();
  });
});
