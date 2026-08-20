"""Practice Mode endpoints (M8): start a no-stakes session and submit it for server scoring."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_locale
from app.core.db import get_session
from app.core.errors import ApiErrorCode
from app.models import User
from app.schemas.contest import RoundResultOut, RoundSpecOut
from app.schemas.offline import PracticeOfflineSubmitRequest
from app.schemas.practice import (
    PracticeAnswerRequest,
    PracticeAnswerResponse,
    PracticeStartRequest,
    PracticeStartResponse,
    PracticeSubmitRequest,
    PracticeSubmitResponse,
)
from app.services.contest import (
    CategoryUnavailableError,
    EntryNotFoundError,
    EntryNotSubmittableError,
    RoundSequenceError,
)
from app.services.offline_content import build_practice_pool
from app.services.offline_sync import sync_practice_offline
from app.services.practice import answer_practice_round, start_practice, submit_practice

router = APIRouter(prefix="/practice", tags=["practice"])


@router.post("/start", response_model=PracticeStartResponse)
async def start(
    body: PracticeStartRequest | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    locale: str = Depends(get_locale),
) -> PracticeStartResponse:
    category = body.category if body else None
    mode = body.mode if body else None
    try:
        entry = await start_practice(session, user.id, category=category, mode=mode, locale=locale)
    except CategoryUnavailableError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "No questions available for that category"
        ) from exc
    return PracticeStartResponse(
        entry_id=entry.id,
        rounds=[RoundSpecOut(**r) for r in entry.round_set],
    )


@router.get("/offline-pool")
async def offline_pool(
    category: str | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Answer-bearing offline practice pool: up to N servable questions (scoped to `category` if
    given), each built into an offline round. Recorded choices are re-scored server-side on sync."""
    return await build_practice_pool(session, category=category)


@router.post("/offline-submit", response_model=PracticeSubmitResponse)
async def offline_submit(
    body: PracticeOfflineSubmitRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PracticeSubmitResponse:
    """Idempotently re-score a recorded offline practice/category session (no coins — scores +
    nudges sharpness once + records personalization signals). Re-syncing the same client_id never
    double-credits sharpness."""
    try:
        r = await sync_practice_offline(
            session,
            user.id,
            body.mode,
            body.category,
            body.client_id,
            [it.model_dump() for it in body.items],
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Offline result is invalid") from exc
    return PracticeSubmitResponse(
        entry_id=r.entry.id,
        accuracy=r.accuracy,
        correct=r.correct,
        total=r.total,
        sharpness=r.sharpness_after,
        sharpness_gained=r.sharpness_gained,
        rounds=[],
    )


@router.post("/{entry_id}/submit", response_model=PracticeSubmitResponse)
async def submit(
    entry_id: uuid.UUID,
    body: PracticeSubmitRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PracticeSubmitResponse:
    submissions = {r.idx: r.result for r in body.rounds}
    try:
        result = await submit_practice(session, entry_id, user.id, submissions)
    except EntryNotFoundError as exc:
        raise ApiErrorCode("practice_not_found") from exc
    except EntryNotSubmittableError as exc:
        raise ApiErrorCode("practice_already_submitted") from exc

    return PracticeSubmitResponse(
        entry_id=result.entry.id,
        accuracy=result.accuracy,
        correct=result.correct,
        total=result.total,
        sharpness=result.sharpness_after,
        sharpness_gained=result.sharpness_gained,
        rounds=[
            RoundResultOut(
                idx=r.idx,
                module_type=r.module_type,
                points=r.points,
                correct=r.correct,
                answer=r.server_answer,
            )
            for r in result.rounds
        ],
    )


@router.post("/{entry_id}/answer", response_model=PracticeAnswerResponse)
async def answer(
    entry_id: uuid.UUID,
    body: PracticeAnswerRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PracticeAnswerResponse:
    """Lesson-mode per-round answer: reveal the correct answer + explanation, self-paced."""
    try:
        o = await answer_practice_round(session, entry_id, user.id, body.idx, body.result)
    except EntryNotFoundError as exc:
        raise ApiErrorCode("practice_not_found") from exc
    except EntryNotSubmittableError as exc:
        raise ApiErrorCode("practice_already_submitted") from exc
    except RoundSequenceError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Round answered out of order") from exc

    return PracticeAnswerResponse(
        idx=o.idx,
        module_type=o.module_type,
        correct=o.correct,
        valid=o.valid,
        answer=o.server_answer,
        explanation=o.explanation,
        finished=o.finished,
        correct_count=o.correct_count,
        total=o.total,
        accuracy=o.accuracy,
        sharpness=o.sharpness_after,
        sharpness_gained=o.sharpness_gained,
    )
