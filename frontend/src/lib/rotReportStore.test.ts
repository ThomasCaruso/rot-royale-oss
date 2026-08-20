// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadRotReport, saveRotReport, type StoredRotReport } from "./rotReportStore";
import type { RotReportData } from "./rotReport";

const report: RotReportData = {
  score: 6,
  total: 8,
  incorrect: 2,
  avgMs: 5800,
  fastestMs: 3100,
  rounds: [true, true, false, true, true, false, true, true],
};

const stored = (over: Partial<StoredRotReport> = {}): StoredRotReport => ({
  windowId: "win-1",
  entryId: "entry-1",
  report,
  ...over,
});

describe("rotReportStore", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips the latest report for a user", () => {
    saveRotReport("user-a", stored());
    expect(loadRotReport("user-a")).toEqual(stored());
  });

  it("returns null when nothing is stored for the user", () => {
    expect(loadRotReport("nobody")).toBeNull();
  });

  it("keeps users separate on a shared device", () => {
    saveRotReport("user-a", stored({ entryId: "a" }));
    saveRotReport("user-b", stored({ entryId: "b" }));
    expect(loadRotReport("user-a")?.entryId).toBe("a");
    expect(loadRotReport("user-b")?.entryId).toBe("b");
  });

  it("overwrites the previous day's report (single slot)", () => {
    saveRotReport("user-a", stored({ windowId: "yesterday" }));
    saveRotReport("user-a", stored({ windowId: "today" }));
    expect(loadRotReport("user-a")?.windowId).toBe("today");
  });

  it("ignores malformed stored data", () => {
    localStorage.setItem("rot_royale_last_rot_report:user-a", "{ not json");
    expect(loadRotReport("user-a")).toBeNull();
    localStorage.setItem("rot_royale_last_rot_report:user-a", JSON.stringify({ windowId: 1 }));
    expect(loadRotReport("user-a")).toBeNull();
  });
});
