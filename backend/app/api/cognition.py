"""Cognition round endpoints: the cognitive round types (estimate, change_detection)
played standalone, plus the admin estimate-verdict routes. Thin routers — all authority lives in
services/cognition.py. (Estimate + change_detection are also Daily Royale round types, played
through these same endpoints against a bound instance — see services/royale_rounds.py.)"""

from __future__ import annotations

import uuid

from content import estimate_ingest
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_admin_user, get_current_user
from app.core.db import get_session
from app.core.errors import ApiErrorCode
from app.models import User
from app.schemas.cognition import (
    ChangeStartResponse,
    ChangeSubmitRequest,
    ChangeSubmitResponse,
    EstimateGuessRequest,
    EstimateGuessResponse,
    EstimateResolveResponse,
    EstimateStartResponse,
    EstimateUnratedItem,
    EstimateUnratedResponse,
    EstimateVerdictRequest,
    EstimateVerdictResponse,
)
from app.services import cognition as cog

router = APIRouter(prefix="/cognition", tags=["cognition"])


@router.post("/estimate/start", response_model=EstimateStartResponse)
async def estimate_start(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> EstimateStartResponse:
    try:
        started = await cog.estimate_start(session, user.id)
    except cog.EstimateUnavailableError as exc:
        raise ApiErrorCode("estimate_unavailable") from exc
    return EstimateStartResponse(instance_id=started.instance.id, spec=started.spec)


@router.post("/estimate/{instance_id}/guess", response_model=EstimateGuessResponse)
async def estimate_guess(
    instance_id: uuid.UUID,
    body: EstimateGuessRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> EstimateGuessResponse:
    try:
        out = await cog.estimate_guess(session, instance_id, user.id, body.value)
    except cog.RoundNotFoundError as exc:
        raise ApiErrorCode("cognition_round_not_found") from exc
    except cog.RoundCompletedError as exc:
        raise ApiErrorCode("cognition_round_completed") from exc
    except cog.EstimateUnavailableError as exc:
        raise ApiErrorCode("estimate_unavailable") from exc
    return EstimateGuessResponse(
        correct=out.correct,
        direction=out.direction,
        band=out.band,
        done=out.done,
        guesses_left=out.guesses_left,
        points=out.points,
        slider_min=out.slider_min,
        slider_max=out.slider_max,
    )


@router.post("/estimate/{instance_id}/resolve", response_model=EstimateResolveResponse)
async def estimate_resolve(
    instance_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> EstimateResolveResponse:
    try:
        reveal = await cog.estimate_resolve(session, instance_id, user.id)
    except cog.RoundNotFoundError as exc:
        raise ApiErrorCode("cognition_round_not_found") from exc
    except cog.RoundNotResolvedError as exc:
        raise ApiErrorCode("estimate_unresolved") from exc
    except cog.EstimateUnavailableError as exc:
        raise ApiErrorCode("estimate_unavailable") from exc
    return EstimateResolveResponse(
        answer=reveal.answer,
        unit=reveal.unit,
        acceptable_pct=reveal.acceptable_pct,
        close_pct=reveal.close_pct,
        points=reveal.points,
        reveal_explanation=reveal.reveal_explanation,
        intuition_note=reveal.intuition_note,
        components=reveal.components,
        guesses=reveal.guesses,
        id=reveal.source_id,
    )


@router.get("/estimate/items/unrated", response_model=EstimateUnratedResponse)
async def estimate_items_unrated(
    limit: int = 50,
    admin: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> EstimateUnratedResponse:
    """Admin-only rating worklist: ingested estimate items with no playtest verdict yet."""
    limit = max(1, min(limit, 500))
    rows = await estimate_ingest.list_unrated_estimate_items(session, limit)
    return EstimateUnratedResponse(
        items=[
            EstimateUnratedItem(
                id=r.source_id or "",
                prompt=r.prompt,
                answer=float(r.answer),
                unit=r.unit,
                difficulty=r.difficulty,
                category=r.category,
            )
            for r in rows
        ]
    )


@router.post("/estimate/items/{item_id}/verdict", response_model=EstimateVerdictResponse)
async def estimate_item_verdict(
    item_id: str,
    body: EstimateVerdictRequest,
    admin: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> EstimateVerdictResponse:
    """Admin-only playtest verdict capture, keyed by the content file id. Idempotent overwrite."""
    row = await estimate_ingest.set_estimate_verdict(session, item_id, body.verdict, body.note)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such estimate item")
    assert row.playtest_rated_at is not None  # just set
    return EstimateVerdictResponse(
        id=row.source_id or item_id,
        verdict=row.playtest_verdict or body.verdict,
        note=row.playtest_note,
        rated_at=row.playtest_rated_at.isoformat(),
    )


@router.post("/change/start", response_model=ChangeStartResponse)
async def change_start(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ChangeStartResponse:
    try:
        started = await cog.change_start(session, user.id)
    except cog.ChangeUnavailableError as exc:
        raise ApiErrorCode("change_unavailable") from exc
    return ChangeStartResponse(instance_id=started.instance.id, spec=started.spec)


@router.post("/change/{instance_id}/submit", response_model=ChangeSubmitResponse)
async def change_submit(
    instance_id: uuid.UUID,
    body: ChangeSubmitRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ChangeSubmitResponse:
    try:
        out = await cog.change_submit(
            session, instance_id, user.id, body.x, body.y, body.elapsed_ms
        )
    except cog.RoundNotFoundError as exc:
        raise ApiErrorCode("cognition_round_not_found") from exc
    except cog.RoundCompletedError as exc:
        raise ApiErrorCode("cognition_round_completed") from exc
    except cog.ChangeUnavailableError as exc:
        raise ApiErrorCode("change_unavailable") from exc
    return ChangeSubmitResponse(hit=out.hit, points=out.points, done=out.done, bbox=out.bbox)
