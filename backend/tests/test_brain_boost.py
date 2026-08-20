"""Brain Boost: starter calibration round, Brain Profile summary, Brain Score/Type, today state."""

from __future__ import annotations

import uuid
from typing import Any

from app.models import Question, QuestionAIMetadata, RoundAnswer
from app.services.brain_boost import SCORE_MAX, SCORE_MIN, rot_type_for
from content.loader import load_trivia
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _guest(client: AsyncClient) -> str:
    r = await client.post("/auth/guest")
    assert r.status_code == 200, r.text
    return str(r.json()["access_token"])


async def _play_check(
    client: AsyncClient,
    db_session: AsyncSession,
    token: str,
    mode: str = "starter",
    *,
    correct: bool = True,
    elapsed_ms: int = 2000,
) -> str:
    """Start + fully answer a check; answers read from stored server answers (option shuffle)."""
    r = await client.post("/practice/start", json={"mode": mode}, headers=_auth(token))
    assert r.status_code == 200, r.text
    entry_id: str = r.json()["entry_id"]
    answers = (
        (
            await db_session.execute(
                select(RoundAnswer)
                .where(RoundAnswer.entry_id == uuid.UUID(entry_id))
                .order_by(RoundAnswer.idx)
            )
        )
        .scalars()
        .all()
    )
    for a in answers:
        choice = (
            a.server_answer["correctIndex"]
            if correct
            else (a.server_answer["correctIndex"] + 1) % 4
        )
        r = await client.post(
            f"/practice/{entry_id}/answer",
            json={"idx": a.idx, "result": {"choice": choice, "elapsed_ms": elapsed_ms}},
            headers=_auth(token),
        )
        assert r.status_code == 200, r.text
    return entry_id


