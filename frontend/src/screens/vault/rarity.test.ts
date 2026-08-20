import { describe, expect, it } from "vitest";
import type { VaultItem } from "@/api/client";
import { compareByRarity, groupByRarity } from "./rarity";

function item(over: Partial<VaultItem>): VaultItem {
  return {
    id: "x",
    kind: "theme",
    cost: 0,
    currency: "coins",
    owned: false,
    equipped: false,
    locked: false,
    coming_soon: false,
    requirement: null,
    ...over,
  };
}

describe("Vault ordering — owned items rise to the top of their rarity tier", () => {
  it("within a tier, sorts equipped first, then owned, then the still-to-unlock rest", () => {
    const equipped = item({ id: "b_equipped", cost: 120, owned: true, equipped: true });
    const owned = item({ id: "a_owned", cost: 120, owned: true });
    const locked = item({ id: "c_locked", cost: 120, owned: false });
    const sorted = [locked, owned, equipped].slice().sort(compareByRarity);
    expect(sorted.map((i) => i.id)).toEqual(["b_equipped", "a_owned", "c_locked"]);
  });

  it("owned beats a CHEAPER unowned item within the same tier (ownership before price)", () => {
    const cheapLocked = item({ id: "cheap", cost: 60, owned: false }); // common tier
    const pricierOwned = item({ id: "owned", cost: 90, owned: true }); // common tier (<=90)
    const sorted = [cheapLocked, pricierOwned].slice().sort(compareByRarity);
    expect(sorted.map((i) => i.id)).toEqual(["owned", "cheap"]);
  });

  it("keeps the rarity tiers in easiest->hardest order — ownership only reorders WITHIN a tier", () => {
    const baseOwned = item({ id: "base_owned", cost: 0, owned: true }); // base tier
    const commonLocked = item({ id: "common_locked", cost: 60, owned: false }); // common tier
    const groups = groupByRarity([commonLocked, baseOwned]);
    expect(groups.map((g) => g.rarity)).toEqual(["base", "common"]);
    expect(groups[0].items[0].id).toBe("base_owned");
    expect(groups[1].items[0].id).toBe("common_locked");
  });
});
