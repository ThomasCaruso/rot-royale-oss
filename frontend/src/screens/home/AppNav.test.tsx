// @vitest-environment jsdom
/**
 * AppNav tests (jsdom + @testing-library/react).
 *
 * AppNav is the single reusable bottom nav for the flat App-controlled screens (Vault, Leaderboard,
 * the practice picker). It owns the Play affordance via useOpenContest(). These tests pin:
 *   - the `active` slot renders as a non-interactive highlighted item (aria-current="page")
 *   - tapping Home/Campaign/Leaderboard/Vault invokes the matching handler
 *   - Play routes to the open royale (onPlayWindow(windowId)) when a window is open and unentered,
 *     and falls back to Quick Play (onQuickPlay) otherwise
 *   - active="none" highlights nothing (every slot is a navigation button)
 */
import { cleanup, render, fireEvent, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentContest } from "@/api/client";

const currentContest = vi.fn();
const myEntry = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    currentContest: () => currentContest(),
    myEntry: (id: string) => myEntry(id),
  },
}));

import { AppNav } from "./AppNav";

const noContest: CurrentContest = { open_window: null, schedule: [] };

async function renderNav(props: Partial<React.ComponentProps<typeof AppNav>> = {}) {
  const onHome = vi.fn();
  const onCampaign = vi.fn();
  const onLeaderboard = vi.fn();
  const onVault = vi.fn();
  const onPlayWindow = vi.fn();
  const onQuickPlay = vi.fn();
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <AppNav
        active="none"
        onHome={onHome}
        onCampaign={onCampaign}
        onLeaderboard={onLeaderboard}
        onVault={onVault}
        onPlayWindow={onPlayWindow}
        onQuickPlay={onQuickPlay}
        {...props}
      />,
    );
  });
  return { ...utils, onHome, onCampaign, onLeaderboard, onVault, onPlayWindow, onQuickPlay };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AppNav — reusable bottom nav", () => {
  it("the active slot is a non-interactive highlighted item; others navigate", async () => {
    currentContest.mockResolvedValue(noContest);
    const { getByLabelText, onVault, onHome } = await renderNav({ active: "vault" });
    await waitFor(() => getByLabelText("Vault"));

    // Vault is active → aria-current=page, and clicking it does NOT navigate (no onVault wired here).
    const vault = getByLabelText("Vault");
    expect(vault.getAttribute("aria-current")).toBe("page");
    fireEvent.click(vault);
    expect(onVault).not.toHaveBeenCalled();

    // Home is a normal nav button.
    fireEvent.click(getByLabelText("Home"));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it("active='none' highlights nothing — every destination is a navigation button", async () => {
    currentContest.mockResolvedValue(noContest);
    const { getByLabelText, onHome, onCampaign, onLeaderboard, onVault } = await renderNav({
      active: "none",
    });
    await waitFor(() => getByLabelText("Home"));

    for (const label of ["Home", "Campaign", "Leaderboard", "Vault"]) {
      expect(getByLabelText(label).getAttribute("aria-current")).toBeNull();
    }
    fireEvent.click(getByLabelText("Home"));
    fireEvent.click(getByLabelText("Campaign"));
    fireEvent.click(getByLabelText("Leaderboard"));
    fireEvent.click(getByLabelText("Vault"));
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(onCampaign).toHaveBeenCalledTimes(1);
    expect(onLeaderboard).toHaveBeenCalledTimes(1);
    expect(onVault).toHaveBeenCalledTimes(1);
  });

  it("Play falls back to Quick Play when there is no open window", async () => {
    currentContest.mockResolvedValue(noContest);
    const { getByLabelText, onQuickPlay, onPlayWindow } = await renderNav();
    await waitFor(() => getByLabelText("Play a quick mixed trivia round"));
    fireEvent.click(getByLabelText("Play a quick mixed trivia round"));
    expect(onQuickPlay).toHaveBeenCalledTimes(1);
    expect(onPlayWindow).not.toHaveBeenCalled();
  });

  it("Play routes to onPlayWindow(windowId) when a window is open and unentered", async () => {
    currentContest.mockResolvedValue({
      open_window: { id: "win-9" },
      schedule: [],
    } as unknown as CurrentContest);
    myEntry.mockResolvedValue({ entry_id: null });
    const { getByLabelText, onPlayWindow } = await renderNav();
    await waitFor(() => getByLabelText("Play the open game"));
    fireEvent.click(getByLabelText("Play the open game"));
    expect(onPlayWindow).toHaveBeenCalledWith("win-9");
  });

  it("Play routes to Quick Play once the open window is already entered (score locked)", async () => {
    currentContest.mockResolvedValue({
      open_window: { id: "win-9" },
      schedule: [],
    } as unknown as CurrentContest);
    myEntry.mockResolvedValue({ entry_id: "e1" });
    const { getByLabelText, onQuickPlay, onPlayWindow } = await renderNav();
    await waitFor(() => getByLabelText("Play a quick mixed trivia round"));
    fireEvent.click(getByLabelText("Play a quick mixed trivia round"));
    expect(onQuickPlay).toHaveBeenCalledTimes(1);
    expect(onPlayWindow).not.toHaveBeenCalled();
  });
});
