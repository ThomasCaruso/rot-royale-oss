import { describe, expect, it } from "vitest";
import {
  chestProgress,
  cosmeticName,
  MISSION_ICON,
  rewardAmount,
  rewardKind,
  streakRungs,
} from "@/lib/today";

describe("streakRungs", () => {
  it("marks rungs at/below the current streak as reached and flags the next one", () => {
    const rungs = streakRungs(4, [3, 5, 7], 5);
    expect(rungs).toEqual([
      { day: 3, reached: true, isNext: false },
      { day: 5, reached: false, isNext: true },
      { day: 7, reached: false, isNext: false },
    ]);
  });
  it("has no next rung once past the last milestone", () => {
    const rungs = streakRungs(9, [3, 5, 7], null);
    expect(rungs.every((r) => r.reached)).toBe(true);
    expect(rungs.some((r) => r.isNext)).toBe(false);
  });
});

describe("reward shape", () => {
  it("prefers gems when present, else coins", () => {
    expect(rewardKind({ coins: 0, gems: 2 })).toBe("gems");
    expect(rewardAmount({ coins: 0, gems: 2 })).toBe(2);
    expect(rewardKind({ coins: 75, gems: 0 })).toBe("coins");
    expect(rewardAmount({ coins: 75, gems: 0 })).toBe(75);
  });
});

describe("chestProgress", () => {
  it("fills toward the required threshold and clamps at 1", () => {
    expect(chestProgress(0, 2)).toBe(0);
    expect(chestProgress(1, 2)).toBe(0.5);
    expect(chestProgress(2, 2)).toBe(1);
    expect(chestProgress(3, 2)).toBe(1);
  });
});

describe("cosmeticName", () => {
  it("resolves frame and theme ids to their display names, falling back to the id", () => {
    expect(cosmeticName("violet_duel_frame", "frame")).toBe("Duelist's Edge");
    expect(cosmeticName("royale", "theme")).toBe("Rot Champion");
    expect(cosmeticName("totally_unknown", "frame")).toBe("totally_unknown");
  });
});

describe("MISSION_ICON", () => {
  it("has an icon for each of the three daily missions", () => {
    expect(MISSION_ICON.play_royale).toBeTruthy();
    expect(MISSION_ICON.complete_duel).toBeTruthy();
    expect(MISSION_ICON.clear_campaign).toBeTruthy();
  });
});
