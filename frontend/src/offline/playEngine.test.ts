import { describe, it, expect } from "vitest";
import { revealFor, itemFor } from "./playEngine";
import type { OfflineRound } from "./types";

const round: OfflineRound = {
  question_id: "q1", idx: 0,
  client_spec: { prompt: "2+2", options: ["5", "4", "6", "7"], category: "Science & Nature", icon: "flask", time_limit_ms: 10000 },
  option_source_index: [1, 0, 2, 3], // shuffled slot -> original index
  correct_index: 1,                  // "4" sits at shuffled slot 1
  explanation: "because",
};

describe("offline play engine", () => {
  it("reveals correct when the chosen shuffled slot is the correct one", () => {
    const r = revealFor(round, 1);
    expect(r.correct).toBe(true);
    expect(r.correctIndex).toBe(1);
    expect(r.explanation).toBe("because");
  });
  it("reveals wrong otherwise", () => {
    expect(revealFor(round, 0).correct).toBe(false);
  });
  it("records the choice as the ORIGINAL bank index", () => {
    // chose shuffled slot 0 -> original index 1
    expect(itemFor(round, 0, 3400)).toEqual({ question_id: "q1", selected_source_index: 1, elapsed_ms: 3400 });
  });
  it("handles the timeout case (null choice)", () => {
    expect(revealFor(round, null).correct).toBe(false);
    expect(itemFor(round, null, 9999).selected_source_index).toBe(-1);
  });
});
