import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { NextUnlock } from "@/api/client";
import { findBannedTerms } from "@/i18n/copyGuard";
import { NextUnlockCard } from "@/screens/home/NextUnlockCard";

const GEM_GOAL: NextUnlock = {
  id: "crown_duel_frame",
  kind: "frame",
  cost: 60,
  currency: "gems",
  balance: 38,
  remaining: 22,
  progress: 38 / 60,
};

describe("NextUnlockCard", () => {
  it("shows the eyebrow, the cosmetic name, the cost, and the remaining-to-go", () => {
    const out = renderToStaticMarkup(<NextUnlockCard unlock={GEM_GOAL} onOpenVault={() => {}} />);
    expect(out).toContain("Next unlock");
    expect(out).toContain("Crown Duelist"); // resolved frame name
    expect(out).toContain("60");
    expect(out).toContain("22 gems to go");
  });
  it("shows the ready state when affordable", () => {
    const out = renderToStaticMarkup(
      <NextUnlockCard unlock={{ ...GEM_GOAL, remaining: 0, progress: 1 }} onOpenVault={() => {}} />,
    );
    expect(out).toContain("Ready to unlock");
  });
  it("is copy-guard clean", () => {
    expect(
      findBannedTerms(renderToStaticMarkup(<NextUnlockCard unlock={GEM_GOAL} onOpenVault={() => {}} />)),
    ).toEqual([]);
  });
});
