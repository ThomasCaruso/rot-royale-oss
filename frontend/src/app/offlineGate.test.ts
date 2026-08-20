import { describe, it, expect } from "vitest";
import { requiresOnline } from "./offlineGate";

describe("offlineGate", () => {
  it("gates ranked and social surfaces", () => {
    expect(requiresOnline("contest")).toBe(true);
    expect(requiresOnline("leaderboard")).toBe(true);
    expect(requiresOnline("duel")).toBe(true);
    expect(requiresOnline("friends")).toBe(true);
    expect(requiresOnline("campaign")).toBe(false);
    expect(requiresOnline("practice")).toBe(false);
    expect(requiresOnline("category")).toBe(false);
    expect(requiresOnline("growth")).toBe(false);
    expect(requiresOnline("vault")).toBe(false);
    expect(requiresOnline("home")).toBe(false);
  });
});
