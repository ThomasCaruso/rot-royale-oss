// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BrainBoostSummary } from "@/api/client";
import { BrainReadCard, type BrainReadLabels } from "./BrainReadCard";

const LABELS: BrainReadLabels = {
  eyebrow: "AI ANALYSIS",
  emptyHeadline: "No read yet",
  emptyBody: "Run a Brain Boost and the AI will read your game.",
  strongElite: "{a} and {b} are clearly home turf. Quick answers, few misses.",
  strongEliteSolo: "{a} is clearly home turf. Quick answers, few misses.",
  strongSolid: "You've got range, and {a} is where it shows.",
  strongRookie: "Early days, but {a} is already where you land.",
  weakSharp: "The one pattern worth flagging: {w} keeps slipping through.",
  weakSoft: "{w} is where the points leak for now.",
  fwdFirst: "An early read. It sharpens every round you play.",
  fwdRising: "{r} is trending up since last check. Worth leaning into.",
  fwdElite: "Tighten that and the profile's hard to argue with.",
  fwdSolid: "Keep stacking rounds and it comes together.",
};

function cat(category: string, score: number) {
  return { category, correct: 0, total: 2, accuracy: score / 100, score };
}

function summary(over: Partial<BrainBoostSummary>): BrainBoostSummary {
  return {
    entry_id: "e",
    mode: "starter",
    submitted_at: "",
    total: 8,
    correct: 6,
    accuracy: 0.8,
    brain_score: 500,
    rot_type: "Market Menace",
    strengths: [],
    weaknesses: [],
    categories: [cat("Science & Nature", 90), cat("History", 80), cat("Geography", 40)],
    weak_spot_topic: null,
    movements: {},
    first_check: false,
    ...over,
  };
}

describe("BrainReadCard", () => {
  afterEach(() => cleanup());

  it("renders the rot_type headline + a body sentence with the top strength", () => {
    render(<BrainReadCard summary={summary({})} labels={LABELS} />);
    expect(screen.getByText("Market Menace")).toBeTruthy();
    // top strength appears (punchy read name), weak spot appears (Geography)
    expect(screen.getByText("Science")).toBeTruthy();
    expect(screen.getByText("Geography")).toBeTruthy();
    expect(screen.getByText(/clearly home turf/)).toBeTruthy();
  });

  it("renders the invite/empty state when summary is null", () => {
    render(<BrainReadCard summary={null} labels={LABELS} />);
    expect(screen.getByText("No read yet")).toBeTruthy();
    expect(screen.getByText(/the AI will read your game/)).toBeTruthy();
  });

  it("renders first-check forward copy when first_check is true", () => {
    render(<BrainReadCard summary={summary({ first_check: true })} labels={LABELS} />);
    expect(screen.getByText(/An early read/)).toBeTruthy();
  });

  it("renders no em dash anywhere in the read", () => {
    const { container } = render(<BrainReadCard summary={summary({})} labels={LABELS} />);
    expect(container.textContent).not.toContain("—");
  });
});
