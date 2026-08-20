import { useSessionStore } from "@/store/session";
import { DEFAULT_THEME_ID, getTheme, type ArtStyle, type ThemeArt } from "@/theme/tokens";

// Test-only override (see src/test/primeArcadeTheme.ts). Static-markup suites can't prime the
// zustand store for server rendering — react-dom/server reads zustand v5's getInitialState(),
// which lives on the store's INTERNAL api (the copy on the exported hook is unreachable from
// useStore). Never set outside tests.
let forcedStyle: ArtStyle | null = null;

/** @internal test hook — force the art style regardless of the session store. */
export function __setArtStyleForTests(style: ArtStyle | null): void {
  forcedStyle = style;
}

/**
 * The equipped theme's art style. Components with art-heavy arcade presentation (the Daily Royale
 * hero, Battle Mode card, header banner, hub tiles…) branch on this to render their ground-up MONO
 * variant — pure CSS: typography, hairlines and space, no bitmap art, no icon chrome. Everything
 * else reskins through tokens alone and never needs this.
 */
export function useArtStyle(): ArtStyle {
  const equipped = useSessionStore((s) => s.me?.equipped_theme);
  if (forcedStyle) return forcedStyle;
  return getTheme(equipped ?? DEFAULT_THEME_ID).style;
}

/**
 * The equipped theme's bitmap art set (the Starter crown/brain/shield), or null for the art-less
 * themes (the Blank pair). Mono-surface components use this to stage the Starter hero art; a null
 * keeps them on their pure-CSS presentation, so Blank stays untouched. When the test override
 * forces a style, art is suppressed too — the static-markup suites render the art-less variants.
 */
export function useThemeArt(): ThemeArt | null {
  const equipped = useSessionStore((s) => s.me?.equipped_theme);
  const style = useArtStyle();
  if (forcedStyle) return null;
  if (style !== "mono") return null;
  return getTheme(equipped ?? DEFAULT_THEME_ID).art ?? null;
}

/**
 * True on the Starter SYSTEM — the mono surface WITH the Starter art set (Starter + every skin of
 * it), i.e. the normal themes that get the premium reference screens. False for the art-less Blank
 * pair and for the arcade Rot Champion.
 *
 * Extracted because sibling components must agree on it: the Campaign container places the offline
 * download control based on this, while `CampaignWorlds` picks the hub — if the two conditions ever
 * drifted, the control would render twice or vanish.
 */
export function useStarterSystem(): boolean {
  return useThemeArt() != null;
}
