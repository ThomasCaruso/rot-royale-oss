import type { CSSProperties } from "react";
import type { Theme } from "@/theme/tokens";
import { PhoneFrame } from "@/screens/vault/PhoneFrame";
import { ThemeAppPreview } from "@/screens/vault/ThemeAppPreview";

/**
 * A theme's preview: a real screenshot of the app wearing it.
 *
 * These are captured from the running app (home screen — header lockup, the Daily Royale hero, the
 * feature rows) with each theme applied, then scaled to 300px wide. A screenshot beats the hand-built
 * mock it replaced because it is the truth by construction: it picks up the display FACE (Rot
 * Champion's Luckiest Guy vs Starter's Playfair), the real CTA treatment, the avatar and icon art,
 * the page background — everything a diagram of bars can only approximate, and everything that
 * silently goes stale the moment a screen is redesigned.
 *
 * To re-capture after a UI change: set `me.equipped_theme` in the session store (NOT just the CSS
 * vars — the art set and the card branch follow the equipped theme, and swapping variables alone
 * paints every theme in Starter's layout), scale the document so the full page height fits the
 * viewport, screenshot the app column, and re-run the resize. Worth redoing whenever the home
 * screen changes shape, since that is exactly when these stop being true.
 *
 * A theme with no shot falls back to the CSS mock, so a newly added theme is never a broken image.
 */
export function ThemeShot({ theme, width }: { theme: Theme; width: number }) {
  const src = SHOTS[theme.id];
  return (
    <PhoneFrame width={width}>
      {src ? (
        <img src={src} alt="" aria-hidden draggable={false} loading="lazy" decoding="async" style={shot} />
      ) : (
        // No capture for this theme yet — the CSS mock stands in, still inside the phone.
        <ThemeAppPreview theme={theme} height={Math.round(width / (390 / 844))} />
      )}
    </PhoneFrame>
  );
}

/** Explicit map rather than a template string, so a missing capture is a compile-visible gap in this
 *  list instead of a 404 at runtime. `?v=` follows the public/ cache-busting rule (see tokens.ts). */
const V = "?v=5"; // v3 — captured through Playwright at a true 390x844 device viewport. v1 swapped only CSS
                    // variables (so every theme wore Starter's layout); v2 was a desktop viewport at
                    // 430px, which wraps text differently from a phone. See
                    // scripts/capture-theme-previews.md before re-capturing.
const SHOTS: Record<string, string> = {
  starter: `/assets/themes/previews/starter.jpg${V}`,
  royale: `/assets/themes/previews/royale.jpg${V}`,
  daylight: `/assets/themes/previews/daylight.jpg${V}`,
  // v6 for bubblegum ALONE: it is the only theme whose hero plate changed (its own pink-lavender
  // repaint), so only its shot needed re-taking. The rest stay on v5.
  bubblegum: "/assets/themes/previews/bubblegum.jpg?v=6",
  forest: `/assets/themes/previews/forest.jpg${V}`,
  // v7 for midnight ALONE: its hero plate went dark (and the card ink flipped with it), so only
  // its shot needed re-taking. The rest stay on v5, bubblegum on v6.
  midnight: "/assets/themes/previews/midnight.jpg?v=7",
  // v8 for apex ALONE: it gained its own dark navy hero plate (and the card ink flipped with it),
  // so only its shot needed re-taking. The rest stay on v5, bubblegum on v6, midnight on v7.
  apex: "/assets/themes/previews/apex.jpg?v=8",
  // v11 for crown_arena: its ember hero plate was re-done (a fully-gold crown), so the shot was
  // re-taken — bumped past the earlier v9 since the file changed at the same URL. Rest on v5.
  crown_arena: "/assets/themes/previews/crown_arena.jpg?v=11",
  // v10 for champion ALONE: it gained its own garnet hero plate (and the card ink flipped with it),
  // so only its shot needed re-taking. The rest stay on v5, bubblegum v6, midnight v7, apex v8,
  // crown_arena v11.
  champion: "/assets/themes/previews/champion.jpg?v=10",
  blank: `/assets/themes/previews/blank.jpg${V}`,
  blank_light: `/assets/themes/previews/blank_light.jpg${V}`,
};

/** The shots are FULL-PAGE and the frame matches their aspect, so the whole screen shows — header
 *  through bottom nav — with nothing cropped. That is the point of the phone: at this size a crop
 *  would just look like a swatch. */
const shot: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "cover",
};
