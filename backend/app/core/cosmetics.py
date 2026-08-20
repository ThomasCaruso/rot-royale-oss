"""Cosmetic catalog (server-authoritative; PLAN.md §6, §11, DESIGN.md §6).

The SERVER owns prices and unlock gating — the frontend's theme list (tokens.ts) and frame styles
(identity.ts) are visuals only and never send a price. Catalog is code, not DB (same pattern as
services/templates.py): versioned, reviewable, no admin tooling.

Coins are cosmetic-only (CLAUDE.md §8): items never grant any competitive advantage.

Requirement strings (grammar evaluated in services/unlocks.py against a player-progress snapshot;
one requirement per item — no combinators). Verbs:
  - None                 → always available.
  - "world:<key>"        → every level of that campaign world cleared. <key> MUST be the exact value
                           stored in user_campaign_progress.world (== CampaignWorld.world in the
                           manifest, e.g. "Science", "Pop Culture") — NOT the bank category name.
  - "all_worlds"         → every world in the campaign manifest fully cleared.
  - "level:<world>:<n>"  → that specific campaign level cleared (e.g. "level:Science:10" = the
                           Cosmic Labs boss).
  - "streak:<n>"         → daily Royale streak has reached n (see the note on permanence below).
  - "royales:<n>"        → n or more Daily Royales completed (SUBMITTED entries in royale windows).
  - "division:<name>"    → Royale rating division has reached <name> or higher (rating.py ordering:
                           Bronze < Silver < Gold < Platinum < Diamond < Apex).
  - "duel_wins:<n>"      → cumulative ranked duel wins ≥ n (DuelUserStats.wins).
  - "duel_tier:<name>"   → duel tier ≥ <name> (constants ordering: bronze < silver < gold < crown).
  - "duel_perfect:<n>"   → perfect duel wins ≥ n (DuelUserStats.perfect_wins).
  - "founder:<n>"        → the account is among the first n ever registered (by users.created_at
                           order). A launch exclusive: met forever for early accounts, never met
                           for later ones (permanence via the ack high-water mark as usual).
Any other format is treated as NOT met (safe default) by the checker.

Permanence: some sources fluctuate (division/streak can drop). The requirement check reads the
player's CURRENT values, but ownership never regresses — once the earn is acknowledged
(user_unlock_acks) the item stays unlocked/owned forever (see models/unlock_ack.py). The ack row is
the high-water mark, so no peak columns are needed.

Two acquisition models, chosen per item:
  - earned-free    : cost == 0 + requirement → granted outright when earned.
  - unlock-then-buy: cost N  + requirement → requirement makes it purchasable; coins still pay.
"""

from __future__ import annotations

from dataclasses import dataclass


class UnknownItemError(Exception):
    """Item id not in the catalog."""


@dataclass(frozen=True)
class CosmeticItem:
    id: str
    kind: str  # "theme" | "frame"
    cost: int  # price in `currency`; 0 = free (implicitly owned when the requirement is met)
    currency: str = "coins"  # "coins" | "gems" — which wallet a purchase debits
    requirement: str | None = None  # see module docstring for the format
    # NOT YET RELEASED. Held back from sale regardless of price or requirement: the Vault shows it
    # under a "Coming soon" divider and the server refuses to sell it (see services/vault.py). This
    # is a separate flag rather than a `requirement` value on purpose — the item keeps whatever
    # earned gate it will ship with; launching it means flipping this back to False, nothing more.
    coming_soon: bool = False


