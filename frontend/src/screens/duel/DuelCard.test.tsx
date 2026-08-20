/**
 * DuelCard (Battle Mode) tests — SSR renderToStaticMarkup convention (matches VaultScreen.test.tsx).
 * No DOM/JSDOM required; the static render verifies the wordmark, the subtitle, the CTA copy contract,
 * and copy safety. The CTA is ALWAYS the exciting "Start Battle" — it never branches on the Gem
 * balance (the zero-Gem training path is explained on the Duel arena itself, not deflated onto the
 * Home card). The Gem balance itself is no longer shown on the card (it lives on the Duel arena).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { findBannedTerms } from "@/i18n/copyGuard";
import { DuelCard } from "./DuelCard";

describe("DuelCard — Battle Mode", () => {
  it("renders the Battle Mode wordmark and subtitle", () => {
    const html = renderToStaticMarkup(<DuelCard onDuel={() => {}} gems={50} />);
    // The title is a two-tone split (BATTLE / MODE), so assert each word.
    for (const word of en.duel.cardTitle.split(" ")) expect(html).toContain(word);
    expect(html).toContain(en.duel.cardSubtitle);
  });

  it("shows the Start Battle CTA when the player has Gems", () => {
    const html = renderToStaticMarkup(<DuelCard onDuel={() => {}} gems={120} />);
    expect(html).toContain(en.duel.cardCta); // "Start Battle"
  });

  it("keeps the same Start Battle CTA at zero Gems (no deflated training copy)", () => {
    const html = renderToStaticMarkup(<DuelCard onDuel={() => {}} gems={0} />);
    expect(html).toContain(en.duel.cardCta);
    expect(html).not.toContain("Training"); // no training framing anywhere on the Home card
  });

  it("contains no banned (money/gambling/wagering) words", () => {
    const html = renderToStaticMarkup(<DuelCard onDuel={() => {}} gems={0} />);
    expect(findBannedTerms(html), "banned word in DuelCard").toEqual([]);
  });
});
