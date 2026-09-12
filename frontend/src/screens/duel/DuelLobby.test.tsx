/**
 * DuelLobby tests — SSR renderToStaticMarkup convention (matches VaultScreen.test.tsx). The config is
 * passed directly (no api call needed for the static render); `initialStake` drives the entry-chip
 * selection since a static render can't click. Pins the stakes-first contract: ONE arena card with
 * the face-off scene, every real server tier as a compact entry chip (0 = the open/training tier,
 * selected by default → START DUEL), Gem entries as the same selector (helper + DUEL FOR X GEMS),
 * locked = dimmed chip, unaffordable = disabled CTA + soft earn hint — and no free-vs-paid framing
 * ("Free"/"Training" never appear as the emotional frame). Copy stays honesty-guard clean.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DuelConfigResponse, DuelStatsResponse } from "@/api/client";
import { en } from "@/i18n/en";
import { fmt } from "@/i18n";
import { findBannedTerms } from "@/i18n/copyGuard";
import { DuelLobby } from "./DuelLobby";

const CONFIG: DuelConfigResponse = {
  gems_balance: 4,
  bot_gem_cap: 5,
  bot_gem_used: 2,
  tiers: [
    { type: "training", entry_gems: 0, pool_gems: 0, unlocked: true, unlock_wins: 0 },
    { type: "spark", entry_gems: 1, pool_gems: 2, unlocked: true, unlock_wins: 0 },
    { type: "crown", entry_gems: 3, pool_gems: 6, unlocked: true, unlock_wins: 0 },
    { type: "royal", entry_gems: 5, pool_gems: 9, unlocked: false, unlock_wins: 10 },
  ],
};

const STATS: DuelStatsResponse = {
  wins: 5,
  losses: 3,
  training_wins: 7,
  training_losses: 5,
  current_streak: 4,
  best_streak: 6,
  perfect_wins: 1,
  comeback_wins: 0,
  total_gems_won: 10,
  total_gems_lost: 4,
  duel_xp: 120,
  duel_tier: "silver",
};

function render(over: Partial<DuelConfigResponse> = {}, stake?: string, stats: DuelStatsResponse | null = null) {
  return renderToStaticMarkup(
    <DuelLobby config={{ ...CONFIG, ...over }} stats={stats} onSelectTier={() => {}} onBack={() => {}} initialStake={stake} />,
  );
}

describe("DuelLobby", () => {
  it("defaults to the 0-Gem OPEN DUEL with the Start Duel CTA — stakes framing, not free-vs-paid", () => {
    const html = render();
    expect(html).toContain(en.duel.openDuel);
    expect(html).toContain(en.duel.duelTagline);
    expect(html).toContain(en.duel.start); // "Start Duel"
    expect(html).toContain(en.duel.noGemsLine); // quiet helper, not a FREE badge
    expect(html).not.toContain(en.duel.tierTraining); // "Training" never surfaces here
  });

  it("shows the Gem balance and every server tier as an entry chip on one screen", () => {
    const html = render();
    expect(html).toContain("4"); // balance
    for (const n of ["0", "1", "3", "5"]) expect(html).toContain(`>${n}<`); // the chips
  });

  it("a Gem entry shows the entry/pool helper and the DUEL FOR X GEMS CTA", () => {
    const html = render({}, "crown");
    expect(html).toContain(en.duel.entry);
    expect(html).toContain(en.duel.pool);
    expect(html).toContain(fmt(en.duel.duelForGems, { n: 3 }));
  });

  it("a 1-Gem entry uses the singular CTA", () => {
    expect(render({}, "spark")).toContain(en.duel.duelForGemsOne);
  });

  it("renders a locked tier as a dimmed LOCKED chip, not a big locked card", () => {
    expect(render()).toContain(en.duel.locked); // royal chip's tiny label
  });

  it("an unaffordable entry disables the CTA with the soft earn hint", () => {
    const html = render({ gems_balance: 1 }, "crown"); // 1 < 3
    expect(html).toContain(en.duel.earnGemsHint); // "Win Open Duels to earn Gems."
    expect(html).toContain("disabled");
  });

  it("puts the lifetime record and a live streak ON THE LINE when stats are present", () => {
    const html = render({}, undefined, STATS);
    expect(html).toContain(fmt(en.duel.recordLine, { w: 12, l: 8 })); // ranked + open combined
    expect(html).toContain(fmt(en.duel.streakOnLine, { n: 4 }));
  });

  it("hides the streak line when there is no streak to lose (and degrades without stats)", () => {
    const cold = render({}, undefined, { ...STATS, current_streak: 1 });
    expect(cold).not.toContain(fmt(en.duel.streakOnLine, { n: 1 })); // a 1-win "streak" isn't one
    expect(render()).not.toContain(en.duel.streakOnLine.split("{n}")[1]); // no stats → no line
  });

  it("shows the attrition line under the pips", () => {
    expect(render()).toContain(en.duel.attritionLine);
  });

  it("drops the pool between the rivals only when Gems are on the line", () => {
    // The pool pill shows the pool value inside the centre column (6 for crown).
    const gems = render({}, "crown");
    expect(gems).toContain(">6<");
    const open = render();
    expect(open).not.toContain(">6<");
  });

  it("contains no banned (money/gambling/wagering) words at 0 and Gem entries", () => {
    expect(findBannedTerms(render({}, undefined, STATS)), "banned word in DuelLobby (open)").toEqual([]);
    expect(findBannedTerms(render({}, "crown", STATS)), "banned word in DuelLobby (gems)").toEqual([]);
  });

  it("wires the player's pfp into the YOU medallion, with the rival left an honest mystery", () => {
    // NOTE: under renderToStaticMarkup the zustand session store returns its initial (null) snapshot
    // — zustand v5's server snapshot is the initial state — so `me` is null here and the arena takes
    // the non-Rot-Royale path with the default "knight" preset. That still proves the wiring: YOU now
    // renders the player's avatar portrait and the mystery rival renders none. The theme-gated swap
    // itself (founder art when equipped_theme === "royale") is covered directly in BattleAvatar.test.
    const html = render();
    expect(html).toContain("/avatars/portraits/knight.webp?v=2"); // YOU shows a real pfp portrait (default preset)
    expect(html.split("/avatars/").length - 1).toBe(1); // exactly one portrait — the rival has none
    expect(html).toContain(en.duel.cardRival);
  });
});
