import { describe, expect, it } from "vitest";
import { isStreakMilestone, nextStreak, shouldCelebrate } from "@/lib/celebrate";

describe("nextStreak", () => {
  it("increments on a correct answer and resets to 0 on a wrong one", () => {
    expect(nextStreak(0, true)).toBe(1);
    expect(nextStreak(4, true)).toBe(5);
    expect(nextStreak(7, false)).toBe(0);
  });
});

describe("isStreakMilestone", () => {
  it("is true only at 3, 5, 10, 15, 20", () => {
    for (const m of [3, 5, 10, 15, 20]) expect(isStreakMilestone(m)).toBe(true);
    for (const n of [1, 2, 4, 6, 9, 11, 21]) expect(isStreakMilestone(n)).toBe(false);
  });
});

describe("shouldCelebrate — confetti gating", () => {
  it("does NOT fire on a plain correct answer (streak 1, not final)", () => {
    expect(shouldCelebrate({ correct: true, streak: 1, isFinal: false })).toBe(false);
    expect(shouldCelebrate({ correct: true, streak: 2, isFinal: false })).toBe(false);
  });

  it("fires when a correct answer hits a streak milestone", () => {
    expect(shouldCelebrate({ correct: true, streak: 3, isFinal: false })).toBe(true);
    expect(shouldCelebrate({ correct: true, streak: 5, isFinal: false })).toBe(true);
    expect(shouldCelebrate({ correct: true, streak: 10, isFinal: false })).toBe(true);
  });

  it("fires on the final question when correct, even without a milestone streak", () => {
    expect(shouldCelebrate({ correct: true, streak: 1, isFinal: true })).toBe(true);
  });

  it("never fires on a wrong answer, even on the final question", () => {
    expect(shouldCelebrate({ correct: false, streak: 3, isFinal: true })).toBe(false);
    expect(shouldCelebrate({ correct: false, streak: 0, isFinal: false })).toBe(false);
  });
});
