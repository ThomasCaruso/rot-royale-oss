"""Category listing endpoint (categories milestone): data source for the selection surface."""

from __future__ import annotations

from content.loader import list_categories
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_session
from app.models import User
from app.schemas.category import CategoriesResponse, CategoryOut

router = APIRouter(tags=["categories"])


@router.get("/categories", response_model=CategoriesResponse)
async def categories(
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CategoriesResponse:
    # Only servable (approved/live) categories — same gate as session start, so the list can never
    # offer a category that would fail to start.
    cats = await list_categories(session)
    return CategoriesResponse(categories=[CategoryOut(**c) for c in cats])
