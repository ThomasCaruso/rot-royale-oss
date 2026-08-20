"""The public/private content boundary (Phase 2).

The publication blocker was never the algorithm — `window_seed` and `build_round_set` can be fully
public — it was the DATA. These tests pin the boundary that replaced it:

    APP_ENV != production, ROT_CONTENT_DIR unset  -> synthetic sample corpus
    APP_ENV == production, ROT_CONTENT_DIR unset  -> refuse to start
    APP_ENV == production, ROT_CONTENT_DIR set    -> exactly that directory

The production rule has no fallback on purpose. Serving placeholder questions in a ranked contest
would be a worse failure than not booting at all, and it would be silent.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from app.core.config import SAMPLE_CONTENT_DIR, Settings

STRONG = "z" * 40


def _cfg(**kw) -> Settings:
    return Settings(_env_file=None, **kw)


@pytest.fixture(autouse=True)
def _no_ambient_content_root(monkeypatch):
    """These tests pin RESOLUTION RULES, so they must not inherit the developer's shell.

    `_env_file=None` suppresses .env but NOT os.environ, so running the suite with ROT_CONTENT_DIR
    exported — exactly what you do to exercise the private package — silently turned every
    "defaults to the sample corpus" and "refuses to start" assertion into a test of the ambient
    environment instead. Tests that want the variable set still set it themselves; monkeypatch
    within the test body wins over this fixture.
    """
    monkeypatch.delenv("ROT_CONTENT_DIR", raising=False)
    monkeypatch.delenv("CONTENT_DIR", raising=False)


# ---------------- resolution ----------------


def test_development_defaults_to_the_sample_corpus():
    assert _cfg(app_env="local").content_root == SAMPLE_CONTENT_DIR


def test_explicit_root_is_honoured(tmp_path: Path):
    assert _cfg(app_env="local", content_dir=str(tmp_path)).content_root == tmp_path


def test_production_refuses_to_start_without_a_content_root():
    with pytest.raises(ValueError, match="ROT_CONTENT_DIR"):
        _cfg(app_env="production", secret_key=STRONG)


def test_production_refuses_a_content_root_that_is_not_there():
    with pytest.raises(ValueError, match="ROT_CONTENT_DIR"):
        _cfg(app_env="production", secret_key=STRONG, content_dir="/no/such/private/content")


def test_production_accepts_an_explicit_existing_root(tmp_path: Path):
    cfg = _cfg(app_env="production", secret_key=STRONG, content_dir=str(tmp_path))
    assert cfg.content_root == tmp_path


def test_production_never_silently_uses_the_sample_corpus():
    """The specific accident this guards: a correct cleanup followed by a deploy that quietly
    serves synthetic questions to real ranked players."""
    with pytest.raises(ValueError):
        _cfg(app_env="production", secret_key=STRONG)
    cfg = _cfg(app_env="production", secret_key=STRONG, content_dir=str(SAMPLE_CONTENT_DIR))
    assert cfg.content_root == SAMPLE_CONTENT_DIR  # explicit is allowed; implicit is not


def test_the_env_var_is_actually_named_ROT_CONTENT_DIR(monkeypatch):
    """The field must bind to ROT_CONTENT_DIR, the name render.yaml and the runbooks use.

    pydantic-settings derives the variable from the FIELD name by default, so `content_dir` would
    read CONTENT_DIR and quietly ignore ROT_CONTENT_DIR — leaving content_dir empty, which makes
    the production guard refuse to boot every service. A deployment-shaped failure with a
    spelling-shaped cause, so it gets an explicit test rather than trust.
    """
    monkeypatch.setenv("ROT_CONTENT_DIR", "/tmp/some-private-content")
    monkeypatch.delenv("CONTENT_DIR", raising=False)
    assert Settings(_env_file=None).content_dir == "/tmp/some-private-content"


def test_render_declares_the_same_variable_the_code_reads():
    """render.yaml and the Settings field must name the SAME variable.

    This is the drift that would take production down: the blueprint sets ROT_CONTENT_DIR, the field
    binds to something else, content_dir stays empty, and the production guard refuses to boot every
    service. Asserting the two agree catches it from either side — renaming the field, or renaming
    the key in the blueprint.
    """
    import re

    from app.core.config import Settings

    field = Settings.model_fields["content_dir"]
    alias = field.validation_alias
    assert alias == "ROT_CONTENT_DIR", f"field binds to {alias!r}"

    render = (Path(__file__).resolve().parents[2] / "render.yaml").read_text(encoding="utf-8")
    declared = set(re.findall(r"- key: (ROT_[A-Z_]+)", render))
    assert "ROT_CONTENT_DIR" in declared, f"render.yaml declares {declared or 'no ROT_* keys'}"


# ---------------- the sample corpus itself ----------------


def test_sample_bank_parses_and_is_servable():
    from content.ingest import read_bank_rows

    rows = read_bank_rows(str(SAMPLE_CONTENT_DIR / "bank"))
    assert len(rows) >= 30
    cats = {r["category"] for r in rows}
    assert len(cats) >= 6, f"expected ~6 categories, got {sorted(cats)}"


def test_sample_fermi_parses():
    items = json.loads((SAMPLE_CONTENT_DIR / "estimate" / "fermi.json").read_text(encoding="utf-8"))
    assert len(items) >= 8
    assert all(isinstance(i["answer"], (int, float)) and i["answer"] > 0 for i in items)


def test_sample_change_manifest_parses():
    from content.change_manifest import read_manifest, validate_manifest

    data = read_manifest(SAMPLE_CONTENT_DIR / "change" / "manifest.json")
    problems = validate_manifest(data)
    assert not problems, problems
    items = data["items"]
    assert len(items) == 2
    for it in items:
        b = it["bbox"]
        assert 0 <= b["x"] < 1 and 0 <= b["y"] < 1 and 0 < b["w"] <= 1 and 0 < b["h"] <= 1


def test_sample_change_images_exist():
    from content import change_assets

    for it in json.loads(
        (SAMPLE_CONTENT_DIR / "change" / "manifest.json").read_text(encoding="utf-8")
    )["items"]:
        for asset in (it["base_asset"], it["altered_asset"]):
            assert change_assets.resolve(SAMPLE_CONTENT_DIR, asset) is not None, asset


def test_sample_legacy_seed_parses():
    rows = json.loads((SAMPLE_CONTENT_DIR / "trivia.json").read_text(encoding="utf-8"))
    assert len(rows) >= 30
    assert all(0 <= r["correctIndex"] < len(r["options"]) for r in rows)
