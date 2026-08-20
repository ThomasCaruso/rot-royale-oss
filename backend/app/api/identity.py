"""Identity endpoint (badges + titles; Identity V2). Read-only: earned status is computed
server-side from durable progress; equipping happens via PATCH /me/badges and PATCH /me/title."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_session
from app.models import User
from app.schemas.identity import IdentityItemOut, IdentityResponse
from app.services.achievements import get_identity

router = APIRouter(tags=["identity"])

# NOTE: services.achievements.get_identity raises LookupError for a missing profile — unreachable
# for an authed user, so it is deliberately unmapped here (a 500 is correct for an impossible
# state; same convention as api/vault.py).


@router.get("/identity", response_model=IdentityResponse)
async def identity(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> IdentityResponse:
    badges, titles = await get_identity(session, user.id)
    return IdentityResponse(
        badges=[IdentityItemOut(**vars(b)) for b in badges],
        titles=[IdentityItemOut(**vars(t)) for t in titles],
    )
