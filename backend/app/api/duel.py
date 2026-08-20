"""Duel Mode endpoints (Task 3.5): config, create, per-round submit, match state.

Exposes the duel services (app/services/duel.py). No new game logic — the router maps service
errors to HTTP with machine-readable detail CODES the frontend switches on (the repo convention,
not prose). The rival tier is returned RAW (rookie|solid|sharp|elite) — the frontend maps it to
copy-safe labels via i18n.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_locale
from app.core.db import get_session
from app.models import User
from app.models.duel import DuelRound
from app.schemas.contest import RoundSpecOut
from app.schemas.duel import (
    DuelConfigResponse,
    DuelCreateRequest,
    DuelCreateResponse,
    DuelMatchStateResponse,
    DuelResultOut,
    DuelRoundRequest,
    DuelRoundResponse,
    DuelTierOut,
)
from app.services.duel import (
    DuelLockedError,
    DuelNotFoundError,
    DuelRoundSequenceError,
    DuelStateError,
    UnknownDuelTypeError,
    create_duel,
    duel_config,
    get_duel,
    submit_duel_round,
)
from app.services.gem_ledger import InsufficientGemsError

router = APIRouter(prefix="/duel", tags=["duel"])


@router.get("/config", response_model=DuelConfigResponse)
async def config(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DuelConfigResponse:
    """The duel lobby surface: per-tier unlock state + the bot-gem-duel cap usage + the balance."""
    cfg = await duel_config(session, user.id)
    return DuelConfigResponse(
        tiers=[
            DuelTierOut(
                type=t.type,
                entry_gems=t.entry_gems,
                pool_gems=t.pool_gems,
                unlocked=t.unlocked,
                unlock_wins=t.unlock_wins,
            )
            for t in cfg.tiers
        ],
        bot_gem_cap=cfg.bot_gem_cap,
        bot_gem_used=cfg.bot_gem_used,
        gems_balance=cfg.gems_balance,
    )


@router.post("/create", response_model=DuelCreateResponse)
async def create(
    body: DuelCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    locale: str = Depends(get_locale),
) -> DuelCreateResponse:
    """Create a duel: build the seeded play entry, debit any Gem entry, precompute the rival.

    Detail strings are machine-readable codes the frontend switches on — a deliberate contract.
    """
    try:
        res = await create_duel(session, user.id, body.duel_type, locale=locale)
    except UnknownDuelTypeError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "unknown_duel_type") from exc
    except DuelLockedError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "duel_locked") from exc
    except InsufficientGemsError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "insufficient_gems") from exc

    return DuelCreateResponse(
        match_id=res.match.id,
        duel_type=res.match.duel_type,
        entry_gems=res.match.entry_gems,
        pool_gems=res.match.pool_gems,
        rival_tier=res.match.bot_rival_tier,
        rounds=[RoundSpecOut(**r) for r in res.rounds],
    )


@router.post("/{match_id}/round", response_model=DuelRoundResponse)
async def round_submit(
    match_id: uuid.UUID,
    body: DuelRoundRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DuelRoundResponse:
    """Submit one duel round; reveal the head-to-head outcome (+ the now-safe server answer).

    Detail strings are machine-readable codes the frontend switches on — a deliberate contract.
    """
    try:
        rev = await submit_duel_round(session, user.id, match_id, body.idx, body.result)
    except DuelNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "duel_not_found") from exc
    except DuelStateError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "duel_not_in_progress") from exc
    except DuelRoundSequenceError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "round_out_of_order") from exc

    result = (
        DuelResultOut(
            winner=rev.result.winner,
            result_reason=rev.result.result_reason,
            user_round_wins=rev.result.user_round_wins,
            rival_round_wins=rev.result.rival_round_wins,
            gem_delta=rev.result.gem_delta,
            xp_awarded=rev.result.xp_awarded,
            perfect=rev.result.perfect,
            comeback=rev.result.comeback,
            duel_tier=rev.result.duel_tier,
        )
        if rev.result is not None
        else None
    )
    return DuelRoundResponse(
        idx=rev.idx,
        outcome=rev.outcome,
        outcome_reason=rev.outcome_reason,
        your_correct=rev.your_correct,
        your_time_ms=rev.your_time_ms,
        answer=rev.answer,
        rival_correct=rev.rival_correct,
        rival_time_ms=rev.rival_time_ms,
        user_round_wins=rev.user_round_wins,
        rival_round_wins=rev.rival_round_wins,
        phase=rev.phase,
        next=rev.next,
        finished=rev.finished,
        result=result,
    )


@router.get("/{match_id}", response_model=DuelMatchStateResponse)
async def match_state(
    match_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DuelMatchStateResponse:
    """The current state of one of the user's duels (for resume / results)."""
    try:
        match = await get_duel(session, user.id, match_id)
    except DuelNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "duel_not_found") from exc

    rounds_played = (
        await session.scalar(
            select(func.count()).select_from(DuelRound).where(DuelRound.match_id == match_id)
        )
    ) or 0
    return DuelMatchStateResponse(
        match_id=match.id,
        duel_type=match.duel_type,
        status=match.status,
        entry_gems=match.entry_gems,
        pool_gems=match.pool_gems,
        rival_tier=match.bot_rival_tier,
        user_round_wins=match.user_round_wins,
        rival_round_wins=match.rival_round_wins,
        rounds_played=rounds_played,
        winner=match.winner,
        result_reason=match.result_reason,
        gem_delta=match.gem_delta,
        xp_awarded=match.xp_awarded,
    )
