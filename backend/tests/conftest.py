"""Pytest harness.

Tests run against a DEDICATED database (`TEST_DATABASE_URL`, default rot_royale_test) — never the
live `rot_royale` DB the settlement daemon writes to, so background writes can't cause flakiness or
pollute results. The schema is created once per session via `alembic upgrade head` against the test
DB. Each test runs inside a transaction that is rolled back, so the DB stays clean between tests.

`client` overrides the app's get_session to yield the test session WITHOUT committing, so API calls
and direct DB assertions share one transaction that the fixture rolls back at the end.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from pathlib import Path

import app.models  # noqa: F401 - register all tables on Base.metadata
import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from app.core.config import settings
from app.core.db import get_session
from app.main import app
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session", autouse=True)
def _migrate_test_db() -> None:
    """Bring the dedicated test database up to head once per test session."""
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.test_database_url)  # honored by env.py
    command.upgrade(cfg, "head")


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(settings.test_database_url)
    conn = await engine.connect()
    trans = await conn.begin()
    session = AsyncSession(bind=conn, expire_on_commit=False)
    try:
        yield session
    finally:
        await session.close()
        await trans.rollback()
        await conn.close()
        await engine.dispose()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    # The in-process rate limiter (auth caps, guest cap) keys on client IP, but every test request
    # comes from the same ASGI-transport peer — so without a reset the caps would bleed across tests
    # and 429 later ones. Clear it per test: each test starts fresh, exactly as a real
    # client on its own IP+window would. Tests that assert limiting drive the limiter explicitly.
    from app.core.ratelimit import reset_rate_limits

    reset_rate_limits()

    async def _override_get_session() -> AsyncGenerator[AsyncSession, None]:
        # Yield the test session but never commit — the fixture rolls the whole transaction back.
        yield db_session

    app.dependency_overrides[get_session] = _override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# --- production-content dependency -------------------------------------------------------------
# A handful of suites validate the PRODUCTION challenge corpus itself (bank lint, ingest coverage,
# repo/DB drift) or depend on `campaign_levels.json` resolving against it — the campaign builder
# requires 100 questions per world with a fixed 40/40/20 difficulty spread, which the synthetic
# sample corpus deliberately does not contain.
#
# Those tests belong with the private content, not with the public source tree. They are skipped
# rather than deleted so the dependency stays VISIBLE: run them against a real content root by
# pointing ROT_CONTENT_DIR at it.
def production_content_available() -> bool:
    from app.core.config import settings

    bank = settings.content_root / "bank"
    if not bank.is_dir():
        return False
    import json

    total = 0
    for f in bank.glob("*.json"):
        try:
            total += len(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            return False
    return total >= 600  # the campaign builder's floor: 6 worlds x 100


requires_production_content = pytest.mark.skipif(
    not production_content_available(),
    reason="needs the private production content corpus (set ROT_CONTENT_DIR); the synthetic "
    "sample bank is intentionally too small for campaign/bank-QA suites",
)
