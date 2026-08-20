// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrainBoostToday } from "@/api/client";
import { primeArcadeTheme } from "@/test/primeArcadeTheme";
import { HubTiles } from "./HubTiles";

primeArcadeTheme();
afterEach(cleanup);

const doneToday: BrainBoostToday = {
  completed_today: true,
  has_any_check: true,
  latest: {
    entry_id: "e1",
    mode: "quick",
    submitted_at: "2026-07-03T14:00:00Z",
    total: 8,
    correct: 6,
    accuracy: 0.75,
    brain_score: 684,
    rot_type: "Market Menace",
    strengths: [{ category: "Money & Business", correct: 2, total: 2, accuracy: 1, score: 92 }],
    weaknesses: [{ category: "Geography", correct: 0, total: 2, accuracy: 0, score: 15 }],
    categories: [],
    weak_spot_topic: "Credit Card Interest",
    movements: {},
    first_check: false,
  },
};

function renderTiles(
  today: BrainBoostToday | null,
  handlers: Partial<{
    onGrowth: () => void;
    onStartCheck: () => void;
    onTrainWeakSpot: (c: string) => void;
  }> = {},
) {
  return render(
    <HubTiles
      onGrowth={handlers.onGrowth ?? (() => {})}
      today={today}
      onStartCheck={handlers.onStartCheck ?? (() => {})}
      onTrainWeakSpot={handlers.onTrainWeakSpot ?? (() => {})}
    />,
  );
}

describe("HubTiles — Brain Boost sits in the same tile stack as Your Growth", () => {
  it("renders BOTH tiles: Brain Boost (pending meta) beside Your Growth", () => {
    const { getByText } = renderTiles(null);
    expect(getByText("Brain Boost")).toBeTruthy();
    // useAiReady defaults to false in tests (no live server) → soft copy shown
    expect(getByText("8 questions · 2 min · learns as you play")).toBeTruthy();
    expect(getByText("Your Growth")).toBeTruthy();
  });

  it("pending: tapping the Brain Boost tile starts today's check", () => {
    const onStartCheck = vi.fn();
    const { getByText } = renderTiles(null, { onStartCheck });
    fireEvent.click(getByText("Brain Boost"));
    expect(onStartCheck).toHaveBeenCalledTimes(1);
  });

  it("done: the tile shows the score inline and taps into the weakest category", () => {
    const onTrainWeakSpot = vi.fn();
    const { getByText } = renderTiles(doneToday, { onTrainWeakSpot });
    expect(getByText(/684 · Market Menace/)).toBeTruthy();
    fireEvent.click(getByText("Brain Boost"));
    expect(onTrainWeakSpot).toHaveBeenCalledWith("Geography");
  });

  it("done with no known weakness: the tile falls back to another check", () => {
    const onStartCheck = vi.fn();
    const noWeakness: BrainBoostToday = {
      ...doneToday,
      latest: { ...doneToday.latest!, weaknesses: [] },
    };
    const { getByText } = renderTiles(noWeakness, { onStartCheck });
    fireEvent.click(getByText("Brain Boost"));
    expect(onStartCheck).toHaveBeenCalledTimes(1);
  });

  it("the Your Growth tile routes to growth", () => {
    const onGrowth = vi.fn();
    const { getByText } = renderTiles(null, { onGrowth });
    fireEvent.click(getByText("Your Growth"));
    expect(onGrowth).toHaveBeenCalledTimes(1);
  });
});
