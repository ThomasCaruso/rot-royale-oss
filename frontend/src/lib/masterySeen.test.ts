// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { markMasterySeen, pendingLevelUps } from "./masterySeen";

describe("mastery level-up detection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns no level-ups before any baseline is recorded", () => {
    const leveled = pendingLevelUps("u1", [{ category: "Science & Nature", level: 2 }]);
    expect(leveled.size).toBe(0);
  });

  it("flags a category whose level rose since it was last marked seen", () => {
    markMasterySeen("u1", [{ category: "Science & Nature", level: 2 }]);
    const leveled = pendingLevelUps("u1", [{ category: "Science & Nature", level: 3 }]);
    expect(leveled.has("Science & Nature")).toBe(true);
    expect(leveled.size).toBe(1);
  });

  it("is read-only: repeated detection without marking keeps flagging (StrictMode-safe)", () => {
    markMasterySeen("u1", [{ category: "Geography", level: 1 }]);
    const items = [{ category: "Geography", level: 3 }];
    expect(pendingLevelUps("u1", items).has("Geography")).toBe(true);
    // called again WITHOUT markMasterySeen — the level-up must NOT have been consumed
    expect(pendingLevelUps("u1", items).has("Geography")).toBe(true);
  });

  it("does not flag a category at the same or lower level", () => {
    markMasterySeen("u1", [
      { category: "Science & Nature", level: 3 },
      { category: "History", level: 4 },
    ]);
    const leveled = pendingLevelUps("u1", [
      { category: "Science & Nature", level: 3 }, // same
      { category: "History", level: 2 }, // lower
    ]);
    expect(leveled.size).toBe(0);
  });

  it("keeps snapshots per-user (a new user gets a fresh baseline)", () => {
    markMasterySeen("u1", [{ category: "History", level: 1 }]);
    const leveled = pendingLevelUps("u2", [{ category: "History", level: 5 }]);
    expect(leveled.size).toBe(0); // u2's first look, no baseline
  });
});
