import pytest
from app.models import Profile
from app.services.offline_content import (
    build_campaign_bundle,
    build_offline_round,
    build_practice_pool,
    compute_bank_version,
)
from content.campaign import manifest as cm
from content.campaign.keys import question_key
from content.ingest import ingest_bank, read_bank_rows
from content.loader import fetch_bank
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def _ingest_banks(session: AsyncSession) -> None:
    """Load the real content/bank/*.json as servable questions into the test transaction."""
    from app.core.config import settings

    rows = read_bank_rows(str(settings.content_root / "bank"))
    report = await ingest_bank(session, rows)
    assert not report.rejected, report.rejected


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register",
        json={"email": email, "username": username, "password": "super-secret-pw"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _q(qid="q1"):
    return {
        "id": qid,
        "category": "Science & Nature",
        "icon": "flask",
        "difficulty": "easy",
        "explanation": "because",
        "payload": {"prompt": "2+2?", "options": ["4", "5", "6", "7"], "correctIndex": 0},
    }


def test_build_offline_round_shuffles_and_maps_back_to_original():
    r = build_offline_round(_q(), idx=0, shuffle_seed=12345)
    # client_spec never carries the raw answer, only shuffled options
    assert set(r["client_spec"].keys()) == {
        "prompt",
        "options",
        "category",
        "icon",
        "time_limit_ms",
    }
    assert sorted(r["client_spec"]["options"]) == ["4", "5", "6", "7"]
    # correct_index points at the shuffled slot holding the originally-correct option ("4")
    assert r["client_spec"]["options"][r["correct_index"]] == "4"
    # option_source_index maps every shuffled slot back to its ORIGINAL bank index
    assert len(r["option_source_index"]) == 4
    assert r["option_source_index"][r["correct_index"]] == 0  # original correctIndex
    assert r["question_id"] == "q1"
    assert r["explanation"] == "because"


def test_bank_version_is_stable_and_content_sensitive():
    bank = [_q("a"), _q("b")]
    v1 = compute_bank_version(bank)
    assert v1 == compute_bank_version(list(bank))  # order/identity stable
    changed = [_q("a"), {**_q("b"), "payload": {**_q("b")["payload"], "correctIndex": 2}}]
    assert compute_bank_version(changed) != v1  # answer change bumps the version


@pytest.mark.asyncio
async def test_build_practice_pool_scoped_and_answer_bearing(db_session: AsyncSession):
    await _ingest_banks(db_session)
    pool = await build_practice_pool(db_session, category="Science & Nature", limit=5)
    assert set(pool.keys()) == {"category", "bank_version", "questions"}
    assert pool["category"] == "Science & Nature"
    assert pool["bank_version"]
    assert 1 <= len(pool["questions"]) <= 5
    for r in pool["questions"]:
        # answer-bearing (local reveal) + stable original-index map, no answer in client_spec
        assert "correct_index" in r
        assert "option_source_index" in r
        assert "correctIndex" not in r["client_spec"]
        assert r["client_spec"]["category"] == "Science & Nature"


@pytest.mark.asyncio
async def test_build_campaign_bundle_resolves_authored_questions(
    client: AsyncClient, db_session: AsyncSession
):
    await _register(client, "offline@example.com", "offlineplayer")
    await _ingest_banks(db_session)
    user_id = await db_session.scalar(select(Profile.user_id).limit(1))

    bundle = await build_campaign_bundle(db_session, user_id, lookahead=1)
    assert bundle["bank_version"]
    assert bundle["levels"], "at least one level should be cacheable (level 1 is always unlocked)"

    bank = await fetch_bank(db_session, "trivia")
    correct_by_key = {
        question_key(q["category"], q["payload"]["prompt"]): int(q["payload"]["correctIndex"])
        for q in bank
    }

    first = bundle["levels"][0]
    level = cm.get_level(first["world"], first["level"])
    assert level is not None
    assert first["rounds"], "the first level's rounds should be non-empty"
    for r, key in zip(first["rounds"], level.question_keys, strict=True):
        # the shuffled slot mapped by option_source_index[correct_index] is the ORIGINAL bank index
        assert r["option_source_index"][r["correct_index"]] == correct_by_key[key]
        assert "correctIndex" not in r["client_spec"]
