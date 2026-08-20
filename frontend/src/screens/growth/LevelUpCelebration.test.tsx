// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { markMasterySeen } from "@/lib/masterySeen";
import { LevelUpCelebration } from "./LevelUpCelebration";

vi.mock("@/api/client", () => ({
  api: { getMastery: vi.fn() },
}));

const USER = "u-celebrate";

describe("LevelUpCelebration", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows the toast when a category leveled up since the baseline", async () => {
    // Baseline: Science at level 2.
    markMasterySeen(USER, [{ category: "Science & Nature", level: 2 }]);
    vi.mocked(api.getMastery).mockResolvedValue({
      categories: [{ category: "Science & Nature", level: 3, attempts: 12, mastered: false }],
    } as never);

    render(<LevelUpCelebration userId={USER} trigger={1} />);
    await waitFor(() => expect(screen.getByText(/Science & Nature/)).toBeTruthy());
    expect(screen.getByText(/Level 3/)).toBeTruthy();
  });

  it("celebrates exactly once: after dismiss the baseline advances so a re-mount shows nothing", async () => {
    markMasterySeen(USER, [{ category: "Geography", level: 1 }]);
    const resp = {
      categories: [{ category: "Geography", level: 3, attempts: 20, mastered: false }],
    };
    vi.mocked(api.getMastery).mockResolvedValue(resp as never);

    const first = render(<LevelUpCelebration userId={USER} trigger={1} />);
    const toast = await waitFor(() => screen.getByText(/Geography/));
    // Dismiss the toast (click) → markMasterySeen advances the baseline to level 3.
    fireEvent.click(toast);
    await waitFor(() => expect(screen.queryByText(/Geography/)).toBeNull());
    first.unmount();

    // Re-mount with the SAME mastery — nothing new leveled, so no toast.
    render(<LevelUpCelebration userId={USER} trigger={2} />);
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => expect(api.getMastery).toHaveBeenCalled());
    expect(screen.queryByText(/Geography/)).toBeNull();
  });

  it("renders nothing when getMastery rejects (offline/error)", async () => {
    markMasterySeen(USER, [{ category: "History", level: 1 }]);
    vi.mocked(api.getMastery).mockRejectedValue(new Error("offline"));

    const { container } = render(<LevelUpCelebration userId={USER} trigger={1} />);
    await waitFor(() => expect(api.getMastery).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    expect(screen.queryByText(/History/)).toBeNull();
  });
});
