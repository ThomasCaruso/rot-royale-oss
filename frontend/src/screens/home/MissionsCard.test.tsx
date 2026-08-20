import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChestReward, Mission } from "@/api/client";
import { findBannedTerms } from "@/i18n/copyGuard";
import { MissionsCard, type MissionsCardProps } from "@/screens/home/MissionsCard";

const MISSIONS: Mission[] = [
  { id: "play_royale", done: true },
  { id: "complete_duel", done: true },
  { id: "clear_campaign", done: false },
];
const COIN_REWARD: ChestReward = { coins: 50, gems: 0, code: "mon" };
const GEM_REWARD: ChestReward = { coins: 0, gems: 2, code: "sun" };

function html(overrides: Partial<MissionsCardProps> = {}) {
  return renderToStaticMarkup(
    <MissionsCard
      missions={MISSIONS}
      completedCount={2}
      required={2}
      chestState="ready"
      reward={COIN_REWARD}
      claiming={false}
      onClaim={() => {}}
      {...overrides}
    />,
  );
}

describe("MissionsCard", () => {
  it("renders the title, the three missions, and the open-chest CTA when ready", () => {
    const out = html();
    expect(out).toContain("Daily Missions");
    expect(out).toContain("Play the Daily Royale");
    expect(out).toContain("Complete a Duel");
    expect(out).toContain("Clear a Campaign level");
    expect(out).toContain("OPEN CHEST");
  });
  it("hides the CTA once claimed", () => {
    expect(html({ chestState: "claimed" })).not.toContain("OPEN CHEST");
  });
  it("hides the CTA while in progress", () => {
    expect(html({ chestState: "in_progress", completedCount: 1 })).not.toContain("OPEN CHEST");
  });
  it("shows the opening label while claiming", () => {
    expect(html({ claiming: true })).toContain("Opening");
  });
  it("is copy-guard clean across states and reward kinds", () => {
    for (const chestState of ["in_progress", "ready", "claimed"]) {
      expect(findBannedTerms(html({ chestState }))).toEqual([]);
      expect(findBannedTerms(html({ chestState, reward: GEM_REWARD }))).toEqual([]);
    }
  });
});
