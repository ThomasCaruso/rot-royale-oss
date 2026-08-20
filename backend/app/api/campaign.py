"""Campaign Mode endpoints.

The ladder + level start + level completion. Play itself reuses the unchanged practice loop
(`POST /practice/{entry}/answer`) — a campaign Entry is a window-less practice Entry, so adding
Campaign needed NO change to the contest engine, scoring, settlement, or the practice service.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_locale
from app.core.db import get_session
from app.core.errors import ApiErrorCode
from app.models import User
from app.schemas.campaign import (
    CampaignArcOut,
    CampaignCompleteResponse,
    CampaignLadderResponse,
    CampaignLevelOut,
    CampaignStartRequest,
    CampaignStartResponse,
    CampaignWorldOut,
)
from app.schemas.contest import RoundSpecOut
from app.schemas.offline import CampaignOfflineCompleteRequest
from app.services.campaign import (
    CampaignError,
    LevelLockedError,
    LevelNotFinishedError,
    LevelNotFoundError,
    NotACampaignEntryError,
    complete_campaign_level,
    get_ladder,
    start_campaign_level,
)
from app.services.contest import CategoryUnavailableError, EntryNotFoundError
from app.services.offline_content import build_campaign_bundle
from app.services.offline_sync import sync_campaign_offline

router = APIRouter(prefix="/campaign", tags=["campaign"])


@router.get("", response_model=CampaignLadderResponse)
async def ladder(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CampaignLadderResponse:
    view = await get_ladder(session, user.id)
    return CampaignLadderResponse(
        worlds=[
            CampaignWorldOut(
                world=w.world,
                category=w.category,
                cleared_count=w.cleared_count,
                total_levels=w.total_levels,
                arcs=[
                    CampaignArcOut(
                        name=arc_name,
                        levels=[
                            CampaignLevelOut(
                                level_number=lvl.level_number,
                                title=lvl.title,
                                arc_name=lvl.arc_name,
                                is_boss=lvl.is_boss,
                                difficulty_mix=lvl.difficulty_mix,
                                unlocked=lvl.unlocked,
                                cleared=lvl.cleared,
                                clear_status=lvl.clear_status,
                                best_correct=lvl.best_correct,
                            )
                            for lvl in levels
                        ],
                    )
                    for arc_name, levels in w.arcs
                ],
            )
            for w in view.worlds
        ],
        daily_coins_earned=view.daily_coins_earned,
        daily_coins_cap=view.daily_coins_cap,
    )


@router.post("/start", response_model=CampaignStartResponse)
async def start(
    body: CampaignStartRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    locale: str = Depends(get_locale),
) -> CampaignStartResponse:
    try:
        entry, level = await start_campaign_level(
            session, user.id, body.world, body.level, locale=locale
        )
    except LevelNotFoundError as exc:
        raise ApiErrorCode("campaign_level_not_found") from exc
    except LevelLockedError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Level is locked — clear the previous level first"
        ) from exc
    except CategoryUnavailableError as exc:
        raise ApiErrorCode("campaign_content_unavailable") from exc
    return CampaignStartResponse(
        entry_id=entry.id,
        world=level.world,
        level=level.level_number,
        title=level.title,
        is_boss=level.is_boss,
        rounds=[RoundSpecOut(**r) for r in entry.round_set],
    )


@router.post("/{entry_id}/complete", response_model=CampaignCompleteResponse)
async def complete(
    entry_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CampaignCompleteResponse:
    """Settle a finished campaign level (rewards + progress). Idempotent: safe to retry."""
    try:
        r = await complete_campaign_level(session, entry_id, user.id)
    except (EntryNotFoundError, NotACampaignEntryError) as exc:
        raise ApiErrorCode("campaign_session_not_found") from exc
    except LevelNotFinishedError as exc:
        raise ApiErrorCode("campaign_level_unfinished") from exc
    except LevelNotFoundError as exc:
        raise ApiErrorCode("campaign_level_not_found") from exc
    return CampaignCompleteResponse(
        world=r.world,
        level=r.level_number,
        title=r.title,
        is_boss=r.is_boss,
        correct=r.correct,
        total=r.total,
        passed=r.passed,
        clear_status=r.clear_status,
        coins_awarded=r.coins_awarded,
        gems_awarded=r.gems_awarded,
        daily_cap_reached=r.daily_cap_reached,
        first_clear=r.first_clear,
        next_level_unlocked=r.next_level_unlocked,
        best_correct=r.best_correct,
    )


@router.get("/offline-bundle")
async def offline_bundle(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Answer-bearing offline campaign bundle: every unlocked level (plus a lookahead) resolved to
    its exact authored questions, for offline play. The device answer is reveal-only; the recorded
    choices are re-scored server-side on sync."""
    return await build_campaign_bundle(session, user.id)


@router.post("/offline-complete", response_model=CampaignCompleteResponse)
async def offline_complete(
    body: CampaignOfflineCompleteRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CampaignCompleteResponse:
    """Idempotently re-score recorded offline choices for a campaign level and settle it through the
    same reward path as the online complete. Re-syncing the same client_id never double-pays."""
    try:
        r = await sync_campaign_offline(
            session,
            user.id,
            body.world,
            body.level,
            body.client_id,
            [it.model_dump() for it in body.items],
        )
    except LevelLockedError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Level is locked — clear the previous level first"
        ) from exc
    except LevelNotFoundError as exc:
        raise ApiErrorCode("campaign_level_not_found") from exc
    except CategoryUnavailableError as exc:
        raise ApiErrorCode("campaign_content_unavailable") from exc
    except (EntryNotFoundError, NotACampaignEntryError) as exc:
        raise ApiErrorCode("campaign_session_not_found") from exc
    except CampaignError as exc:
        # Base campaign error (e.g. offline items don't match the level's authored questions).
        raise ApiErrorCode("offline_result_invalid") from exc
    return CampaignCompleteResponse(
        world=r.world,
        level=r.level_number,
        title=r.title,
        is_boss=r.is_boss,
        correct=r.correct,
        total=r.total,
        passed=r.passed,
        clear_status=r.clear_status,
        coins_awarded=r.coins_awarded,
        gems_awarded=r.gems_awarded,
        daily_cap_reached=r.daily_cap_reached,
        first_clear=r.first_clear,
        next_level_unlocked=r.next_level_unlocked,
        best_correct=r.best_correct,
    )