COSMETIC_CATALOG: tuple[CosmeticItem, ...] = (
    # --- themes (user_themes ownership) ---
    # "starter" (the ivory/purple/gold identity) is the DEFAULT; the Blank pair are the other free
    # themes; bubblegum/forest/midnight are the ONLY purchasable themes. "Daylight" is free but
    # earned — gated behind 7 completed Daily Royales (royales:7). "Rot Champion" (id `royale` — the
    # original arcade skin) is a launch exclusive: earned-free for the first 200 accounts only,
    # never buyable. (A matching exclusive founder player icon is planned — not built yet.) Every
    # other theme below is unlock-only.
    CosmeticItem(id="starter", kind="theme", cost=0),
    CosmeticItem(id="blank_light", kind="theme", cost=0),
    CosmeticItem(id="blank", kind="theme", cost=0),
    CosmeticItem(id="daylight", kind="theme", cost=0, requirement="royales:7"),
    CosmeticItem(id="royale", kind="theme", cost=0, requirement="founder:200"),
    # Launched 2026-08-06 (1.1): the whole catalog is live — nothing is held back as coming-soon.
    CosmeticItem(id="bubblegum", kind="theme", cost=400),
    CosmeticItem(id="forest", kind="theme", cost=600),
    CosmeticItem(id="midnight", kind="theme", cost=900),
    # Earned-only prestige themes — the hardest tier. Each is one half of a matched frame+theme SET
    # granted by a single super-difficult feat (the other half is the paired frame below):
    #   champion   ↔ crowned_scholar  (clear the entire campaign)
    #   apex       ↔ apex_frame        (reach the top Royale division)
    #   crown_arena ↔ crown_master_frame (reach the top duel tier)
    CosmeticItem(id="champion", kind="theme", cost=0, requirement="all_worlds"),
    CosmeticItem(id="apex", kind="theme", cost=0, requirement="division:Apex"),
    CosmeticItem(id="crown_arena", kind="theme", cost=0, requirement="duel_tier:crown"),
    # --- frames (user_cosmetics ownership; equipped_frame on the profile) ---
    CosmeticItem(id="frame_none", kind="frame", cost=0),  # the "no frame" option, free for all
    CosmeticItem(id="bronze_ring", kind="frame", cost=60),
    CosmeticItem(id="violet_glow", kind="frame", cost=100),
    CosmeticItem(id="gold_crown", kind="frame", cost=150),
    # Campaign-gated frames: <key> is the manifest world key (user_campaign_progress.world).
    CosmeticItem(id="science_orbit", kind="frame", cost=150, requirement="world:Science"),
    CosmeticItem(id="history_relic", kind="frame", cost=150, requirement="world:History"),
    CosmeticItem(id="geo_compass", kind="frame", cost=150, requirement="world:Geography"),
    CosmeticItem(id="arts_brush", kind="frame", cost=150, requirement="world:Arts"),
    CosmeticItem(id="sports_champion", kind="frame", cost=150, requirement="world:Sports"),
    CosmeticItem(id="pop_neon", kind="frame", cost=150, requirement="world:Pop Culture"),
    # Prestige: free once every world is fully cleared (implicitly owned at that point).
    CosmeticItem(id="crowned_scholar", kind="frame", cost=0, requirement="all_worlds"),
    # Gem-priced duel frames: bought with Gems (the duel-economy currency), no requirement.
    CosmeticItem(id="violet_duel_frame", kind="frame", cost=25, currency="gems"),
    CosmeticItem(id="crown_duel_frame", kind="frame", cost=60, currency="gems"),
    # Paired-set frames: the earned halves that match the prestige themes above. crowned_scholar
    # (all_worlds, above) is the Champion set's frame; these two complete the Apex + Crown sets.
    CosmeticItem(id="apex_frame", kind="frame", cost=0, requirement="division:Apex"),
    CosmeticItem(id="crown_master_frame", kind="frame", cost=0, requirement="duel_tier:crown"),
    # Standalone earned frames (mid-tier, no matching theme): a specific level clear + a duel tier.
    CosmeticItem(id="cosmic_boss_frame", kind="frame", cost=0, requirement="level:Science:10"),
    CosmeticItem(id="duelist_gold_frame", kind="frame", cost=0, requirement="duel_tier:gold"),
)

CATALOG_BY_ID: dict[str, CosmeticItem] = {item.id: item for item in COSMETIC_CATALOG}


def get_item(item_id: str) -> CosmeticItem:
    try:
        return CATALOG_BY_ID[item_id]
    except KeyError as exc:
        raise UnknownItemError(item_id) from exc
