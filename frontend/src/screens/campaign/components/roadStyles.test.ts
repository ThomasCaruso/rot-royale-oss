import { describe, expect, it } from "vitest";
import type { NodeFrame, RoadStyle } from "@/lib/campaign";
import { nodeFrameSpec, roadSpec } from "./roadStyles";

const STYLES: RoadStyle[] = ["orbital", "trail", "lanes", "expedition", "marquee", "ribbon"];
const FRAMES: NodeFrame[] = ["orbit", "seal", "lane", "compass", "spotlight", "tome"];

describe("roadSpec", () => {
  it("returns layered base + lit strokes for every road style", () => {
    for (const style of STYLES) {
      const spec = roadSpec(style, "#6E8BFF");
      expect(spec.base.length).toBeGreaterThanOrEqual(2);
      expect(spec.lit.length).toBeGreaterThanOrEqual(1);
      for (const s of [...spec.base, ...spec.lit]) {
        expect(s.width).toBeGreaterThan(0);
        expect(typeof s.color).toBe("string");
      }
    }
  });

  it("threads the world accent into the untravelled base road", () => {
    for (const style of STYLES) {
      const spec = roadSpec(style, "#ABCDEF");
      expect(spec.base.some((s) => s.color.includes("#ABCDEF"))).toBe(true);
    }
  });

  it("keeps the travelled (lit) segment gold in every world — gold = progress (design rule)", () => {
    for (const style of STYLES) {
      const spec = roadSpec(style, "#6E8BFF");
      expect(spec.lit.some((s) => s.color.includes("var(--amber)"))).toBe(true);
      // …and the lit segment never takes the per-world accent.
      expect(spec.lit.every((s) => !s.color.includes("#6E8BFF"))).toBe(true);
    }
  });

  it("gives each style a visually distinct base recipe (width + dash signature)", () => {
    const sig = (style: RoadStyle) =>
      roadSpec(style, "#000")
        .base.map((s) => `${s.width}|${s.dash ?? ""}|${s.glow ?? 0}`)
        .join(";");
    const signatures = STYLES.map(sig);
    expect(new Set(signatures).size).toBe(STYLES.length);
  });

  it("falls back to the ribbon recipe for an unknown style without throwing", () => {
    expect(() => roadSpec("nope" as RoadStyle, "#000")).not.toThrow();
    const spec = roadSpec("nope" as RoadStyle, "#000");
    expect(spec.base.length).toBeGreaterThan(0);
  });
});

describe("nodeFrameSpec", () => {
  it("maps each frame to a distinct decoration", () => {
    expect(nodeFrameSpec("orbit").orbit).toBe(true);
    expect(nodeFrameSpec("spotlight").bulbs).toBe(true);
    expect(nodeFrameSpec("compass").ticks).toBe(4);
    expect(nodeFrameSpec("lane").ticks).toBe(3);
    expect(nodeFrameSpec("seal").halo).toBe(true);
    expect(nodeFrameSpec("tome").halo).toBe(true);
  });

  it("returns a spec for every known frame and falls back for unknown", () => {
    for (const f of FRAMES) expect(nodeFrameSpec(f)).toBeTruthy();
    expect(nodeFrameSpec("nope" as NodeFrame)).toEqual(nodeFrameSpec("orbit"));
  });
});
