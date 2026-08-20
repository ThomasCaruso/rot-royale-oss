import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, THEMES, getTheme } from "@/theme/tokens";
// Cross-side parity contract: same fixture the backend reads for frame/preset/theme id parity.
// One source of truth — if the backend catalog gains a theme, this assertion fails here too.
import cosmeticIds from "@/theme/cosmeticIds.json";

// Every theme must carry the full var contract — a missing var renders broken surfaces app-wide
// the moment the theme is equipped (tokens.ts header: every theme carries --brand/--brand-2/--faint).
const REQUIRED_VARS = [
  "--bg", "--panel", "--panel2", "--line", "--brand", "--brand-2",
  "--cyan", "--lime", "--amber", "--pink", "--text", "--muted", "--faint", "--btnText",
  // --glow: per-theme ambient glow tone (arcade neon vs soft daylight) — drives GlassCard + root aura.
  "--glow",
  // Shape/spacing/type contract (tokens.ts): every theme must carry these so switching themes never
  // leaves a stale radius/pad/font var behind (App.tsx sets vars per theme; it never clears).
  "--font-display", "--radius-card", "--pad-card", "--gap-shell", "--radius-ctl", "--radius-pill",
  // --brandText: text on --brand surfaces (Equip CTAs, answer letter badges) — white on the
  // classic themes, ink on the dark Blank (whose brand surface is white).
  "--brandText",
  // --sheen: the glass top-edge light-catch (specular inset), tuned per polarity by the mono skins.
  "--sheen",
  // --cta/--ctaText: the primary CTA surface + text (classic themes alias their gold; the mono
  // skins repaint it per polarity).
  "--cta", "--ctaText",
];

describe("theme tokens", () => {
  it("has unique ids and matches the cross-side cosmetic fixture exactly", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Assert set equality against the fixture (same length + same members).
    expect(ids.length).toBe(cosmeticIds.themes.length);
    expect(new Set(ids)).toEqual(new Set(cosmeticIds.themes));
  });

  it("every theme carries the full CSS var contract", () => {
    for (const theme of THEMES) {
      for (const key of REQUIRED_VARS) {
        expect(theme.vars[key], `${theme.id} missing ${key}`).toBeTruthy();
      }
    }
  });

  it("renamed the daylight theme so it cannot be confused with the Vault page", () => {
    expect(getTheme("daylight").name).toBe("Daylight");
    expect(THEMES.some((t) => t.name.toLowerCase() === "vault")).toBe(false);
  });

  it("falls back to the default theme for unknown ids", () => {
    expect(getTheme("nope").id).toBe(DEFAULT_THEME_ID);
  });
});
