/**
 * HomeHeader tests — focused on the right-cluster coins pill + the brand lockup.
 *
 * Rendered with renderToStaticMarkup (SSR-safe, no DOM/JSDOM required) — the same pattern as
 * VaultScreen.test.tsx / LeaderboardScreen.test.tsx in this repo. useT() reads a default locale
 * from the i18n store, so no provider is needed.
 *
 * The brand lockup is the illustrated ROT ROYALE banner image; the mock header drops the standalone
 * Gem pill (the gem balance now lives on the Battle/Duel surfaces). The coins pill stays the one
 * interactive currency affordance — it opens the Vault.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeHeader } from "./HomeHeader";
import { primeArcadeTheme } from "@/test/primeArcadeTheme";

// These specs pin ARCADE presentation; the product default is now the mono blank_light skin.
primeArcadeTheme();

describe("HomeHeader — coins pill + wordmark", () => {
  it("renders the coins balance inside an interactive Vault button", () => {
    const html = renderToStaticMarkup(
      <HomeHeader coins={12450} onOpenMenu={() => {}} onOpenVault={() => {}} />,
    );
    // Coins are shown grouped (locale string) and the pill is a button (opens the Vault).
    expect(html).toContain("12,450");
    expect(html).toContain('type="button"');
  });

  it("shows the ROT ROYALE brand banner and no standalone Gems pill", () => {
    const html = renderToStaticMarkup(
      <HomeHeader coins={200} onOpenMenu={() => {}} onOpenVault={() => {}} />,
    );
    // The brand lockup is now the illustrated banner image (shield-R-crown + wordmark in one asset),
    // labelled for accessibility — it replaced the SVG skull + stacked ROT/ROYALE text.
    expect(html).toContain('alt="Rot Royale"');
    expect(html).toContain("rot-royale-banner");
    // The gem pill was removed from the header in the mock redesign.
    expect(html).not.toContain('aria-label="Gems"');
  });
});
