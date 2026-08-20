"""Personalization endpoints: interaction event intake + a debug view of the taste profile.

POST /personalization/events is designed to be called fire-and-forget from gameplay — small
payload, 202 on success, and the client swallows any failure (a lost event never blocks play).
GET /personalization/me/profile is a debug/dev surface: hidden in production unless
PERSONALIZATION_DEBUG=true (and always scoped to the authenticated user's own profile).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.db import get_session
from app.models import User
from app.schemas.personalization import (
    AIStatusOut,
    EventAck,
    QuestionInteractionEventIn,
    TasteProfileOut,
)
from app.services.ai_classifier import ai_metadata_coverage
from app.services.taste_profile import get_or_create_profile, record_interaction

router = APIRouter(prefix="/personalization", tags=["personalization"])

# Fraction of trivia questions with AI metadata required before "AI-personalized" copy is truthful.
AI_READY_THRESHOLD = 0.8


@router.get("/status", response_model=AIStatusOut)
async def ai_status(session: AsyncSession = Depends(get_session)) -> AIStatusOut:
    """Public readiness check — no auth required (fires pre-account in the Brain Boost intro).

    Returns the fraction of trivia questions that have an AI-metadata row and whether that fraction
    has crossed AI_READY_THRESHOLD (0.8). The frontend shows soft "learns as you play" copy until
    `ready` is true, then upgrades to the explicit "AI-personalized" claim automatically.
    """
    coverage = await ai_metadata_coverage(session)
    return AIStatusOut(coverage=coverage, ready=coverage >= AI_READY_THRESHOLD)


@router.post("/events", response_model=EventAck, status_code=status.HTTP_202_ACCEPTED)
async def record_event(
    body: QuestionInteractionEventIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> EventAck:
    await record_interaction(session, user.id, body)
    return EventAck(recorded=True)


@router.get("/me/profile", response_model=TasteProfileOut)
async def my_profile(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TasteProfileOut:
    if settings.app_env == "production" and not settings.personalization_debug:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    profile = await get_or_create_profile(session, user.id)
    return TasteProfileOut.model_validate(profile)
