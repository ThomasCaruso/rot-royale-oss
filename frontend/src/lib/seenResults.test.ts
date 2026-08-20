import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasSeenResult, markResultSeen, seenKey } from "@/lib/seenResults";

// A minimal in-memory Storage so these tests don't need jsdom (env is `node`).
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
  } as Storage;
}

describe("seenResults (per-device, composite userId:windowId keys)", () => {
  beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a result starts unseen and becomes seen after marking", () => {
    expect(hasSeenResult("user-a", "win-1")).toBe(false);
    markResultSeen("user-a", "win-1");
    expect(hasSeenResult("user-a", "win-1")).toBe(true);
  });

  it("keys are namespaced per user — one account's seen state never leaks to another", () => {
    markResultSeen("user-a", "win-1");
    expect(hasSeenResult("user-a", "win-1")).toBe(true);
    expect(hasSeenResult("user-b", "win-1")).toBe(false); // same window, different account
    expect(seenKey("user-a", "win-1")).toBe("user-a:win-1");
  });

  it("marking twice does not duplicate", () => {
    markResultSeen("user-a", "win-1");
    markResultSeen("user-a", "win-1");
    expect(JSON.parse(localStorage.getItem("rot_royale_seen_result_ids")!)).toEqual([
      "user-a:win-1",
    ]);
  });

  it("malformed storage is treated as empty, never throws", () => {
    localStorage.setItem("rot_royale_seen_result_ids", "{not json");
    expect(() => hasSeenResult("user-a", "win-1")).not.toThrow();
    expect(hasSeenResult("user-a", "win-1")).toBe(false);
  });

  it("fails safe when localStorage is unavailable (reads false, writes no-op, no throw)", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(hasSeenResult("user-a", "win-1")).toBe(false);
    expect(() => markResultSeen("user-a", "win-1")).not.toThrow();
  });
});
