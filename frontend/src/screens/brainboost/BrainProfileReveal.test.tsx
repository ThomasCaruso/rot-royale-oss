// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, type BrainBoostSummary } from "@/api/client";
import { BrainProfileReveal } from "./BrainProfileReveal";

const summary: BrainBoostSummary = {
  entry_id: "e1",
  mode: "starter",
  submitted_at: "2026-07-03T14:00:00Z",
  total: 8,
  correct: 6,
  accuracy: 0.75,
  brain_score: 684,
  rot_type: "Market Menace",
  strengths: [
    {
      category: "Money & Business",
      correct: 2,
      total: 2,
      accuracy: 1,
      score: 92,
    },
    { category: "Sports", correct: 2, total: 2, accuracy: 1, score: 88 },
  ],
  weaknesses: [
    {
      category: "Science & Nature",
      correct: 0,
      total: 2,
      accuracy: 0,
      score: 12,
    },
  ],
  categories: [],
  weak_spot_topic: "Compound Interest",
  movements: {},
  first_check: true,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BrainProfileReveal — the profile the app just learned", () => {
  it("shows Rot Type, strengths, weak spots, the weak-spot topic, and the save CTA", async () => {
    vi.spyOn(api, "brainBoostSummary").mockResolvedValue(summary);
    render(
      <BrainProfileReveal
        entryId="e1"
        onSave={() => {}}
        onKeepPlaying={() => {}}
      />
    );

    expect(await screen.findByText("Market Menace")).toBeTruthy();
    expect(screen.getByText(/Money & Business/)).toBeTruthy();
    expect(screen.getByText(/Science & Nature/)).toBeTruthy();
    expect(screen.getByText(/Compound Interest/)).toBeTruthy();
    expect(screen.getByText("SAVE MY PROFILE")).toBeTruthy();
    expect(screen.getByText("Keep playing")).toBeTruthy();
    // First check → honest "early read" framing.
    expect(screen.getByText(/Early read/)).toBeTruthy();
  });

  it("Save My Profile routes to the save flow; Keep playing exits", async () => {
    vi.spyOn(api, "brainBoostSummary").mockResolvedValue(summary);
    const onSave = vi.fn();
    const onKeep = vi.fn();
    render(
      <BrainProfileReveal entryId="e1" onSave={onSave} onKeepPlaying={onKeep} />
    );

    fireEvent.click(await screen.findByText("SAVE MY PROFILE"));
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Keep playing"));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it("a summary fetch failure never traps the player — Keep playing is offered", async () => {
    vi.spyOn(api, "brainBoostSummary").mockRejectedValue(new Error("down"));
    const onKeep = vi.fn();
    render(
      <BrainProfileReveal
        entryId="e1"
        onSave={() => {}}
        onKeepPlaying={onKeep}
      />
    );
    fireEvent.click(await screen.findByText("Keep playing"));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });
});
