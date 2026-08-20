/**
 * DuelStatsSection tests — SSR renderToStaticMarkup of the extracted presentational component
 * (matches the DuelResult/DuelLobby convention). The component is pure (takes a `stats` prop), so we
 * test it directly rather than driving the ProfileMenu mount effect, which never runs under SSR.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DuelStatsResponse } from "@/api/client";
import { en } from "@/i18n/en";
import { fmt } from "@/i18n";
import { findBannedTerms } from "@/i18n/copyGuard";

import { DuelStatsSection } from "./ProfileMenu";

function base(over: Partial<DuelStatsResponse> = {}): DuelStatsResponse {
  return {
    wins: 12,
    losses: 5,
    training_wins: 3,
    training_losses: 1,
    current_streak: 4,
    best_streak: 9,
    perfect_wins: 2,
    comeback_wins: 1,
    total_gems_won: 340,
    total_gems_lost: 80,
    duel_xp: 1200,
    duel_tier: "silver",
    ...over,
  };
}

function render(over: Partial<DuelStatsResponse> = {}) {
  return renderToStaticMarkup(<DuelStatsSection stats={base(over)} />);
}

describe("DuelStatsSection", () => {
  it("renders the duel tier label", () => {
    expect(render({ duel_tier: "silver" })).toContain(en.duel.duelTier.silver);
    expect(render({ duel_tier: "gold" })).toContain(en.duel.duelTier.gold);
  });

  it("renders the W–L record", () => {
    const html = render({ wins: 12, losses: 5 });
    expect(html).toContain(fmt(en.duel.recordValue, { w: 12, l: 5 }));
  });

  it("renders the current and best streak", () => {
    const html = render({ current_streak: 4, best_streak: 9 });
    expect(html).toContain(">4<");
    expect(html).toContain("/9");
  });

  it("renders the gems-won value", () => {
    const html = render({ total_gems_won: 340 });
    expect(html).toContain(">340<");
    expect(html).toContain(en.duel.gemsWon);
  });

  it("renders fine for a brand-new (all-zeros) duelist as Bronze · 0W · 0L", () => {
    const html = render({
      wins: 0,
      losses: 0,
      current_streak: 0,
      best_streak: 0,
      total_gems_won: 0,
      duel_tier: "bronze",
    });
    expect(html).toContain(en.duel.duelTier.bronze);
    expect(html).toContain(fmt(en.duel.recordValue, { w: 0, l: 0 }));
  });

  it("falls back to Bronze for an unknown tier without crashing", () => {
    expect(render({ duel_tier: "mythic" })).toContain(en.duel.duelTier.bronze);
  });

  it("contains no banned (money/gambling/wagering) words", () => {
    expect(findBannedTerms(render()), "banned word in DuelStatsSection").toEqual([]);
  });
});
