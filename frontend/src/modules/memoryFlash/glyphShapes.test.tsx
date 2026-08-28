// @vitest-environment jsdom
/**
 * The tile faces.
 *
 * A MEASUREMENT decided the palette. Deriving the tiles from each theme's accent tokens was tried
 * and pulled: across all eleven themes, EVERY one produced an orthogonally-adjacent pair at
 * near-zero hue separation, six of them at exactly 0.0, because theme accents are chosen to
 * harmonise and several are deliberate hue-siblings. Harmony is the wrong goal here — the colours
 * ARE the game state, so two tiles that look alike is a fairness bug.
 *
 * The palette is therefore fixed and evenly spaced, and shape backs it up as a second channel so
 * neither has to carry the round alone. The checkerboard is what makes the shape guarantee hold by
 * construction rather than by someone eyeballing the grid.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  GLYPH_FAMILY,
  TILE_COLORS,
  TILE_GLYPH_COUNT,
} from "@/modules/memoryFlash/glyphShapes";
import { TileGlyph } from "@/modules/memoryFlash/TileGlyph";

/** Orthogonal neighbours in a row-major 3x2. */
const ADJACENT: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [3, 4], [4, 5], // rows
  [0, 3], [1, 4], [2, 5], // columns
];

describe("tile glyphs", () => {
  it("provides one glyph and one colour per tile of the 3x2", () => {
    expect(TILE_GLYPH_COUNT).toBe(6);
    expect(GLYPH_FAMILY).toHaveLength(6);
    expect(TILE_COLORS).toHaveLength(6);
  });

  it("no two ADJACENT tiles are in the same shape family", () => {
    // The property the whole layout exists for. A diamond beside a square, or a circle beside a
    // ring, is where a fast tap goes wrong — and a wrong tap now ends the round outright.
    for (const [a, b] of ADJACENT) {
      expect(GLYPH_FAMILY[a], `tiles ${a} and ${b} share a family`).not.toBe(GLYPH_FAMILY[b]);
    }
  });

  it("confusable families sit in the same 3x3 parity class, which is WHY the above holds", () => {
    // In a 3x2, cells {0,2,4} are never orthogonally adjacent to each other, nor are {1,3,5}.
    // Keeping both members of a family inside one class makes adjacency impossible by construction.
    // If this fails, the test above may still pass by luck — and would quietly stop protecting
    // anything.
    const parityOf = new Map<string, Set<number>>();
    GLYPH_FAMILY.forEach((fam, i) => {
      if (!parityOf.has(fam)) parityOf.set(fam, new Set());
      parityOf.get(fam)!.add(i % 2);
    });
    for (const [fam, parities] of parityOf) {
      expect(parities.size, `family "${fam}" straddles both parity classes`).toBe(1);
    }
  });

  it("every glyph renders a path, and an out-of-range index wraps instead of throwing", () => {
    // A decoration must never be able to take the round down if the server raises the tile count
    // (§7a1's tryGetModule discipline, applied to art).
    for (let i = 0; i < TILE_GLYPH_COUNT + 3; i++) {
      const { container } = render(<TileGlyph index={i} lit={false} />);
      expect(container.querySelector("path")?.getAttribute("d")).toBeTruthy();
    }
  });

  it("the glyph flips to the panel colour when lit, so the tile reads as figure/ground", () => {
    const rest = render(<TileGlyph index={0} lit={false} />);
    const lit = render(<TileGlyph index={0} lit />);
    expect(rest.container.querySelector("svg")?.getAttribute("style")).toContain("var(--mem-tile)");
    expect(lit.container.querySelector("svg")?.getAttribute("style")).toContain("var(--panel)");
  });
});
