"""An explicit TLS requirement must never be discarded silently (Audit 2B TLS finding).

`_normalize_pg_url` strips `sslmode` and `channel_binding` because asyncpg rejects those libpq-only
parameters. That is correct for Render's INTERNAL same-region connection, which is what production
uses and which does not need TLS.

The danger is the quiet case: paste an EXTERNAL database URL carrying `?sslmode=require` — for a
migration from a laptop, or a new out-of-region service — and the requirement is dropped with no
signal, running plaintext over the public internet. It keeps working, just less safely. That is the
same failure shape as the JWT-secret default, and it gets the same treatment: say something.
"""

from __future__ import annotations

import logging

import pytest
from app.core.config import Settings


def _s(url: str) -> Settings:
    return Settings(_env_file=None, database_url=url)


def test_internal_render_url_is_unchanged_and_silent(caplog):
    """The production path must keep working exactly as before, with no new noise."""
    with caplog.at_level(logging.WARNING, logger="app.core.config"):
        out = _s("postgresql://u:p@dpg-abc123-a/rot_royale").database_url
    assert out.startswith("postgresql+asyncpg://")
    assert caplog.text == ""


def test_localhost_url_is_unchanged_and_silent(caplog):
    with caplog.at_level(logging.WARNING, logger="app.core.config"):
        out = _s("postgresql://u:p@localhost:5432/rot_royale").database_url
    assert out.startswith("postgresql+asyncpg://")
    assert caplog.text == ""


def test_libpq_params_are_still_stripped_for_asyncpg():
    """The reason the stripping exists in the first place: asyncpg raises on these keywords."""
    out = _s("postgresql://u:p@localhost:5432/db?sslmode=require&application_name=rot").database_url
    assert "sslmode" not in out
    assert "channel_binding" not in out
    assert "application_name=rot" in out  # unrelated params survive


def test_external_host_requesting_tls_warns_loudly(caplog):
    """An EXTERNAL host that explicitly asked for TLS must not be downgraded in silence."""
    with caplog.at_level(logging.WARNING, logger="app.core.config"):
        _s("postgresql://u:p@db.example.com:5432/rot?sslmode=require")
    assert "sslmode" in caplog.text.lower()
    assert "tls" in caplog.text.lower() or "ssl" in caplog.text.lower()


def test_the_warning_never_contains_credentials(caplog):
    """A warning that leaks the password into logs would be worse than the problem."""
    with caplog.at_level(logging.WARNING, logger="app.core.config"):
        _s("postgresql://myuser:supersecretpw@db.example.com:5432/rot?sslmode=require")
    assert "supersecretpw" not in caplog.text
    assert "myuser" not in caplog.text
    assert "db.example.com" in caplog.text  # the host IS useful and is not a secret


@pytest.mark.parametrize("mode", ["require", "verify-full", "verify-ca"])
def test_every_tls_demanding_mode_warns(caplog, mode: str):
    with caplog.at_level(logging.WARNING, logger="app.core.config"):
        _s(f"postgresql://u:p@db.example.com/rot?sslmode={mode}")
    assert "sslmode" in caplog.text.lower()


def test_external_host_NOT_requesting_tls_is_silent(caplog):
    """No demand was made, so there is nothing to warn about."""
    with caplog.at_level(logging.WARNING, logger="app.core.config"):
        _s("postgresql://u:p@db.example.com:5432/rot")
    assert caplog.text == ""
