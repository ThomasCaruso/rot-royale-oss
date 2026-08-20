"""The error-code contract: every backend code is translated in every locale the app ships.

This is the mechanism that makes localized errors scale. Without it, adding an error code is a
silent English-only regression — it looks fine in dev, and a Spanish player sees English at the
exact moment something has gone wrong. Here, forgetting the translation fails the build instead.

It parses the TS dictionaries as text rather than importing them, because the backend has no JS
runtime. That is deliberately shallow — it checks key PRESENCE, which is the property that actually
regresses. Wording quality is a human review job.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from app.core.errors import ERROR_CODES, ApiErrorCode, english_message

I18N_DIR = Path(__file__).resolve().parents[2] / "frontend" / "src" / "i18n"
LOCALES = ("en", "es", "fr", "tr")


def _errors_block(locale: str) -> str:
    """The body of the `errors: { ... }` namespace in a locale dictionary."""
    text = (I18N_DIR / f"{locale}.ts").read_text(encoding="utf-8")
    m = re.search(r"\n  errors: \{(.+?)\n  \},", text, re.DOTALL)
    assert m, f"{locale}.ts has no `errors` namespace"
    return m.group(1)


def _keys(locale: str) -> set[str]:
    return set(re.findall(r"^\s{4}(\w+):", _errors_block(locale), re.MULTILINE))


@pytest.mark.parametrize("locale", LOCALES)
def test_every_backend_error_code_has_a_translation(locale: str) -> None:
    missing = set(ERROR_CODES) - _keys(locale)
    assert not missing, (
        f"{locale}.ts is missing translations for: {sorted(missing)}. "
        "Every code in app/core/errors.py must be translated in every locale — otherwise a player "
        "sees English at the moment something breaks."
    )


@pytest.mark.parametrize("locale", LOCALES)
def test_no_orphan_translations(locale: str) -> None:
    """A translation with no backend code is dead weight and usually a rename that missed a side."""
    orphans = _keys(locale) - set(ERROR_CODES)
    assert not orphans, f"{locale}.ts translates codes the backend never sends: {sorted(orphans)}"


def test_all_locales_agree() -> None:
    base = _keys("en")
    for locale in LOCALES[1:]:
        assert _keys(locale) == base, f"{locale}.ts error keys differ from en.ts"


def test_codes_are_snake_case() -> None:
    """The client identifies a code by shape (`/^[a-z0-9_]+$/`). A code that fails that test is
    treated as prose and falls back to a generic message, so the shape IS the contract."""
    bad = [c for c in ERROR_CODES if not re.fullmatch(r"[a-z0-9_]+", c)]
    assert not bad, f"error codes must be snake_case (the client matches on shape): {bad}"


def test_raising_uses_the_registry_status_and_code() -> None:
    exc = ApiErrorCode("window_not_open")
    assert exc.detail == "window_not_open", "detail must be the CODE, never prose"
    assert exc.status_code == ERROR_CODES["window_not_open"][0]


def test_an_unregistered_code_fails_loudly() -> None:
    """Typos must not reach production as an untranslatable code."""
    with pytest.raises(KeyError, match="unknown error code"):
        ApiErrorCode("definitely_not_a_real_code")


def test_english_message_is_available_for_logs() -> None:
    assert english_message("window_not_open") == "That window is not open for entry"
