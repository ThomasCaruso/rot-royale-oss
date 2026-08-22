"""Achievement catalog: badges + titles (Identity V2; DESIGN.md §6).

Badges and titles are NEVER purchasable — they are proof, not merchandise. No coins, no vault,
no catalog cost. Earned status is computed on read from durable progress (campaign progress +
standings + entries), so achievements are monotonic and need no grant table. The SERVER owns the
catalog (code, not DB — same pattern as core/cosmetics.py): versioned, reviewable, no admin
tooling. Frontend names/blurbs/emoji live in src/theme/identity.ts and are visuals only.

Requirement grammar (checked in services/achievements.py against campaign progress, standings
and ranked entries; any other format is treated as NOT earned — the safe default):
  - "world:<key>"        → every level of that campaign world cleared. <key> MUST be the exact
                           value stored in user_campaign_progress.world (== CampaignWorld.world
                           in the manifest, e.g. "Science", "Pop Culture").
  - "all_worlds"         → every world in the campaign manifest fully cleared.
  - "worlds_any:<n>"     → at least n worlds fully cleared.
  - "perfect_world_any"  → at least one world where EVERY level has clear_status='perfect'.
  - "top3:<n>"           → at least n settled standings with place <= 3.
  - "first_place:<n>"    → at least n settled standings with place == 1.
  - "ranked_entries:<n>" → at least n entries in ranked contest windows (practice and campaign
                           sessions never count).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Achievement:
    id: str
    kind: str  # "badge" | "title"
    requirement: str  # see module docstring for the grammar


BADGE_CATALOG: tuple[Achievement, ...] = (
    # World medals: one per campaign world, granted on full clear.
    Achievement(id="medal_science", kind="badge", requirement="world:Science"),
    Achievement(id="medal_history", kind="badge", requirement="world:History"),
    Achievement(id="medal_geography", kind="badge", requirement="world:Geography"),
    Achievement(id="medal_arts", kind="badge", requirement="world:Arts"),
    Achievement(id="medal_sports", kind="badge", requirement="world:Sports"),
    Achievement(id="medal_pop", kind="badge", requirement="world:Pop Culture"),
    # Prestige.
    Achievement(id="crown_all", kind="badge", requirement="all_worlds"),
    Achievement(id="perfectionist", kind="badge", requirement="perfect_world_any"),
    # Podium honors (from settled standings).
    Achievement(id="podium_finisher", kind="badge", requirement="top3:1"),
    Achievement(id="first_crown", kind="badge", requirement="first_place:1"),
)

TITLE_CATALOG: tuple[Achievement, ...] = (
    Achievement(id="crown_chaser", kind="title", requirement="ranked_entries:1"),
    Achievement(id="world_traveler", kind="title", requirement="worlds_any:3"),
    Achievement(id="perfect_clear", kind="title", requirement="perfect_world_any"),
    Achievement(id="podium_regular", kind="title", requirement="top3:3"),
    Achievement(id="champion", kind="title", requirement="first_place:1"),
    Achievement(id="trivia_menace", kind="title", requirement="all_worlds"),
)

BADGES_BY_ID: dict[str, Achievement] = {a.id: a for a in BADGE_CATALOG}
TITLES_BY_ID: dict[str, Achievement] = {a.id: a for a in TITLE_CATALOG}
