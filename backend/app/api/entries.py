"""Entry endpoints: batched submit (PLAN.md §7, §8)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_session
from app.core.errors import ApiErrorCode
from app.models import User
from app.schemas.contest import (
    AnswerRoundRequest,
    AnswerRoundResponse,
    RotReportOut,
    RoundResultOut,
    SubmitRequest,
    SubmitResponse,
)
from app.services.contest import (
    EntryNotFoundError,
    EntryNotSubmittableError,
    InteractiveRoundNotResolvedError,
    RoundSequenceError,
    WindowNotOpenError,
    answer_round,
    submit_entry,
)
from app.services.rot_report import load_rot_report

router = APIRouter(prefix="/entries", tags=["entries"])


@router.post("/{entry_id}/submit", response_model=SubmitResponse)
async def submit(
    entry_id: uuid.UUID,
    body: SubmitRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubmitResponse:
    # client_score on the request is ignored — server scores against stored answers.
    # Each round's opaque result dict is handed straight to its module's score().
    submissions = {r.idx: r.result for r in body.rounds}
    try:
        entry, results = await submit_entry(session, entry_id, user.id, submissions)
    except EntryNotFoundError as exc:
        raise ApiErrorCode("entry_not_found") from exc
    except EntryNotSubmittableError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Entry already submitted") from exc
    except WindowNotOpenError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Window is closed") from exc

    return SubmitResponse(
        entry_id=entry.id,
        total_score=entry.total_score or 0,
        rounds=[
            RoundResultOut(
                idx=r.idx,
                module_type=r.module_type,
                points=r.points,
                correct=r.correct,
                answer=r.server_answer,
            )
            for r in results
        ],
    )


@router.post("/{entry_id}/answer", response_model=AnswerRoundResponse)
async def answer(
    entry_id: uuid.UUID,
    body: AnswerRoundRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AnswerRoundResponse:
    # Per-round answer + reveal (Phase A). Server-authoritative: scores the round and reveals it
    # only after the choice is recorded (sequential, immutable). Client-sent points are ignored.
    try:
        outcome = await answer_round(
            session,
            entry_id,
            user.id,
            body.idx,
            body.result,
            supports_retry=body.supports_retry,
        )
    except EntryNotFoundError as exc:
        raise ApiErrorCode("entry_not_found") from exc
    except EntryNotSubmittableError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Entry already submitted") from exc
    except WindowNotOpenError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Window is closed") from exc
    except RoundSequenceError as exc:
        raise ApiErrorCode("round_out_of_order") from exc
    except InteractiveRoundNotResolvedError as exc:
        raise ApiErrorCode("round_not_resolved") from exc

    return AnswerRoundResponse(
        idx=outcome.idx,
        module_type=outcome.module_type,
        points=outcome.points,
        correct=outcome.correct,
        valid=outcome.valid,
        answer=outcome.server_answer,
        total_score=outcome.total_score,
        finished=outcome.finished,
        retry_available=outcome.retry_available,
        eliminated=outcome.eliminated,
        retry_ms=outcome.retry_ms,
    )


@router.get("/{entry_id}/rot-report", response_model=RotReportOut)
async def rot_report(
    entry_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RotReportOut:
    # The caller's OWN finish report, rebuilt from stored rounds so it survives the device that
    # played the run (the client stash in localStorage does not). Someone else's entry id reads as
    # not-found, so this can't probe for other players' entries.
    try:
        report = await load_rot_report(session, entry_id, user.id)
    except EntryNotFoundError as exc:
        raise ApiErrorCode("entry_not_found") from exc

    return RotReportOut(
        score=report.score,
        total=report.total,
        incorrect=report.incorrect,
        avg_ms=report.avg_ms,
        fastest_ms=report.fastest_ms,
        rounds=list(report.rounds),
    )
