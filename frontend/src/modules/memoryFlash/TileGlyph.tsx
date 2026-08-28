/**
 * The tile face component. Its data — the paths, the shape families, the count — lives in
 * glyphShapes.ts, because a module that exports both a component and constants breaks React
 * Fast Refresh (the whole module reloads and component state is lost on every edit).
 */
import { GLYPH_PATHS } from "@/modules/memoryFlash/glyphShapes";

/**
 * One tile face. `index` selects the shape; anything past the ninth wraps, so a server that raises
 * TILES beyond nine still renders rather than throwing — the same defensive shape as `tryGetModule`
 * (§7a1): a decoration must never be able to take the round down.
 */
export function TileGlyph({ index, lit }: { index: number; lit: boolean }) {
  const d = GLYPH_PATHS[index % GLYPH_PATHS.length];
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      style={{
        width: "42%",
        height: "42%",
        display: "block",
        // Unlit, the glyph is drawn IN the tile's own colour so the face is still identifiable at
        // rest. Lit, the tile floods with that colour and the glyph punches through in the panel
        // colour — a figure/ground flip, which reads faster than a brightness change.
        fill: lit ? "var(--panel)" : "var(--mem-tile)",
        transition: "fill 90ms",
      }}
    >
      <path d={d} fillRule="evenodd" />
    </svg>
  );
}
