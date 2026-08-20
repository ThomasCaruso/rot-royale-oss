// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { CampaignLadderResponse, CampaignLevel } from "@/api/client";
import {
  clearProvisional,
  loadProvisional,
  markProvisionalClear,
  overlayLadder,
} from "./campaignLocal";

const lvl = (over: Partial<CampaignLevel>): CampaignLevel => ({
  level_number: 1,
  title: "L",
  arc_name: "Arc",
  is_boss: false,
  difficulty_mix: { easy: 4, medium: 4, hard: 2 },
  unlocked: false,
  cleared: false,
  clear_status: null,
  best_correct: 0,
  ...over,
});

const ladder = (): CampaignLadderResponse => ({
  daily_coins_earned: 0,
  daily_coins_cap: 100,
  worlds: [
    {
      world: "Science",
      category: "Science & Nature",
      cleared_count: 1,
      total_levels: 3,
      arcs: [
        {
          name: "Arc 1",
          levels: [
            lvl({ level_number: 1, unlocked: true, cleared: true, clear_status: "clear" }),
            lvl({ level_number: 2, unlocked: false, cleared: false }),
          ],
        },
        {
          name: "Arc 2",
          levels: [lvl({ level_number: 3, unlocked: false, cleared: false })],
        },
      ],
    },
    {
      world: "History",
      category: "History",
      cleared_count: 0,
      total_levels: 1,
      arcs: [{ name: "Arc 1", levels: [lvl({ level_number: 1, unlocked: true })] }],
    },
  ],
});

describe("campaignLocal provisional store", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a provisional clear for a user", () => {
    markProvisionalClear("user-a", "Science", 2);
    expect(loadProvisional("user-a")).toEqual({ cleared: [{ world: "Science", level: 2 }] });
  });

  it("returns { cleared: [] } when nothing is stored", () => {
    expect(loadProvisional("nobody")).toEqual({ cleared: [] });
  });

  it("is idempotent — a repeat clear does not duplicate", () => {
    markProvisionalClear("user-a", "Science", 2);
    markProvisionalClear("user-a", "Science", 2);
    expect(loadProvisional("user-a").cleared).toHaveLength(1);
  });

  it("keeps users separate on a shared device", () => {
    markProvisionalClear("user-a", "Science", 2);
    markProvisionalClear("user-b", "History", 1);
    expect(loadProvisional("user-a").cleared).toEqual([{ world: "Science", level: 2 }]);
    expect(loadProvisional("user-b").cleared).toEqual([{ world: "History", level: 1 }]);
  });

  it("clearProvisional empties the store", () => {
    markProvisionalClear("user-a", "Science", 2);
    clearProvisional("user-a");
    expect(loadProvisional("user-a")).toEqual({ cleared: [] });
  });

  it("ignores malformed stored data", () => {
    localStorage.setItem("rot_royale_campaign_provisional:user-a", "{ not json");
    expect(loadProvisional("user-a")).toEqual({ cleared: [] });
    localStorage.setItem(
      "rot_royale_campaign_provisional:user-a",
      JSON.stringify({ cleared: [{ world: 1, level: "x" }] }),
    );
    expect(loadProvisional("user-a")).toEqual({ cleared: [] });
    localStorage.setItem("rot_royale_campaign_provisional:user-a", JSON.stringify({ cleared: "nope" }));
    expect(loadProvisional("user-a")).toEqual({ cleared: [] });
  });
});

describe("overlayLadder", () => {
  it("marks a provisional level cleared+pending and unlocks the next, spanning arcs", () => {
    const input = ladder();
    const snapshot = JSON.stringify(input);

    const out = overlayLadder(input, { cleared: [{ world: "Science", level: 2 }] });

    const science = out.worlds[0];
    const l2 = science.arcs[0].levels[1];
    const l3 = science.arcs[1].levels[0]; // next level lives in a different arc

    expect(l2.cleared).toBe(true);
    expect(l2.pending).toBe(true);
    expect(l3.unlocked).toBe(true);

    // Level 1 untouched (already cleared, no pending flag added).
    expect(science.arcs[0].levels[0].pending).toBeUndefined();

    // Input ladder is not mutated.
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(input.worlds[0].arcs[0].levels[1].cleared).toBe(false);
    expect(input.worlds[0].arcs[1].levels[0].unlocked).toBe(false);
  });

  it("does not leak provisional clears across worlds", () => {
    const out = overlayLadder(ladder(), { cleared: [{ world: "Science", level: 1 }] });
    // History level 1 must be untouched by a Science clear.
    expect(out.worlds[1].arcs[0].levels[0].pending).toBeUndefined();
  });

  it("returns an owned copy even with no provisional progress", () => {
    const input = ladder();
    const out = overlayLadder(input, { cleared: [] });
    expect(out).not.toBe(input);
    expect(out.worlds[0]).not.toBe(input.worlds[0]);
    expect(out).toEqual(input);
  });
});
