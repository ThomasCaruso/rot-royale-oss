"""Brain Boost endpoints: the post-check Brain Profile reveal + the home screen's today state.

Pure reads over stored gameplay rows — no LLM, no gameplay writes, no stakes.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_session
from app.models import User
from app.schemas.brain_boost import (
    BrainBoostSummaryOut,
    BrainBoostTodayResponse,
    CategoryPerfOut,
)
from app.services.brain_boost import (
    BrainBoostSummary,
    CheckNotFoundError,
    get_check_entry,
    latest_check,
    summarize_check,
)

router = APIRouter(prefix="/brain-boost", tags=["brain-boost"])


def _out(summary: BrainBoostSummary) -> BrainBoostSummaryOut:
    def perf(rows: list) -> list[CategoryPerfOut]:  # type: ignore[type-arg]
        return [
            CategoryPerfOut(
                category=p.category,
                correct=p.correct,
                total=p.total,
                accuracy=p.accuracy,
                # Display score for the profile bars: accuracy-led with a speed nudge.
                score=round(min(1.0, p.accuracy * 0.85 + p.avg_time_frac * 0.15) * 100),
            )
            for p in rows
        ]

    return BrainBoostSummaryOut(
        entry_id=summary.entry_id,
        mode=summary.mode,
        submitted_at=summary.submitted_at,
        total=summary.total,
        correct=summary.correct,
        accuracy=summary.accuracy,
        brain_score=summary.brain_score,
        rot_type=summary.rot_type,
        strengths=perf(summary.strengths),
        weaknesses=perf(summary.weaknesses),
        categories=perf(summary.categories),
        weak_spot_topic=summary.weak_spot_topic,
        movements=summary.movements,
        first_check=summary.first_check,
    )


@router.get("/today", response_model=BrainBoostTodayResponse)
async def today(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BrainBoostTodayResponse:
    """Home screen state: has today's check been done, and the latest Brain Profile read."""
    entry, completed_today = await latest_check(session, user.id)
    return BrainBoostTodayResponse(
        completed_today=completed_today,
        has_any_check=entry is not None,
        latest=_out(await summarize_check(session, entry)) if entry is not None else None,
    )


@router.get("/{entry_id}/summary", response_model=BrainBoostSummaryOut)
async def summary(
    entry_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BrainBoostSummaryOut:
    """The Brain Profile reveal for one submitted check (own entries only)."""
    try:
        entry = await get_check_entry(session, entry_id, user.id)
    except CheckNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check not found") from exc
    return _out(await summarize_check(session, entry))
