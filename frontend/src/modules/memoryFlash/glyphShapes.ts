/**
 * The six tile faces: one distinct SHAPE each, over one distinct COLOUR each.
 *
 * TWO CHANNELS, DELIBERATELY. The grid was colour-only, and two of its six hexes were effectively
 * the same colour to a colour-blind player (#15a85f green vs #27c08a teal; #ff5a4d vs #ff9ad1). A
 * memory game you cannot play because two tiles look identical is not a hard round, it is a broken
 * one. Shape and colour now both carry identity, so either one alone is enough to tell tiles apart.
 *
 * INLINE SVG, NOT UNICODE OR EMOJI. This repo already learned it: commit 70ed0d5 replaced the
 * crown/coin emoji in the home header with deterministic inline SVG because platform emoji fonts
 * render at different weights, sizes and baselines. A glyph the player has to recognise in 380ms
 * cannot be at the mercy of which font the OS picked.
 */

/**
 * THE PALETTE IS FIXED, NOT DERIVED FROM THEME TOKENS — and that reverses an earlier attempt, for a
 * measured reason.
 *
 * Deriving the tiles from each theme's six accents was prettier in principle: every theme would skin
 * the grid for free. Measuring it across all eleven themes killed it. EVERY theme produced a pair of
 * tiles at near-zero hue separation, and six themes were at exactly 0.0 — the accents are chosen to
 * harmonise with one another, and several are deliberate hue-siblings (daylight's --lime and --brand
 * are the same hue). A palette that harmonises is the opposite of what a memory grid needs: here the
 * colours ARE the game state, and two tiles that look alike is a fairness bug, not a style note.
 *
 * So these six are spaced 60 degrees apart and each solved to the SAME relative luminance (0.220),
 * which is why none of them shouts louder than the others. A fixed lightness would make the yellow
 * glare and the blue vanish; equal luminance is what makes a six-hue set read as one family instead
 * of a rainbow. Contrast holds on both extremes of the catalog — 3.28:1 against the ivory Starter
 * panel and 4.44:1 against the dark Royale panel, so no theme gets a washed-out or a burning tile.
 */
export const TILE_COLORS: readonly string[] = [
  "#E24D4D", // 0   red
  "#A8791B", // 40  gold
  "#189618", // 120 green
  "#1B8DA4", // 190 teal
  "#8B6CE7", // 255 violet
  "#DE35C2", // 310 magenta
];

/**
 * Shape family per tile. Two glyphs in the same family are the ones a player can confuse under time
 * pressure — a diamond is a rotated square. Every other shape here is its own family, which is why
 * only one pair needs protecting.
 */
export const GLYPH_FAMILY: readonly string[] = [
  "quad", // 0 diamond
  "round", // 1 circle
  "quad", // 2 square
  "point", // 3 triangle
  "radial", // 4 cross
  "open", // 5 chevron
];

/**
 * The six shapes, in grid order.
 *
 * THE ORDER IS A CHECKERBOARD. In a 3x2, cells {0,2,4} are never orthogonally adjacent to each
 * other and neither are {1,3,5}; putting the one confusable pair (diamond, square) in the same
 * parity class makes them impossible to place side by side, by construction rather than by someone
 * eyeballing the grid. Asserted in the tests.
 */
export const GLYPH_PATHS: readonly string[] = [
  "M12 3 L21 12 L12 21 L3 12 Z", // 0 diamond
  "M12 12 m-8.5 0 a8.5 8.5 0 1 0 17 0 a8.5 8.5 0 1 0 -17 0", // 1 circle
  "M4.5 4.5 H19.5 V19.5 H4.5 Z", // 2 square
  "M12 3.5 L21 19.5 L3 19.5 Z", // 3 triangle
  "M9.5 3 H14.5 V9.5 H21 V14.5 H14.5 V21 H9.5 V14.5 H3 V9.5 H9.5 Z", // 4 cross
  "M3.5 8 L12 16.5 L20.5 8 L20.5 14 L12 22.5 L3.5 14 Z", // 5 chevron
];

export const TILE_GLYPH_COUNT = GLYPH_PATHS.length;

/** The tile's colour, wrapping if a server ever raises the tile count past the palette. */
export const toneFor = (index: number) => TILE_COLORS[index % TILE_COLORS.length];
