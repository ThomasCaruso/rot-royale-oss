/**
 * DuelResult tests — SSR renderToStaticMarkup convention (matches DuelLobby/Vault tests). `@/api/client`
 * is mocked so the on-mount `duelStats()` fetch never fires; SSR also doesn't run effects, so the
 * stats-enriched rows simply don't render in these static checks (the screen stands without them).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DuelResult as DuelResultData } from "@/api/client";
import { en } from "@/i18n/en";
import { fmt } from "@/i18n";
import { findBannedTerms } from "@/i18n/copyGuard";

vi.mock("@/api/client", () => ({
  api: { duelStats: () => new Promise(() => {}) },
}));

import { DuelResult } from "./DuelResult";

function base(over: Partial<DuelResultData> = {}): DuelResultData {
  return {
    winner: "user",
    result_reason: "first_to_4",
    user_round_wins: 4,
    rival_round_wins: 2,
    gem_delta: 36,
    xp_awarded: 50,
    perfect: false,
    comeback: false,
    duel_tier: "bronze",
    ...over,
  };
}

function render(over: Partial<DuelResultData> = {}) {
  return renderToStaticMarkup(
    <DuelResult result={base(over)} duelType="spark" onRunItBack={() => {}} onHome={() => {}} />,
  );
}

describe("DuelResult", () => {
  it("shows VICTORY for a win", () => {
    const html = render({ winner: "user" });
    expect(html).toContain(en.duel.victory);
    expect(html).not.toContain(en.duel.defeat);
  });

  it("shows DEFEAT for a loss", () => {
    const html = render({ winner: "rival", user_round_wins: 2, rival_round_wins: 4 });
    expect(html).toContain(en.duel.defeat);
    expect(html).not.toContain(en.duel.victory);
  });

  it("shows PERFECT DUEL when perfect && winner === user", () => {
    const html = render({ winner: "user", perfect: true });
    expect(html).toContain(en.duel.perfect);
    expect(html).toContain(en.duel.perfectBadge);
  });

  it("does NOT show PERFECT for a perfect flag on a loss", () => {
    const html = render({ winner: "rival", perfect: true, user_round_wins: 0, rival_round_wins: 4 });
    expect(html).toContain(en.duel.defeat);
    expect(html).not.toContain(en.duel.perfect);
  });

  it("shows the head-to-head scoreline", () => {
    const html = render({ user_round_wins: 4, rival_round_wins: 1 });
    expect(html).toContain(">4<");
    expect(html).toContain(">1<");
  });

  it("shows earned-Gem copy when gem_delta > 0", () => {
    const html = render({ gem_delta: 36 });
    expect(html).toContain(fmt(en.duel.gemsEarned, { n: 36 }));
  });

  it("shows lost-Gem copy when gem_delta < 0", () => {
    const html = render({ winner: "rival", gem_delta: -20, user_round_wins: 2, rival_round_wins: 4 });
    expect(html).toContain(fmt(en.duel.gemsLost, { n: 20 }));
  });

  it("shows the no-Gem-change copy when gem_delta === 0 (training)", () => {
    const html = render({ gem_delta: 0 });
    expect(html).toContain(en.duel.noGemChange);
  });

  it("renders the Run It Back primary CTA in all cases (win/loss/training)", () => {
    for (const over of [
      { winner: "user" as const },
      { winner: "rival" as const, user_round_wins: 1, rival_round_wins: 4 },
      { gem_delta: 0 },
    ]) {
      expect(render(over)).toContain(en.duel.runItBack);
    }
  });

  it("renders the Home secondary action", () => {
    expect(render()).toContain(en.duel.home);
  });

  it("shows close-loss copy for a 3–4 loss but not a 1–4 loss", () => {
    const close = render({ winner: "rival", user_round_wins: 3, rival_round_wins: 4 });
    expect(close).toContain(en.duel.closeLoss);
    const blowout = render({ winner: "rival", user_round_wins: 1, rival_round_wins: 4 });
    expect(blowout).not.toContain(en.duel.closeLoss);
  });

  it("shows the XP gain and duel tier", () => {
    const html = render({ xp_awarded: 50, duel_tier: "gold" });
    expect(html).toContain(fmt(en.duel.xpGain, { n: 50 }));
    expect(html).toContain(en.duel.duelTier.gold);
  });

  it("celebrates a comeback win with its own headline", () => {
    const html = render({ winner: "user", comeback: true });
    expect(html).toContain(en.duel.comeback);
  });

  it("contains no banned (money/gambling/wagering) words", () => {
    // Cover win, loss, and training (gem_delta 0) renders — every result branch must stay clean.
    for (const over of [
      { winner: "user" as const, gem_delta: 36 },
      { winner: "rival" as const, gem_delta: -20, user_round_wins: 2, rival_round_wins: 4 },
      { gem_delta: 0 },
    ]) {
      expect(findBannedTerms(render(over)), `banned word in DuelResult (${JSON.stringify(over)})`).toEqual([]);
    }
  });
});
