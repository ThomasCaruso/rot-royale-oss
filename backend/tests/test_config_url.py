"""DATABASE_URL normalization (M7) — a raw Render Postgres URL must become asyncpg-usable.

Render's managed Postgres hands out a libpq-style URL; the app/Alembic use asyncpg. The validator
in `Settings` upgrades the scheme and drops libpq-only query params so no manual editing is needed.
"""

from __future__ import annotations

from app.core.config import Settings


def _url(raw: str) -> str:
    return Settings(database_url=raw).database_url


def test_legacy_postgres_scheme_becomes_asyncpg():
    assert _url("postgres://u:p@host:5432/db") == "postgresql+asyncpg://u:p@host:5432/db"


def test_postgresql_scheme_becomes_asyncpg():
    assert _url("postgresql://u:p@host:5432/db") == "postgresql+asyncpg://u:p@host:5432/db"


def test_already_asyncpg_is_untouched():
    raw = "postgresql+asyncpg://u:p@host:5432/db"
    assert _url(raw) == raw


def test_local_default_is_untouched():
    raw = "postgresql+asyncpg://rot_royale:rot_royale@localhost:5432/rot_royale"
    assert _url(raw) == raw


def test_sslmode_param_is_stripped():
    # asyncpg does not understand libpq's sslmode keyword and would raise on it.
    out = _url("postgresql://u:p@host:5432/db?sslmode=require")
    assert out == "postgresql+asyncpg://u:p@host:5432/db"


def test_other_query_params_are_kept_sslmode_dropped():
    out = _url("postgres://u:p@host:5432/db?sslmode=require&application_name=rot")
    assert out == "postgresql+asyncpg://u:p@host:5432/db?application_name=rot"
