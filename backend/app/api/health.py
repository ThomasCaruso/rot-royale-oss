"""Health endpoint. Proves the app boots and the DB connects (M0 done criterion)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    """Return ok plus a live DB round-trip (SELECT 1)."""
    db_status = "ok"
    try:
        result = await session.execute(text("SELECT 1"))
        if result.scalar_one() != 1:
            db_status = "unexpected"
    except Exception:  # noqa: BLE001 - report any DB failure as not-ok without crashing the probe
        db_status = "error"
    return {"status": "ok", "db": db_status}
