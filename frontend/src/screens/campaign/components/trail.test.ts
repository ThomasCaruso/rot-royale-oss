import { describe, expect, it } from "vitest";
import { perspectiveLayout, smoothPath } from "./trail";

describe("perspectiveLayout", () => {
  it("returns one entry per stop (and nothing for empty)", () => {
    expect(perspectiveLayout(0, 0)).toHaveLength(0);
    expect(perspectiveLayout(6, 2)).toHaveLength(6);
  });

  it("keeps every node within the safe horizontal band (no edge overflow)", () => {
    for (const [n, cur] of [
      [10, 0],
      [10, 4],
      [10, 9],
      [3, 1],
    ] as const) {
      for (const s of perspectiveLayout(n, cur)) {
        expect(s.xFrac).toBeGreaterThan(0.2);
        expect(s.xFrac).toBeLessThan(0.8);
      }
    }
  });

  it("converges toward centre at the far summit", () => {
    const stops = perspectiveLayout(10, 2);
    const top = stops[stops.length - 1];
    // The summit sits much closer to centre than the swing amplitude allows lower down.
    expect(Math.abs(top.xFrac - 0.5)).toBeLessThan(0.06);
  });

  it("recedes (shrinks) only ahead of the current mission, never behind it", () => {
    const stops = perspectiveLayout(10, 4);
    // At/behind current → full size.
    for (const s of stops.filter((x) => x.distAhead <= 0)) {
      expect(s.recedeScale).toBeCloseTo(1, 5);
    }
    // Ahead → monotonically smaller with distance, bounded below.
    const ahead = stops.filter((x) => x.distAhead > 0);
    for (let i = 1; i < ahead.length; i++) {
      expect(ahead[i].recedeScale).toBeLessThanOrEqual(ahead[i - 1].recedeScale + 1e-9);
    }
    expect(ahead[ahead.length - 1].recedeScale).toBeGreaterThan(0.8);
  });

  it("compresses vertical spacing with depth (foreground taller than distance)", () => {
    const stops = perspectiveLayout(10, 0);
    // gapAbove is defined for all but the topmost stop.
    const gaps = stops.slice(0, -1).map((s) => s.gapAbove);
    expect(gaps[0]).toBeGreaterThan(gaps[gaps.length - 1]); // near gap > far gap
    expect(stops[stops.length - 1].gapAbove).toBe(0);
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(116);
      expect(g).toBeLessThanOrEqual(150);
    }
  });

  it("clamps an out-of-range current index instead of throwing", () => {
    expect(() => perspectiveLayout(5, 99)).not.toThrow();
    const stops = perspectiveLayout(5, 99);
    // current clamped to last → nothing is 'ahead', so all full size.
    for (const s of stops) expect(s.recedeScale).toBeCloseTo(1, 5);
  });
});

describe("smoothPath", () => {
  it("is empty below two points and starts with a moveto otherwise", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 1, y: 2 }])).toBe("");
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
    expect(d.startsWith("M 0.0 0.0")).toBe(true);
    expect(d).toContain("C ");
  });
});
