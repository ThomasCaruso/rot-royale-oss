// @vitest-environment jsdom
/**
 * Campaign navigation flow tests (jsdom + @testing-library/react).
 *
 * Pins the two navigation contracts the container now owns (the BottomNav + battle affordance were
 * lifted out of CampaignWorlds so the worlds hub AND the level selector share one nav):
 *   - the bottom nav (Campaign active) renders on the worlds hub AND on the ladder (level selector)
 *   - the ðŸ† Leaderboard control is present and a tap invokes onLeaderboard (the dead-button bug)
 *   - Home / Vault still reachable from campaign; Battle enabled only when a window is open+unentered
 *   - the nav is NOT rendered while a level is in progress ("playing") â€” that stays immersive
 */
import { cleanup, render, fireEvent, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CampaignLadderResponse,
  CampaignStartResponse,
  CurrentContest,
} from "@/api/client";

const campaign = vi.fn();
const currentContest = vi.fn();
const myEntry = vi.fn();
const campaignStart = vi.fn();

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    campaign: () => campaign(),
    currentContest: () => currentContest(),
    myEntry: (id: string) => myEntry(id),
    campaignStart: (w: string, l: number) => campaignStart(w, l),
  },
}));

// refreshMe is only called after a level completes; stub it so the import resolves.
vi.mock("@/api/session", () => ({ refreshMe: () => Promise.resolve() }));

// CampaignPlay pulls the round loop / store; the nav tests never need a real round â€” stub it to a
// marker (asserts the "playing" view rendered, nav absent) plus a "finish" trigger so a test can
// drive playing â†’ complete and assert the completion screen also renders no nav.
vi.mock("@/screens/campaign/CampaignPlay", () => ({
  CampaignPlay: ({ onFinished }: { onFinished: (c: unknown) => void }) => (
    <div data-testid="campaign-play">
      playing
      <button
        type="button"
        onClick={() =>
          onFinished({
            world: "Science",
            level: 1,
            title: "First Spark",
            is_boss: false,
            correct: 3,
            total: 5,
            passed: true,
            clear_status: "clear",
            coins_awarded: 10,
            daily_cap_reached: false,
            first_clear: false, // replay-style clear â†’ no world-complete celebration to render
            next_level_unlocked: false,
            best_correct: 3,
          })
        }
      >
        finish
      </button>
    </div>
  ),
}));

import { Campaign } from "./Campaign";