async def test_starter_check_is_playable_without_account_and_spreads_categories(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await load_trivia(db_session)
    token = await _guest(client)  # anonymous — no register, no login
    r = await client.post("/practice/start", json={"mode": "starter"}, headers=_auth(token))
    assert r.status_code == 200, r.text
    rounds = r.json()["rounds"]
    assert len(rounds) == 8
    assert all(rnd["type"] == "trivia" for rnd in rounds)
    for rnd in rounds:
        assert "correctIndex" not in rnd["client_spec"]  # anti-cheat unchanged
    # Calibration bank is category-balanced → the 8 draws should span several categories.
    categories = {rnd["client_spec"]["category"] for rnd in rounds}
    assert len(categories) >= 3


async def test_summary_computes_strengths_weaknesses_and_perfect_score_shape(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await load_trivia(db_session)
    token = await _guest(client)
    entry_id = await _play_check(client, db_session, token, correct=True, elapsed_ms=1000)

    r = await client.get(f"/brain-boost/{entry_id}/summary", headers=_auth(token))
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["total"] == 8 and s["correct"] == 8
    assert s["first_check"] is True and s["movements"] == {}
    assert SCORE_MIN <= s["brain_score"] <= SCORE_MAX
    assert s["brain_score"] > 700  # all-correct + fast should read high
    assert 1 <= len(s["strengths"]) <= 3
    assert s["strengths"][0]["accuracy"] == 1.0
    # All-correct → weaknesses may exist (bottom categories) but never at 0 accuracy.
    for w in s["weaknesses"]:
        assert w["accuracy"] == 1.0
    assert s["rot_type"]  # deterministic non-empty label


async def test_all_wrong_scores_low_and_reads_rookie(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await load_trivia(db_session)
    token = await _guest(client)
    entry_id = await _play_check(client, db_session, token, correct=False, elapsed_ms=9000)
    s = (await client.get(f"/brain-boost/{entry_id}/summary", headers=_auth(token))).json()
    assert s["correct"] == 0
    assert SCORE_MIN <= s["brain_score"] < 450
    assert s["rot_type"] == "Money Rookie"


async def test_brain_score_is_stable_for_the_same_entry(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await load_trivia(db_session)
    token = await _guest(client)
    entry_id = await _play_check(client, db_session, token)
    a = (await client.get(f"/brain-boost/{entry_id}/summary", headers=_auth(token))).json()
    b = (await client.get(f"/brain-boost/{entry_id}/summary", headers=_auth(token))).json()
    assert a["brain_score"] == b["brain_score"]
    assert a["rot_type"] == b["rot_type"]


def test_rot_type_assigned_from_top_category() -> None:
    from app.services.brain_boost import CategoryPerf

    perf = [
        CategoryPerf("Sports", 3, 3, 1.0, 0.8),
        CategoryPerf("History", 1, 2, 0.5, 0.5),
    ]
    assert rot_type_for(perf, 0.8) == "Sports Demon"
    assert rot_type_for(perf, 0.2) == "Money Rookie"  # very low read overrides
    assert rot_type_for([], 0.8) == "Internet Scholar"


async def test_weak_spot_topic_null_without_metadata_then_present_with_it(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await load_trivia(db_session)
    token = await _guest(client)
    entry_id = await _play_check(client, db_session, token, correct=False)

    s = (await client.get(f"/brain-boost/{entry_id}/summary", headers=_auth(token))).json()
    assert s["weak_spot_topic"] is None  # classifier never ran — graceful fallback

    # Classify one missed question by hand → the topic surfaces.
    answer = await db_session.scalar(
        select(RoundAnswer).where(RoundAnswer.entry_id == uuid.UUID(entry_id))
    )
    assert answer is not None
    qid = uuid.UUID(str(answer.server_answer["question_id"]))
    meta_kwargs: dict[str, Any] = dict.fromkeys(
        (
            "difficulty_score humor_score brainrot_score educational_score "
            "controversy_risk ambiguity_risk quality_score llm_confidence"
        ).split(),
        0.5,
    )
    db_session.add(
        QuestionAIMetadata(
            question_id=qid,
            category=(await db_session.get(Question, qid)).category,  # type: ignore[union-attr]
            topic_tags=["compound interest"],
            knowledge_type="specific_fact",
            freshness_type="evergreen",
            needs_review=False,
            classification_version="v1",
            **meta_kwargs,
        )
    )
    await db_session.flush()
    s = (await client.get(f"/brain-boost/{entry_id}/summary", headers=_auth(token))).json()
    assert s["weak_spot_topic"] == "Compound Interest"


async def test_today_state_and_movement_vs_previous_check(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await load_trivia(db_session)
    token = await _guest(client)

    r = await client.get("/brain-boost/today", headers=_auth(token))
    assert r.json() == {"completed_today": False, "has_any_check": False, "latest": None}

    await _play_check(client, db_session, token, mode="starter", correct=False)
    t1 = (await client.get("/brain-boost/today", headers=_auth(token))).json()
    assert t1["completed_today"] is True and t1["has_any_check"] is True
    assert t1["latest"]["first_check"] is True

    await _play_check(client, db_session, token, mode="quick", correct=True)
    t2 = (await client.get("/brain-boost/today", headers=_auth(token))).json()
    assert t2["latest"]["first_check"] is False
    # 0% → 100% accuracy: every shared category moved up.
    assert t2["latest"]["movements"]
    assert all(delta > 0 for delta in t2["latest"]["movements"].values())


async def test_summary_is_owner_only_and_check_modes_only(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await load_trivia(db_session)
    token = await _guest(client)
    entry_id = await _play_check(client, db_session, token)

    stranger = await _guest(client)
    r = await client.get(f"/brain-boost/{entry_id}/summary", headers=_auth(stranger))
    assert r.status_code == 404

    # A plain 5-round practice session is not a "check".
    r = await client.post("/practice/start", json={}, headers=_auth(token))
    plain_id = r.json()["entry_id"]
    r = await client.get(f"/brain-boost/{plain_id}/summary", headers=_auth(token))
    assert r.status_code == 404
