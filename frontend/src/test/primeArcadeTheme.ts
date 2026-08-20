import { useSessionStore, type Me } from "@/store/session";
import { __setArtStyleForTests } from "@/theme/useArtStyle";

/**
 * Test helper: pin the ARCADE (royale / "Rot Champion") skin for suites that assert arcade
 * presentation (gold discs, brand-gradient chips, emoji avatars, 3D pills…). The product default
 * is now the mono `blank_light`, so a store with no session resolves to the mono variants —
 * suites pinning arcade markup must opt in explicitly. Call at module top level (each vitest file
 * runs in its own worker, so the override never leaks across suites).
 *
 * Sets both the store (jsdom renders + any component reading `me` directly) and the art-style
 * override (static-markup renders, where react-dom/server reads zustand's initial state and the
 * primed current state is invisible).
 */
export function primeArcadeTheme(): void {
  useSessionStore.setState({ me: { equipped_theme: "royale" } as unknown as Me });
  __setArtStyleForTests("arcade");
}
