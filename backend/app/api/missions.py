"""Daily-mission chest endpoint (engagement layer): claim the once-per-ET-day chest.

The grant is eligibility-gated (>= DAILY_MISSIONS_REQUIRED of the three missions) and idempotent
(services/missions.py). The not-eligible detail string is a machine-readable code the frontend
switches on — a deliberate contract, not prose.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_session
from app.models import Profile, User
from app.schemas.today import ChestRewardOut, ClaimChestResponse, MissionsBlock
from app.services.missions import ChestNotEligibleError, claim_chest, get_missions_view

router = APIRouter(tags=["missions"])


@router.post("/missions/claim", response_model=ClaimChestResponse)
async def claim(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ClaimChestResponse:
    """Open today's chest. Returns the grant, the refreshed missions block, and the new balances."""
    try:
        result = await claim_chest(session, user.id)
    except ChestNotEligibleError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "not_eligible") from exc

    profile = await session.get(Profile, user.id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    view = await get_missions_view(session, user.id)
    return ClaimChestResponse(
        reward=ChestRewardOut(
            coins=result.reward.coins, gems=result.reward.gems, code=result.reward.code
        ),
        coins_awarded=result.coins_awarded,
        gems_awarded=result.gems_awarded,
        already_claimed=result.already_claimed,
        coins_balance=profile.coins_balance,
        gems_balance=profile.gems_balance,
        missions=MissionsBlock.from_view(view),
    )
