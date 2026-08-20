// @vitest-environment jsdom
/**
 * BottomNav tests — the active-aware slot machine. Each `active` value turns exactly that slot into a
 * non-interactive highlighted item (aria-current="page") and leaves the rest as navigation buttons.
 * Covers the newly added "vault" and "none" states alongside the existing ones, plus the state-aware
 * centre Play button (royale = the open Daily Royale; quick = Quick Play mixed trivia).
 */
import { cleanup, render, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";

afterEach(cleanup);

const NAV_SLOTS = ["Home", "Campaign", "Leaderboard", "Vault"] as const;

describe("BottomNav — active-aware slots", () => {
  it("active='vault' highlights the Vault slot (non-interactive) and leaves the rest navigable", () => {
    const onVault = vi.fn();
    const onHome = vi.fn();
    const { getByLabelText } = render(
      <BottomNav active="vault" onVault={onVault} onHome={onHome} />,
    );

    const vault = getByLabelText("Vault");
    expect(vault.getAttribute("aria-current")).toBe("page");
    fireEvent.click(vault);
    expect(onVault).not.toHaveBeenCalled(); // active slot is not a nav button

    fireEvent.click(getByLabelText("Home"));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it("active='none' highlights nothing — every slot is a navigation button", () => {
    const { getByLabelText } = render(<BottomNav active="none" />);
    for (const label of NAV_SLOTS) {
      expect(getByLabelText(label).getAttribute("aria-current")).toBeNull();
    }
  });

  it("default (active='home') highlights Home", () => {
    const { getByLabelText } = render(<BottomNav />);
    expect(getByLabelText("Home").getAttribute("aria-current")).toBe("page");
    expect(getByLabelText("Vault").getAttribute("aria-current")).toBeNull();
  });

  it("Play is disabled only while unwired; routes to the royale when playTarget='royale'", () => {
    const onPlay = vi.fn();
    const { getByLabelText, rerender } = render(<BottomNav active="none" />);
    expect((getByLabelText("No game open") as HTMLButtonElement).disabled).toBe(true);

    rerender(<BottomNav active="none" playTarget="royale" onPlay={onPlay} />);
    fireEvent.click(getByLabelText("Play the open game"));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("Play routes to Quick Play when playTarget='quick' (post-Royale replay loop)", () => {
    const onPlay = vi.fn();
    const { getByLabelText } = render(
      <BottomNav active="none" playTarget="quick" onPlay={onPlay} />,
    );
    const quick = getByLabelText("Play a quick mixed trivia round") as HTMLButtonElement;
    expect(quick.disabled).toBe(false);
    fireEvent.click(quick);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});
