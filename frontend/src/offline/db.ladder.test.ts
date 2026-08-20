// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import type { CampaignLadderResponse } from "@/api/client";
import { getLadder, putLadder } from "./db";

const ladder: CampaignLadderResponse = {
  daily_coins_earned: 3,
  daily_coins_cap: 100,
  worlds: [
    {
      world: "Science",
      category: "Science & Nature",
      cleared_count: 1,
      total_levels: 1,
      arcs: [
        {
          name: "Arc 1",
          levels: [
            {
              level_number: 1,
              title: "Start",
              arc_name: "Arc 1",
              is_boss: false,
              difficulty_mix: { easy: 4, medium: 4, hard: 2 },
              unlocked: true,
              cleared: true,
              clear_status: "clear",
              best_correct: 8,
            },
          ],
        },
      ],
    },
  ],
};

describe("offline db ladder cache", () => {
  it("round-trips the campaign ladder", async () => {
    await putLadder(ladder);
    expect(await getLadder()).toEqual(ladder);
  });
});
