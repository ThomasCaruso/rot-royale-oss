// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { downloadCampaign, downloadPractice, isCampaignLevelCached } from "./content";
import { getPool } from "./db";

describe("offline content", () => {
  it("downloads a bundle and caches each level", async () => {
    const stub = async () => ({
      bank_version: "v1",
      levels: [{ world: "Science", level: 1, title: "S1", is_boss: false, seed: 1, rounds: [] }],
    });
    await downloadCampaign(stub);
    expect(await isCampaignLevelCached("Science", 1)).toBe(true);
  });

  it("downloads and caches a practice pool", async () => {
    const stub = async () => ({ category: null, bank_version: "v1", questions: [] });
    await downloadPractice(null, stub);
    const pool = await getPool(null);
    expect(pool?.bank_version).toBe("v1");
  });
});
