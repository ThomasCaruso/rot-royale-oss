import { describe, expect, it } from "vitest";
import {
  deriveHeroPhase,
  formatDuration,
  type HeroInput,
  isPodium,
  ordinalPlace,
  type RoyaleWindowLike,
  royaleTitleKey,
  slotTitle,
  windowProgress,
} from "@/lib/home";

describe("formatDuration", () => {
  it("formats hours and zero-padded minutes like the hero countdown", () => {
    expect(formatDuration(4 * 3600_000 + 3 * 60_000)).toBe("4h 03m");
    expect(formatDuration(12 * 3600_000 + 0)).toBe("12h 00m");
  });
  it("drops the hours below an hour", () => {
    expect(formatDuration(12 * 60_000)).toBe("12m");
    expect(formatDuration(59 * 60_000 + 59_000)).toBe("59m");
  });
  it("collapses to 'now' at or past zero", () => {
    expect(formatDuration(0)).toBe("now");
    expect(formatDuration(-5000)).toBe("now");
  });
});

describe("ordinalPlace", () => {
  it("uses st/nd/rd/th correctly, including the teens exception", () => {
    expect(ordinalPlace(1)).toBe("1st");
    expect(ordinalPlace(2)).toBe("2nd");
    expect(ordinalPlace(3)).toBe("3rd");
    expect(ordinalPlace(4)).toBe("4th");
    expect(ordinalPlace(11)).toBe("11th");
    expect(ordinalPlace(12)).toBe("12th");
    expect(ordinalPlace(21)).toBe("21st");
    expect(ordinalPlace(23)).toBe("23rd");
  });
});

describe("slotTitle", () => {
  it("maps the royale slot to the Daily Royale, never relabelling legacy slots", () => {
    expect(slotTitle("royale")).toBe("Daily Royale");
    expect(slotTitle("night")).toBe("Legacy Night Game");
    expect(slotTitle("midday")).toBe("Legacy Midday Game");
    expect(slotTitle("morning")).toBe("Legacy Morning Game");
  });
  it("falls back to a truthful past-ranked label for an unknown slot", () => {
    expect(slotTitle("weekend")).toBe("Past Ranked Game");
  });
});

describe("royaleTitleKey", () => {
  it("keys royale → Daily Royale, legacy slots → legacy labels, else past-ranked", () => {
    expect(royaleTitleKey("royale")).toBe("royaleTitle");
    expect(royaleTitleKey("morning")).toBe("legacyMorning");
    expect(royaleTitleKey("midday")).toBe("legacyMidday");
    expect(royaleTitleKey("night")).toBe("legacyNight");
    expect(royaleTitleKey("weekend")).toBe("pastRanked");
    expect(royaleTitleKey("")).toBe("pastRanked");
  });
});

describe("deriveHeroPhase", () => {
  const win = (state: string, over: Partial<RoyaleWindowLike> = {}): RoyaleWindowLike => ({
    id: "w1",
    slot: "royale",
    state,
    // Illustrative instants for the phase logic (open < close < settle); the Daily Royale runs a
    // full 24h, midnight-to-midnight ET, and settles 15 min after close.
    open_at: "2026-06-10T04:00:00Z",
    close_at: "2026-06-11T00:00:00Z",
    settle_at: "2026-06-11T00:15:00Z",
    ...over,
  });
  const input = (over: Partial<HeroInput>): HeroInput => ({
    loading: false,
    activeRoyale: null,
    entered: false,
    hasResult: false,
    resultSeen: false,
    nowMs: Date.parse("2026-06-10T16:00:00Z"),
    ...over,
  });

  it("A before: a scheduled royale, none open → before", () => {
    expect(deriveHeroPhase(input({ activeRoyale: null }))).toBe("before");
  });
  it("B live: OPEN and not entered → live", () => {
    expect(deriveHeroPhase(input({ activeRoyale: win("OPEN"), entered: false }))).toBe("live");
  });
  it("C locked: OPEN and entered → locked", () => {
    expect(deriveHeroPhase(input({ activeRoyale: win("OPEN"), entered: true }))).toBe("locked");
  });
  it("D settling: CLOSED before settle_at → settling", () => {
    const now = Date.parse("2026-06-11T00:05:00Z"); // between close and settle
    expect(deriveHeroPhase(input({ activeRoyale: win("CLOSED"), nowMs: now }))).toBe("settling");
  });
  it("D→still settling: CLOSED past settle but the result hasn't landed yet", () => {
    const now = Date.parse("2026-06-11T00:20:00Z");
    expect(
      deriveHeroPhase(input({ activeRoyale: win("CLOSED"), nowMs: now, hasResult: false })),
    ).toBe("settling");
  });
  it("E ready: settled with an unseen result → ready", () => {
    expect(
      deriveHeroPhase(
        input({ activeRoyale: win("SETTLED"), hasResult: true, resultSeen: false }),
      ),
    ).toBe("ready");
    // Also from a CLOSED window past settle once the result is available + unseen.
    const now = Date.parse("2026-06-11T00:20:00Z");
    expect(
      deriveHeroPhase(
        input({ activeRoyale: win("CLOSED"), nowMs: now, hasResult: true, resultSeen: false }),
      ),
    ).toBe("ready");
  });
  it("F viewed: settled with a seen result → viewed", () => {
    expect(
      deriveHeroPhase(input({ activeRoyale: win("SETTLED"), hasResult: true, resultSeen: true })),
    ).toBe("viewed");
  });
  it("E/F also resolve with no active window (between days)", () => {
    expect(deriveHeroPhase(input({ hasResult: true, resultSeen: false }))).toBe("ready");
    expect(deriveHeroPhase(input({ hasResult: true, resultSeen: true }))).toBe("viewed");
  });
  it("loading dominates", () => {
    expect(deriveHeroPhase(input({ loading: true, activeRoyale: win("OPEN") }))).toBe("loading");
  });
});

describe("windowProgress", () => {
  const open = "2026-06-08T20:00:00Z";
  const close = "2026-06-09T00:00:00Z"; // 4h window
  it("is the elapsed fraction of the window", () => {
    expect(windowProgress(open, close, Date.parse("2026-06-08T21:00:00Z"))).toBeCloseTo(0.25);
    expect(windowProgress(open, close, Date.parse("2026-06-08T23:00:00Z"))).toBeCloseTo(0.75);
  });
  it("clamps to [0, 1] outside the window", () => {
    expect(windowProgress(open, close, Date.parse("2026-06-08T19:00:00Z"))).toBe(0);
    expect(windowProgress(open, close, Date.parse("2026-06-09T02:00:00Z"))).toBe(1);
  });
});

describe("isPodium", () => {
  it("is true only for a real top-3 placement", () => {
    expect(isPodium(1)).toBe(true);
    expect(isPodium(3)).toBe(true);
    expect(isPodium(4)).toBe(false);
    expect(isPodium(null)).toBe(false);
  });
});