// jsdom has no matchMedia; LevelComplete (the completion screen) calls useReducedMotion. Stub it so
// the complete-view render doesn't throw. matches:false = motion allowed, irrelevant to nav tests.
if (typeof window.matchMedia !== "function") {
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

function ladder(): CampaignLadderResponse {
  return {
    daily_coins_earned: 0,
    daily_coins_cap: 300,
    worlds: [
      {
        world: "Science",
        category: "Science & Nature",
        cleared_count: 0,
        total_levels: 1,
        arcs: [
          {
            name: "Arc I",
            levels: [
              {
                level_number: 1,
                title: "First Spark",
                arc_name: "Arc I",
                is_boss: false,
                difficulty_mix: { easy: 3, medium: 2, hard: 0 },
                unlocked: true,
                cleared: false,
                clear_status: null,
                best_correct: 0,
              },
            ],
          },
        ],
      },
    ],
  };
}

const noContest: CurrentContest = { open_window: null, schedule: [] };

async function renderCampaign(props: Partial<React.ComponentProps<typeof Campaign>> = {}) {
  const onExit = vi.fn();
  const onPlay = vi.fn();
  const onQuickPlay = vi.fn();
  const onPractice = vi.fn();
  const onLeaderboard = vi.fn();
  const onVault = vi.fn();
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <Campaign
        onExit={onExit}
        onPlay={onPlay}
        onQuickPlay={onQuickPlay}
        onPractice={onPractice}
        onLeaderboard={onLeaderboard}
        onVault={onVault}
        {...props}
      />,
    );
  });
  return { ...utils, onExit, onPlay, onQuickPlay, onPractice, onLeaderboard, onVault };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Campaign navigation â€” bottom nav + leaderboard wiring", () => {
  it("renders the bottom nav on the worlds hub with a working Leaderboard control", async () => {
    campaign.mockResolvedValue(ladder());
    currentContest.mockResolvedValue(noContest);
    const { getByLabelText, onLeaderboard } = await renderCampaign();
    await waitFor(() => getByLabelText("Leaderboard"));

    // The ðŸ† button is present (active is Campaign, so Leaderboard is an interactive IconButton)â€¦
    const lb = getByLabelText("Leaderboard");
    fireEvent.click(lb);
    // â€¦and a tap invokes the handler â€” the previously-dead button now works from campaign.
    expect(onLeaderboard).toHaveBeenCalledTimes(1);
  });

  it("Home and Vault stay reachable from the campaign hub", async () => {
    campaign.mockResolvedValue(ladder());
    currentContest.mockResolvedValue(noContest);
    const { getByLabelText, onExit, onVault } = await renderCampaign();
    await waitFor(() => getByLabelText("Home"));

    fireEvent.click(getByLabelText("Home"));
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.click(getByLabelText("Vault"));
    expect(onVault).toHaveBeenCalledTimes(1);
  });

  it("Play falls back to Quick Play with no open window, plays the window when open and unentered", async () => {
    // No window: Play routes to Quick Play (the no-stakes mixed trivia loop).
    campaign.mockResolvedValue(ladder());
    currentContest.mockResolvedValue(noContest);
    const noWin = await renderCampaign();
    await waitFor(() => noWin.getByLabelText("Play a quick mixed trivia round"));
    fireEvent.click(noWin.getByLabelText("Play a quick mixed trivia round"));
    expect(noWin.onQuickPlay).toHaveBeenCalledTimes(1);
    expect(noWin.onPlay).not.toHaveBeenCalled();
    cleanup();
    vi.clearAllMocks();

    // Open window, not entered: Play routes to that window (the main event).
    campaign.mockResolvedValue(ladder());
    currentContest.mockResolvedValue({
      open_window: { id: "win-1" },
      schedule: [],
    } as unknown as CurrentContest);
    myEntry.mockResolvedValue({ entry_id: null });
    const open = await renderCampaign();
    await waitFor(() => open.getByLabelText("Play the open game"));
    fireEvent.click(open.getByLabelText("Play the open game"));
    expect(open.onPlay).toHaveBeenCalledWith("win-1");
  });

  it("renders the bottom nav on the ladder (level selector) too â€” the disappearing-nav bug", async () => {
    campaign.mockResolvedValue(ladder());
    currentContest.mockResolvedValue(noContest);
    const { getByText, getByLabelText, onLeaderboard } = await renderCampaign();
    await waitFor(() => getByLabelText("Leaderboard"));

    // Drill into the world to reach the ladder (level selector).
    await act(async () => {
      fireEvent.click(getByText("Science"));
    });
    // The nav is STILL there on the ladder, and its Leaderboard control still works.
    const lb = getByLabelText("Leaderboard");
    fireEvent.click(lb);
    expect(onLeaderboard).toHaveBeenCalledTimes(1);
  });

  it("does NOT render the bottom nav while a level is in progress (immersive)", async () => {
    campaign.mockResolvedValue(ladder());
    currentContest.mockResolvedValue(noContest);
    campaignStart.mockResolvedValue({
      entry_id: "e1",
      world: "Science",
      level: 1,
      title: "First Spark",
      is_boss: false,
      rounds: [],
    } as CampaignStartResponse);
    const { getByText, getByTestId, queryByLabelText } = await renderCampaign();
    await waitFor(() => getByText("Science"));

    // worlds â†’ ladder
    await act(async () => {
      fireEvent.click(getByText("Science"));
    });
    expect(queryByLabelText("Leaderboard")).not.toBeNull(); // nav on the ladder

    // ladder â†’ playing (tap the unlocked level node)
    await act(async () => {
      fireEvent.click(getByText("Start Level")); // the Next Up CTA plays the current level
    });
    getByTestId("campaign-play"); // we're in the immersive play viewâ€¦
    expect(queryByLabelText("Leaderboard")).toBeNull(); // â€¦and the nav is gone
  });

  it("does NOT render the bottom nav on the completion screen either (stays immersive)", async () => {
    campaign.mockResolvedValue(ladder());
    currentContest.mockResolvedValue(noContest);
    campaignStart.mockResolvedValue({
      entry_id: "e1",
      world: "Science",
      level: 1,
      title: "First Spark",
      is_boss: false,
      rounds: [],
    } as CampaignStartResponse);
    const { getByText, queryByLabelText } = await renderCampaign();
    await waitFor(() => getByText("Science"));

    // worlds â†’ ladder â†’ playing â†’ complete
    await act(async () => {
      fireEvent.click(getByText("Science"));
    });
    await act(async () => {
      fireEvent.click(getByText("Start Level")); // the Next Up CTA plays the current level
    });
    await act(async () => {
      fireEvent.click(getByText("finish")); // CampaignPlay stub fires onFinished â†’ view "complete"
    });
    // The completion screen (the FRAME UNLOCKED celebration surface) must not have a nav over it.
    expect(queryByLabelText("Leaderboard")).toBeNull();
  });
});
