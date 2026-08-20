// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { GrowthScreen } from "./GrowthScreen";

vi.mock("@/api/client", () => ({
  api: {
    getGrowth: vi.fn(),
    brainBoostToday: vi.fn(),
  },
}));

const GROWTH = {
  brain_score: { current: 495, delta: 12 },
  trend: [
    { date: "2026-06-28", score: 470 },
    { date: "2026-07-01", score: 480 },
    { date: "2026-07-04", score: 495 },
  ],
  categories: [],
  consistency: { days_played: 1, streak: 1 },
};

const SUMMARY = {
  entry_id: "e",
  mode: "starter",
  submitted_at: "",
  total: 8,
  correct: 6,
  accuracy: 0.75,
  brain_score: 495,
  rot_type: "Space Goblin",
  strengths: [],
  weaknesses: [],
  categories: [
    { category: "Science & Nature", correct: 2, total: 2, accuracy: 1, score: 96 },
    { category: "History", correct: 2, total: 2, accuracy: 1, score: 91 },
    { category: "Money & Business", correct: 2, total: 2, accuracy: 1, score: 90 },
    { category: "Geography", correct: 1, total: 2, accuracy: 0.5, score: 51 },
    { category: "Pop Culture & Entertainment", correct: 0, total: 2, accuracy: 0, score: 30 },
  ],
  weak_spot_topic: null,
  movements: {},
  first_check: true,
};

describe("GrowthScreen", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.mocked(api.getGrowth).mockResolvedValue(GROWTH as never);
    vi.mocked(api.brainBoostToday).mockResolvedValue({
      completed_today: true,
      has_any_check: true,
      latest: SUMMARY,
    } as never);
  });

  it("renders the hero score, weekly delta and new subtitle in the redesigned order", async () => {
    render(<GrowthScreen onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("Your Growth")).toBeTruthy());
    expect(screen.getByText("See how you're getting sharper.")).toBeTruthy();
    // Brain Score hero — the dominant number + the trailing-7-day delta (amount + "this week").
    expect(screen.getAllByText("495").length).toBeGreaterThan(0);
    expect(screen.getByText(/\+12/)).toBeTruthy();
    expect(screen.getByText("this week")).toBeTruthy();
    // The old subtitle + old dominant AI-analysis hero are gone.
    expect(screen.queryByText(/See how your mind is leveling up/)).toBeNull();
    expect(screen.queryByText("AI ANALYSIS")).toBeNull();
    expect(screen.queryByText("Space Goblin")).toBeNull();
    expect(screen.queryByText("Mastery by subject")).toBeNull();
  });

  it("renders the AI insight (headline + gap + real focus action) from supplied data", async () => {
    const onTrain = vi.fn();
    render(<GrowthScreen onBack={() => {}} onTrainCategory={onTrain} />);
    await waitFor(() => expect(screen.getByText("AI Insight")).toBeTruthy());
    // strong-suit headline (no rising movement in the fixture) + weakest-category gap
    expect(screen.getByText(/is your strong suit/)).toBeTruthy();
    expect(screen.getByText(/is your biggest gap/)).toBeTruthy();
    // the whole insight row is the action — it trains the weakest category
    const row = screen.getByRole("button", { name: "Focus this gap" });
    fireEvent.click(row);
    expect(onTrain).toHaveBeenCalledWith("Pop Culture & Entertainment");
  });

  it("renders the knowledge profile as measured stat rows + honest placeholder rows", async () => {
    render(<GrowthScreen onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("Knowledge Profile")).toBeTruthy());
    // measured subjects render their real scores (strongest-first) with shortened names
    expect(screen.getAllByText("96").length).toBeGreaterThan(0);
    expect(screen.getAllByText("91").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pop Culture").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: /Science & Nature, score 96/ })).toBeTruthy();
    // unmeasured canonical subjects (Arts, Sports) hold their place as honest neutral rows
    expect(screen.getByRole("img", { name: /Arts & Literature, not yet measured/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: /Sports, not yet measured/ })).toBeTruthy();
  });

  it("renders the streak as a quiet supporting row", async () => {
    render(<GrowthScreen onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("1 day streak")).toBeTruthy());
  });

  it("switches the time range control", async () => {
    render(<GrowthScreen onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("495").length).toBeGreaterThan(0));
    const sevenD = screen.getByRole("tab", { name: "7D" });
    const all = screen.getByRole("tab", { name: "ALL" });
    expect(sevenD.getAttribute("aria-selected")).toBe("true");
    expect(all.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(all);
    expect(all.getAttribute("aria-selected")).toBe("true");
    expect(sevenD.getAttribute("aria-selected")).toBe("false");
  });

  it("shows honest empty states when there is no check yet", async () => {
    vi.mocked(api.brainBoostToday).mockResolvedValue({
      completed_today: false,
      has_any_check: false,
      latest: null,
    } as never);
    render(<GrowthScreen onBack={() => {}} />);
    // hero still renders from the trend; the profile + insight invite a first check
    await waitFor(() => expect(screen.getAllByText("495").length).toBeGreaterThan(0));
    expect(screen.getByText(/Play your first check to build your Brain Profile/)).toBeTruthy();
    expect(screen.getByText(/Play a check and the AI reads your game/)).toBeTruthy();
  });

  it("falls back to a keep-playing line when there is no weekly change", async () => {
    vi.mocked(api.getGrowth).mockResolvedValue({
      ...GROWTH,
      brain_score: { current: 495, delta: 0 },
      trend: [],
    } as never);
    render(<GrowthScreen onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("495")).toBeTruthy());
    expect(screen.getByText(/Keep playing to build your trend/)).toBeTruthy();
  });
});
