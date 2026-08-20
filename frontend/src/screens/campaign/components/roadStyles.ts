// Pure form resolvers for the campaign roadmap engine (kept side-effect-free + unit-tested).
//
// The road GEOMETRY (perspective layout + bezier) lives in trail.ts and is identical for every world.
// This file resolves the per-world *styling* of that road from the theme's `road` form selector, so a
// world differs in FORM (orbital track vs stone trail vs stadium lanes…), not just accent colour.
//
// Convention (DESIGN §7): gold = progress. The LIT (travelled) segment is gold in every world for a
// consistent reward language; only the untravelled BASE road takes the world accent + per-style dash.

import type { NodeFrame, RoadStyle } from "@/lib/campaign";

export interface RoadStroke {
  color: string; // any CSS colour: hex, var(), or color-mix() — accepts a per-world hex accent OR a token
  width: number;
  dash?: string; // SVG strokeDasharray
  glow?: number; // px drop-shadow blur (omitted/0 = no glow)
  cap?: "round" | "butt";
  /** Marching-dash animation: the dash PERIOD in px (dash + gap). The renderer drifts
   * stroke-dashoffset by whole periods so the loop is seamless; collapses under reduced motion. */
  flow?: number;
}

export interface RoadSpec {
  base: RoadStroke[]; // untravelled road, painted back→front (world accent + per-style dash)
  lit: RoadStroke[]; // travelled segment, painted over base (gold — same in every world)
}

const mix = (accent: string, pct: number) => `color-mix(in srgb, ${accent} ${pct}%, transparent)`;
const tint = (accent: string, pct: number) => `color-mix(in srgb, ${accent} ${pct}%, white)`;

/** Gold "you have travelled this" segment — identical across worlds (gold = progress, design rule).
 * Layered like a lit rail: warm halo → deep gold bed → bright gold surface → a white-hot marching
 * core drifting along the travelled route. */
function litStrokes(): RoadStroke[] {
  return [
    { color: "color-mix(in srgb, var(--amber) 38%, transparent)", width: 16, cap: "round", glow: 6 },
    { color: "color-mix(in srgb, var(--amber) 55%, #7a4a00)", width: 9, cap: "round" },
    { color: "color-mix(in srgb, var(--amber) 85%, white)", width: 6, cap: "round" },
    { color: "#fff", width: 2.6, dash: "0.1 14", cap: "round", glow: 5, flow: 14.1 },
  ];
}

/**
 * The layered stroke recipe for a world's road. Each style is visually distinct in dash pattern,
 * width and glow so worlds read as different routes — Science's luminous dotted orbital track is not
 * History's long stone-dashed trail or Sports' lane markings. `accent` may be a hex or a CSS var.
 */
export function roadSpec(style: RoadStyle, accent: string): RoadSpec {
  switch (style) {
    case "orbital": // Science — a beveled orbital track: wide glow halo, a LIGHT edge rim under a
      // darker bed (the 1.5px bevel), an inner groove, then a bright dotted electron centreline
      // drifting along the route
      return {
        base: [
          { color: mix(accent, 30), width: 24, cap: "round", glow: 10 },
          { color: tint(accent, 42), width: 16.5, cap: "round" },
          { color: `color-mix(in srgb, ${accent} 48%, #0e0a26)`, width: 13, cap: "round" },
          { color: "color-mix(in srgb, var(--panel) 92%, black)", width: 6.5, cap: "round" },
          { color: tint(accent, 90), width: 3.5, dash: "0.1 13", cap: "round", glow: 5, flow: 13.1 },
        ],
        lit: litStrokes(),
      };
    case "trail": // History — ancient stone trail: bronze bevel rim, dark bed, long stone dashes
      return {
        base: [
          { color: mix(accent, 26), width: 16, cap: "round" },
          { color: tint(accent, 40), width: 11.5, cap: "round" },
          { color: "color-mix(in srgb, var(--panel) 85%, black)", width: 9, cap: "round" },
          { color: tint(accent, 76), width: 5.5, dash: "7 11", cap: "round" },
        ],
        lit: litStrokes(),
      };
    case "lanes": // Sports — track lanes: thick accent rail, lane bevel, dashed white centre marking
      return {
        base: [
          { color: mix(accent, 40), width: 18, cap: "butt" },
          { color: tint(accent, 38), width: 12, cap: "butt" },
          { color: "color-mix(in srgb, var(--panel) 88%, black)", width: 9.5, cap: "butt" },
          { color: "rgba(255,255,255,.75)", width: 3, dash: "16 14", cap: "butt" },
        ],
        lit: litStrokes(),
      };
    case "expedition": // Geography — dotted map route, like a travel line crossing an atlas
      return {
        base: [
          { color: mix(accent, 24), width: 14, cap: "round" },
          { color: tint(accent, 80), width: 5, dash: "2 12", cap: "round" },
        ],
        lit: litStrokes(),
      };
    case "marquee": // Entertainment — neon ribbon: lit rim over the dark ribbon, marching bulbs
      return {
        base: [
          { color: mix(accent, 36), width: 17, cap: "round", glow: 9 },
          { color: tint(accent, 46), width: 11.5, cap: "round" },
          { color: "color-mix(in srgb, var(--panel) 85%, black)", width: 8.5, cap: "round" },
          { color: tint(accent, 88), width: 4.5, dash: "0.1 18", cap: "round", glow: 7, flow: 18.1 },
        ],
        lit: litStrokes(),
      };
    case "ribbon": // Arts — continuous flowing ink ribbon (no dashes; one inked line, beveled)
    default:
      return {
        base: [
          { color: mix(accent, 28), width: 16, cap: "round", glow: 5 },
          { color: tint(accent, 44), width: 11, cap: "round" },
          { color: "color-mix(in srgb, var(--panel) 85%, black)", width: 8.5, cap: "round" },
          { color: tint(accent, 80), width: 4.5, cap: "round" },
        ],
        lit: litStrokes(),
      };
  }
}

// --- Node frame forms -------------------------------------------------------------------------

/** How a mission node's frame is decorated for a world (the disc + state styling stay shared). */
export interface NodeFrameSpec {
  /** an electron-style orbit ring sweeping around the disc (Science signature) */
  orbit: boolean;
  /** extra concentric ring just outside the disc border (stone seal / ornate tome) */
  halo: boolean;
  /** small marker ticks around the disc (compass N/E/S/W, lane chevrons) */
  ticks: 0 | 3 | 4;
  /** marquee bulbs around the disc (Entertainment) */
  bulbs: boolean;
}

const NODE_FRAMES: Record<NodeFrame, NodeFrameSpec> = {
  orbit: { orbit: true, halo: false, ticks: 0, bulbs: false }, // Science
  seal: { orbit: false, halo: true, ticks: 0, bulbs: false }, // History
  lane: { orbit: false, halo: false, ticks: 3, bulbs: false }, // Sports
  compass: { orbit: false, halo: false, ticks: 4, bulbs: false }, // Geography
  spotlight: { orbit: false, halo: false, ticks: 0, bulbs: true }, // Entertainment
  tome: { orbit: false, halo: true, ticks: 0, bulbs: false }, // Arts
};

export function nodeFrameSpec(frame: NodeFrame): NodeFrameSpec {
  return NODE_FRAMES[frame] ?? NODE_FRAMES.orbit;
}
