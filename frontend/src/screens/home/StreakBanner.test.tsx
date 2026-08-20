import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChestReward } from "@/api/client";
import { findBannedTerms } from "@/i18n/copyGuard";
import { StreakBanner } from "@/screens/home/StreakBanner";

const REWARD: ChestReward = { coins: 0, gems: 2, code: "streak_5" };

describe("StreakBanner", () => {
  it("shows the streak count, the rung days, and the next reward", () => {
    const out = renderToStaticMarkup(
      <StreakBanner current={4} milestones={[3, 5, 7]} nextMilestone={5} nextReward={REWARD} />,
    );
    expect(out).toContain("4-day streak");
    expect(out).toContain("Day 5");
    expect(out).toContain(">3<"); // rung pip
    expect(out).toContain(">7<");
  });
  it("shows the maxed line past the last rung", () => {
    const out = renderToStaticMarkup(
      <StreakBanner current={9} milestones={[3, 5, 7]} nextMilestone={null} nextReward={null} />,
    );
    expect(out).toContain("Top of the streak ladder");
  });
  it("is copy-guard clean", () => {
    const out = renderToStaticMarkup(
      <StreakBanner current={4} milestones={[3, 5, 7]} nextMilestone={5} nextReward={REWARD} />,
    );
    expect(findBannedTerms(out)).toEqual([]);
  });
});
