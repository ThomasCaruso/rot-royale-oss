"""Today Command Center composition helpers (engagement layer).

Pure functions that turn already-computed pieces (the campaign ladder, the vault catalog view, the
streak count) into the home command center's blocks. The heavy reads live in their own services
(missions/campaign/vault/duel); this module only adds the small, unit-testable derivations the
aggregate needs.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.constants import STREAK_MILESTONE_REWARDS
from app.services.campaign import LadderView
from app.services.vault import VaultItemView

# The streak ladder rungs, ascending (e.g. (3, 5, 7)).
STREAK_MILESTONE_DAYS: tuple[int, ...] = tuple(sorted(STREAK_MILESTONE_REWARDS))


@dataclass(frozen=True)
class CampaignNext:
    world: str
    category: str
    level_number: int
    title: str
    arc_name: str


@dataclass(frozen=True)
class NextUnlock:
    id: str
    kind: str
    cost: int
    currency: str
    balance: int
    remaining: int
    progress: float


def next_streak_milestone(current: int) -> int | None:
    """The next streak rung strictly above `current`, or None once past the last."""
    for day in STREAK_MILESTONE_DAYS:
        if current < day:
            return day
    return None


def campaign_next_from_ladder(ladder: LadderView) -> CampaignNext | None:
    """The current mission: the first unlocked-but-uncleared level, scanning worlds/arcs in order.
    None when everything is cleared (or the manifest is empty)."""
    for world in ladder.worlds:
        for _arc_name, levels in world.arcs:
            for lvl in levels:
                if lvl.unlocked and not lvl.cleared:
                    return CampaignNext(
                        world=world.world,
                        category=world.category,
                        level_number=lvl.level_number,
                        title=lvl.title,
                        arc_name=lvl.arc_name,
                    )
    return None


def pick_next_unlock(items: list[VaultItemView], coins: int, gems: int) -> NextUnlock | None:
    """The nearest cost-gated cosmetic GOAL — to make the currencies feel worth earning.

    Considers unowned, requirement-UNlocked, cost-bearing items only (requirement-gated goals are a
    campaign concern, surfaced elsewhere). Picks the highest acquisition progress, breaking ties
    toward the cheaper item — so a fresh wallet sees the cheapest target and a nearly-rich wallet
    sees the one it's about to afford."""
    candidates = [it for it in items if not it.owned and not it.locked and it.cost > 0]
    if not candidates:
        return None

    def score(it: VaultItemView) -> tuple[float, int]:
        bal = gems if it.currency == "gems" else coins
        return (min(bal / it.cost, 1.0), -it.cost)

    best = max(candidates, key=score)
    bal = gems if best.currency == "gems" else coins
    return NextUnlock(
        id=best.id,
        kind=best.kind,
        cost=best.cost,
        currency=best.currency,
        balance=bal,
        remaining=max(best.cost - bal, 0),
        progress=min(bal / best.cost, 1.0),
    )
