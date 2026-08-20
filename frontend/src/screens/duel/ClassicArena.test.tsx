/**
 * ClassicArena (the Rot Royale founder skin) — a smoke render. The DuelLobby SSR tests only reach
 * MinimalArena (zustand's server snapshot has no equipped theme), so this renders the classic skin
 * directly with a minimal prop bundle to guard that the original rich arena still mounts and shows
 * its core beats (Open Duel, the gold VS mark, the Start CTA).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DuelConfigResponse } from "@/api/client";
import { en } from "@/i18n/en";
import { ClassicArena } from "./ClassicArena";
import type { ArenaViewProps } from "./DuelLobby";

const config: DuelConfigResponse = {
  gems_balance: 4,
  bot_gem_cap: 3,
  bot_gem_used: 0,
  tiers: [
    { type: "training", entry_gems: 0, pool_gems: 0, unlocked: true, unlock_wins: 0 },
    { type: "spark", entry_gems: 1, pool_gems: 2, unlocked: true, unlock_wins: 0 },
  ],
};

const props: ArenaViewProps = {
  config,
  t: en,
  reduced: true,
  tiers: config.tiers,
  selType: "training",
  setSelType: () => {},
  sel: config.tiers[0],
  openEntry: true,
  unaffordable: false,
  startable: true,
  heat: 0,
  record: undefined,
  streak: 0,
  username: "Ada",
  avatarPreset: "knight",
  equippedFrame: null,
  ctaLabel: en.duel.start,
  onSelectTier: () => {},
  onBack: () => {},
  showRules: false,
  setShowRules: () => {},
};

describe("ClassicArena (Rot Royale skin)", () => {
  it("renders the original rich arena — Open Duel, the gold VS mark, and the Start CTA", () => {
    const html = renderToStaticMarkup(<ClassicArena {...props} />);
    expect(html).toContain(en.duel.openDuel);
    expect(html).toContain(en.duel.start);
    expect(html).toContain("VS"); // the founder gold VS lettermark
  });
});
