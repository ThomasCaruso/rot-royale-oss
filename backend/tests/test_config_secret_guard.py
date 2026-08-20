"""Production must refuse to boot with a guessable JWT signing key.

The default is committed in source. Once the repository is public it stops being obscure and
becomes a known constant that anyone can try against any deployment — an attacker who has it can
mint a token for any user_id, including an admin. The failure mode this guards is silent: without
it, a service that simply forgets SECRET_KEY starts up perfectly and accepts forged tokens.
"""

from __future__ import annotations

import pathlib

import pytest
from app.core.config import DEV_SECRET_KEY, MIN_SECRET_KEY_LENGTH, Settings

STRONG = "x" * MIN_SECRET_KEY_LENGTH


def _settings(**kw):
    # _env_file=None so a developer's real backend/.env can't mask what the test is asserting.
    # Production also requires a content root (Phase 2), so supply one unless the test overrides it
    # — otherwise these assertions would pass for the wrong reason.
    if kw.get("app_env") in ("production", "prod", "staging"):
        kw.setdefault(
            "content_dir", str(pathlib.Path(__file__).resolve().parents[1] / "content" / "sample")
        )
    return Settings(_env_file=None, **kw)


def test_production_refuses_the_committed_default():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        _settings(app_env="production", secret_key=DEV_SECRET_KEY)


def test_production_refuses_a_short_secret():
    """A short key is brute-forcible offline against any captured token, which for HS256 is every
    token the client holds."""
    with pytest.raises(ValueError, match="SECRET_KEY"):
        _settings(app_env="production", secret_key="short")


def test_production_refuses_an_empty_secret():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        _settings(app_env="production", secret_key="")


def test_production_accepts_a_strong_secret():
    assert _settings(app_env="production", secret_key=STRONG).secret_key == STRONG


@pytest.mark.parametrize("env", ["local", "development", "test"])
def test_non_production_still_boots_on_the_default(env: str):
    """Local development must not need a secret configured — the guard is about production only."""
    assert _settings(app_env=env, secret_key=DEV_SECRET_KEY).secret_key == DEV_SECRET_KEY


def test_non_production_default_is_flagged_as_insecure():
    """It boots, but the app can tell it is unsafe — used to emit a startup warning rather than
    letting a dev-secret deployment look identical to a real one."""
    assert _settings(app_env="local", secret_key=DEV_SECRET_KEY).secret_key_is_insecure is True
    assert _settings(app_env="local", secret_key=STRONG).secret_key_is_insecure is False
