import type { VaultItem } from "@/api/client";
import { getFrame } from "@/theme/identity";

/**
 * VISUAL rarity hierarchy for the Vault — purely client-side presentation so the shop reads as a
 * real game catalog (common → rare → prestige) instead of a flat list. It does NOT touch the
 * economy: prices stay server-authoritative (item.cost), and ordering/grouping is the only thing
 * derived here. Tiers are inferred from the catalog the player already sees:
 *
 *   base     — free defaults (cost 0): the starter theme/no-frame.
 *   common   — the entry paid tier (≤ 90 coins): first rings, first themes.
 *   rare     — mid paid tier (91–149 coins).
 *   epic     — top paid tier (≥ 150 coins) that is NOT the prestige unlock.
 *   prestige — the all-worlds trophy (FrameStyle.prestige) — earned, not merely bought.
 *   gem      — the Gem-priced duel cosmetics: the most exclusive tier, bought with the duel
 *              currency (currency === "gems") rather than coins, so it groups by wallet, not price.
 *
 * Frames flagged `prestige` in identity.ts always resolve to the prestige tier regardless of cost
 * (the crowned_scholar frame is a coronation, not a price point). Gem-priced items resolve to the
 * gem tier regardless of their (gem-denominated) cost.
 */
export type Rarity = "base" | "common" | "rare" | "epic" | "prestige" | "gem";

export interface RarityMeta {
  /** Sort weight: lower renders first (base at the top, gem at the bottom — the most exclusive). */
  order: number;
  /** Accent color (a token or hex) for the tier's label chip + card edge tint. */
  accent: string;
  /** i18n key under t.vault.rarity for the tier label. */
  labelKey: "base" | "common" | "rare" | "epic" | "prestige" | "gem";
}

export const RARITY_META: Record<Rarity, RarityMeta> = {
  base: { order: 0, accent: "var(--muted)", labelKey: "base" },
  common: { order: 1, accent: "#7fb8ff", labelKey: "common" },
  rare: { order: 2, accent: "var(--brand-2)", labelKey: "rare" },
  epic: { order: 3, accent: "#ff8ae2", labelKey: "epic" },
  prestige: { order: 4, accent: "#ffd24a", labelKey: "prestige" },
  // The duel-cosmetic tier: a cyan/violet gem accent so it reads as a precious, separate wallet.
  gem: { order: 5, accent: "var(--cyan)", labelKey: "gem" },
};

/** Infer an item's visual rarity from server data (currency/cost) + the catalog (prestige flag). */
export function rarityOf(item: VaultItem): Rarity {
  if (item.kind === "frame" && getFrame(item.id)?.prestige) return "prestige";
  // Gem-priced cosmetics group into the exclusive gem tier regardless of their gem-denominated cost.
  if (item.currency === "gems") return "gem";
  if (item.cost <= 0) return "base";
  if (item.cost <= 90) return "common";
  if (item.cost < 150) return "rare";
  return "epic";
}

/** Ownership priority WITHIN a rarity tier: the equipped item first, then owned items, then the
 * still-to-unlock rest — so a player sees what they already have at the top of each tier. */
function ownershipRank(item: VaultItem): number {
  if (item.equipped) return 0;
  if (item.owned) return 1;
  return 2;
}

/** Stable comparator: rarity tier asc, then OWNED-first within the tier (equipped first), then price
 * asc, then id (deterministic tiebreak). Rarity still dominates, so ownership only reorders inside a
 * tier — the tiers themselves stay in easiest→hardest order. */
export function compareByRarity(a: VaultItem, b: VaultItem): number {
  const ra = RARITY_META[rarityOf(a)].order;
  const rb = RARITY_META[rarityOf(b)].order;
  if (ra !== rb) return ra - rb;
  const oa = ownershipRank(a);
  const ob = ownershipRank(b);
  if (oa !== ob) return oa - ob;
  if (a.cost !== b.cost) return a.cost - b.cost;
  return a.id.localeCompare(b.id);
}

/** Group a tab's items into ordered rarity sections (empty tiers omitted), each pre-sorted. */
export function groupByRarity(items: VaultItem[]): Array<{ rarity: Rarity; items: VaultItem[] }> {
  const buckets = new Map<Rarity, VaultItem[]>();
  for (const item of items) {
    const r = rarityOf(item);
    (buckets.get(r) ?? buckets.set(r, []).get(r)!).push(item);
  }
  return (Object.keys(RARITY_META) as Rarity[])
    .filter((r) => buckets.has(r))
    .map((rarity) => ({
      rarity,
      items: buckets.get(rarity)!.slice().sort(compareByRarity),
    }));
}
