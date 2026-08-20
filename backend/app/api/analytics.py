"""Funnel analytics beacon: one tiny append-only event per onboarding step.

Auth is OPTIONAL (get_optional_user) because the top of the funnel fires before an account
exists. Event names are allowlisted by the schema (unknown → 422), and the client treats this as
fire-and-forget — a lost beacon never affects play. See docs/analytics-funnel.md for the queries.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_optional_user
from app.core.db import get_session
from app.models import User
from app.models.analytics import FunnelEvent
from app.schemas.analytics import FunnelAck, FunnelEventIn

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.post("/funnel", response_model=FunnelAck, status_code=status.HTTP_202_ACCEPTED)
async def record_funnel_event(
    body: FunnelEventIn,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> FunnelAck:
    session.add(
        FunnelEvent(
            user_id=user.id if user is not None else None,
            event=body.event,
            source=body.source,
        )
    )
    await session.flush()
    return FunnelAck(recorded=True)
