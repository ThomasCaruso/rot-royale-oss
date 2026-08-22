"""Async SQLAlchemy engine, session factory, and declarative base.

All schema changes go through Alembic migrations (see docs/architecture.md §3) — never
create_all in app code.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    """Declarative base for all ORM models (none defined until M1)."""


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding an async DB session.

    Commit happens at this request boundary, not inside services. Services call session.flush()
    to surface DB errors/get generated values, but never commit() — that keeps service logic
    trivially testable (call, assert, roll back) and gives every request one atomic transaction.
    """
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
