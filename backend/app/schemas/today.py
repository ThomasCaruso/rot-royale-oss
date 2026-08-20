"""Today Command Center schemas (engagement layer).

One aggregate (GET /me/today) powers the home command center: status strip, daily missions + chest,
streak ladder, campaign next step, and the nearest cosmetic unlock. POST /missions/claim returns the
grant plus the refreshed missions block and balances.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel

if TYPE_CHECKING:
    from app.services.missions import MissionsView


class ChestRewardOut(BaseModel):
    coins: int
    gems: int
    code: str  # weekday code ("mon".."sun") for chest rewards, or "streak_<n>" for streak rungs


class MissionOut(BaseModel):
    id: str  # play_royale | complete_duel | clear_campaign
    done: bool


class MissionsBlock(BaseModel):
    missions: list[MissionOut]
    completed_count: int
    required: int
    chest_state: str  # in_progress | ready | claimed
    reward: ChestRewardOut

    @staticmethod
    def from_view(view: MissionsView) -> MissionsBlock:
        return MissionsBlock(
            missions=[MissionOut(id=m.id, done=m.done) for m in view.missions],
            completed_count=view.completed_count,
            required=view.required,
            chest_state=view.chest_state,
            reward=ChestRewardOut(
                coins=view.reward.coins, gems=view.reward.gems, code=view.reward.code
            ),
        )


class StreakBlock(BaseModel):
    current: int
    milestones: list[int]  # the rung days (e.g. [3, 5, 7]) for the ladder UI
    next_milestone: int | None  # the next rung above `current`, or None past the last
    next_reward: ChestRewardOut | None  # the reward for that next rung
    # Free weekly streak-grace: True when a single missed day would be forgiven this ISO week (the
    # safety-net the UI reassures with). False once it's been spent until next week.
    grace_available: bool = True


class TodayStatus(BaseModel):
    coins_balance: int
    gems_balance: int
    streak_count: int
    duel_tier: str


class CampaignNextOut(BaseModel):
    world: str
    category: str
    level_number: int
    title: str
    arc_name: str


class NextUnlockOut(BaseModel):
    id: str
    kind: str
    cost: int
    currency: str  # coins | gems
    balance: int  # the player's balance in `currency`
    remaining: int  # cost - balance, clamped at 0
    progress: float  # balance / cost, clamped to 0..1


class TodayResponse(BaseModel):
    status: TodayStatus
    missions: MissionsBlock
    streak: StreakBlock
    campaign_next: CampaignNextOut | None
    next_unlock: NextUnlockOut | None


class ClaimChestResponse(BaseModel):
    reward: ChestRewardOut
    coins_awarded: int
    gems_awarded: int
    already_claimed: bool
    coins_balance: int
    gems_balance: int
    missions: MissionsBlock
