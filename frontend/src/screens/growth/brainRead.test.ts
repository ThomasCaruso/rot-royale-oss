import { describe, expect, it } from "vitest";
import type { BrainBoostSummary } from "@/api/client";
import { composeBrainRead } from "./brainRead";

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
    accuracy: 0.75,
    brain_score: 500,
    rot_type: "Market Menace",
    strengths: [],
    weaknesses: [],
    categories: [],
    weak_spot_topic: null,
    movements: {},
    first_check: false,
    ...over,
  };
}

describe("composeBrainRead", () => {
  it("isEmpty for a null summary", () => {
    const r = composeBrainRead(null);
    expect(r.isEmpty).toBe(true);
    expect(r.headline).toBe("");
  });

  it("isEmpty when categories are empty", () => {
    const r = composeBrainRead(summary({ categories: [] }));
    expect(r.isEmpty).toBe(true);
  });

  it("bands by accuracy: elite >= 0.75", () => {
    const r = composeBrainRead(
      summary({ accuracy: 0.8, categories: [cat("Science & Nature", 90), cat("History", 70)] }),
    );
    expect(r.band).toBe("elite");
  });

  it("bands by accuracy: solid >= 0.45", () => {
    const r = composeBrainRead(
      summary({ accuracy: 0.5, categories: [cat("Science & Nature", 60), cat("History", 40)] }),
    );
    expect(r.band).toBe("solid");
  });

  it("bands by accuracy: rookie below 0.45", () => {
    const r = composeBrainRead(
      summary({ accuracy: 0.3, categories: [cat("Science & Nature", 40), cat("History", 20)] }),
    );
    expect(r.band).toBe("rookie");
  });

  it("picks top + second strength by score desc", () => {
    const r = composeBrainRead(
      summary({
        categories: [cat("History", 70), cat("Science & Nature", 90), cat("Geography", 50)],
      }),
    );
    expect(r.topStrength).toBe("Science & Nature");
    expect(r.secondStrength).toBe("History");
    expect(r.headline).toBe("Market Menace");
  });

  it("secondStrength is null for a single category", () => {
    const r = composeBrainRead(summary({ categories: [cat("Science & Nature", 90)] }));
    expect(r.topStrength).toBe("Science & Nature");
    expect(r.secondStrength).toBeNull();
  });

  it("prefers weak_spot_topic (weakIsTopic true)", () => {
    const r = composeBrainRead(
      summary({
        weak_spot_topic: "European capitals",
        categories: [cat("Science & Nature", 90), cat("History", 80), cat("Geography", 40)],
      }),
    );
    expect(r.weakSpot).toBe("European capitals");
    expect(r.weakIsTopic).toBe(true);
  });

  it("falls back to the weakest non-strength category (weakIsTopic false)", () => {
    const r = composeBrainRead(
      summary({
        categories: [cat("Science & Nature", 90), cat("History", 80), cat("Geography", 40)],
      }),
    );
    expect(r.weakSpot).toBe("Geography");
    expect(r.weakIsTopic).toBe(false);
  });

  it("has no weak spot when only 1-2 categories (all are strengths)", () => {
    const r = composeBrainRead(
      summary({ categories: [cat("Science & Nature", 90), cat("History", 40)] }),
    );
    expect(r.weakSpot).toBeNull();
  });

  it("selects the rising category with the max positive movement", () => {
    const r = composeBrainRead(
      summary({
        categories: [cat("Science & Nature", 90), cat("History", 70)],
        movements: { "Science & Nature": 3, History: 8, Geography: -2 },
      }),
    );
    expect(r.risingCategory).toBe("History");
  });

  it("has no rising category when no movement is positive", () => {
    const r = composeBrainRead(
      summary({
        categories: [cat("Science & Nature", 90), cat("History", 70)],
        movements: { History: -5, Geography: 0 },
      }),
    );
    expect(r.risingCategory).toBeNull();
  });

  it("carries the first_check flag", () => {
    const r = composeBrainRead(
      summary({ first_check: true, categories: [cat("Science & Nature", 90), cat("History", 70)] }),
    );
    expect(r.firstCheck).toBe(true);
  });
});
