import { describe, expect, it } from "vitest";
import type { DuelResult } from "@/api/client";
import { en } from "@/i18n/en";
import { resultReasonCopy } from "./resultReasonCopy";

const d = en.duel;

function make(over: Partial<DuelResult>): DuelResult {
  return {
    winner: "user",
    result_reason: "first_to_4",
    user_round_wins: 4,
    rival_round_wins: 2,
    gem_delta: 36,
    xp_awarded: 50,
    perfect: false,
    comeback: false,
    duel_tier: "bronze",
    ...over,
  };
}

describe("resultReasonCopy", () => {
  it("first_to_4 phrases for a win vs a loss", () => {
    expect(resultReasonCopy(en, make({ winner: "user", result_reason: "first_to_4" }))).toBe(
      d.reasonWin.first_to_4,
    );
    expect(resultReasonCopy(en, make({ winner: "rival", result_reason: "first_to_4" }))).toBe(
      d.reasonLoss.first_to_4,
    );
  });

  it("higher_round_wins phrases per side", () => {
    expect(resultReasonCopy(en, make({ winner: "user", result_reason: "higher_round_wins" }))).toBe(
      d.reasonWin.higher_round_wins,
    );
    expect(resultReasonCopy(en, make({ winner: "rival", result_reason: "higher_round_wins" }))).toBe(
      d.reasonLoss.higher_round_wins,
    );
  });

  it("sudden_death phrases per side", () => {
    expect(resultReasonCopy(en, make({ winner: "user", result_reason: "sudden_death" }))).toBe(
      d.reasonWin.sudden_death,
    );
    expect(resultReasonCopy(en, make({ winner: "rival", result_reason: "sudden_death" }))).toBe(
      d.reasonLoss.sudden_death,
    );
  });

  it("any tiebreak_* reason collapses to the tiebreaker line", () => {
    for (const r of ["tiebreak_total_correct", "tiebreak_avg_speed", "tiebreak_seed"]) {
      expect(resultReasonCopy(en, make({ winner: "user", result_reason: r }))).toBe(d.reasonWin.tiebreak);
      expect(resultReasonCopy(en, make({ winner: "rival", result_reason: r }))).toBe(d.reasonLoss.tiebreak);
    }
  });

  it("unknown/abandoned reason falls back to the generic line per side", () => {
    expect(resultReasonCopy(en, make({ winner: "user", result_reason: "abandoned" }))).toBe(
      d.reasonWin.generic,
    );
    expect(resultReasonCopy(en, make({ winner: "rival", result_reason: "something_new" }))).toBe(
      d.reasonLoss.generic,
    );
  });
});
