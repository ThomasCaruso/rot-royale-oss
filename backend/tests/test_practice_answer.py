"""Lesson-mode per-round feedback for practice (NOT the ranked contest).

After a practice round is answered, the server returns the correct answer AND the question's
explanation (the "learn this" payload) — post-lock, so it's not an anti-cheat leak in no-stakes
practice. The ranked contest reveal must stay unchanged: NO explanation in its payload.
"""

from __future__ import annotations

from app.models import Question, RoundAnswer
from app.models.contest import OPEN
from content.loader import load_trivia
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register", json={"email": email, "username": username, "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _q(prompt: str, *, explanation: str = "Because science.", correct: int = 0) -> Question:
    return Question(
        module_type="trivia",
        category="Science & Nature",
        icon="🔬",
        difficulty="easy",
        status="approved",
        explanation=explanation,
        payload={"prompt": prompt, "options": ["a", "b", "c", "d"], "correctIndex": correct},
    )


async def _answers(session: AsyncSession, entry_id: str) -> list[RoundAnswer]:
    return list(
        (
            await session.execute(
                select(RoundAnswer)
                .where(RoundAnswer.entry_id == entry_id)
                .order_by(RoundAnswer.idx)
            )
        )
        .scalars()
        .all()
    )


def _correct_result(a: RoundAnswer) -> dict:
    if a.module_type == "memory_flash":
        seq = a.server_answer["sequence"]
        return {"taps": seq, "tap_times": [100 * i for i in range(len(seq))], "elapsed_ms": 0}
    return {"choice": a.server_answer["correctIndex"], "elapsed_ms": 0}


async def _start_category(client: AsyncClient, token: str) -> dict:
    return (
        await client.post(
            "/practice/start", headers=_auth(token), json={"category": "Science & Nature"}
        )
    ).json()


async def test_practice_answer_reveals_correct_answer_and_explanation(
    client: AsyncClient, db_session: AsyncSession
):
    db_session.add(_q("Q1", explanation="H2O is the formula for water."))
    await db_session.flush()
    token = await _register(client, "pa1@example.com", "pa1")
    start = await _start_category(client, token)
    a0 = (await _answers(db_session, start["entry_id"]))[0]

    r = await client.post(
        f"/practice/{start['entry_id']}/answer",
        headers=_auth(token),
        json={"idx": 0, "result": {"choice": a0.server_answer["correctIndex"], "elapsed_ms": 0}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["correct"] is True
    assert body["answer"]["correctIndex"] == a0.server_answer["correctIndex"]  # the right answer
    assert body["explanation"] == "H2O is the formula for water."  # the learn-this payload
    assert body["finished"] is False


async def test_practice_wrong_answer_still_reveals_correct_and_explanation(
    client: AsyncClient, db_session: AsyncSession
):
    db_session.add(_q("Q1", explanation="The capital is X."))
    await db_session.flush()
    token = await _register(client, "pa2@example.com", "pa2")
    start = await _start_category(client, token)
    ci = (await _answers(db_session, start["entry_id"]))[0].server_answer["correctIndex"]

    r = await client.post(
        f"/practice/{start['entry_id']}/answer",
        headers=_auth(token),
        json={"idx": 0, "result": {"choice": (ci + 1) % 4, "elapsed_ms": 1}},
    )
    body = r.json()
    assert body["correct"] is False
    assert body["answer"]["correctIndex"] == ci  # wrong answers still teach the right one
    assert body["explanation"] == "The capital is X."


async def test_practice_timeout_null_choice_reveals_without_crashing(
    client: AsyncClient, db_session: AsyncSession
):
    db_session.add(_q("Q1", explanation="why."))
    await db_session.flush()
    token = await _register(client, "pa3@example.com", "pa3")
    start = await _start_category(client, token)
    ci = (await _answers(db_session, start["entry_id"]))[0].server_answer["correctIndex"]

    # timeout = empty result (no choice). Reveal still surfaces the correct answer + explanation.
    r = await client.post(
        f"/practice/{start['entry_id']}/answer",
        headers=_auth(token),
        json={"idx": 0, "result": {}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["correct"] is False
    assert body["answer"]["correctIndex"] == ci
    assert body["explanation"] == "why."


async def test_practice_last_round_finalizes_with_accuracy_and_sharpness(
    client: AsyncClient, db_session: AsyncSession
):
    db_session.add(_q("Q1"))
    await db_session.flush()
    token = await _register(client, "pa4@example.com", "pa4")
    start = await _start_category(client, token)
    answers = await _answers(db_session, start["entry_id"])

    body = None
    for a in answers:  # all correct (single seeded question)
        body = (
            await client.post(
                f"/practice/{start['entry_id']}/answer",
                headers=_auth(token),
                json={"idx": a.idx, "result": _correct_result(a)},
            )
        ).json()
    assert body is not None
    assert body["finished"] is True
    assert body["total"] == 10  # category session = 10 questions
    assert body["accuracy"] == 1.0
    assert body["sharpness"] is not None and body["sharpness_gained"] >= 0

    # entry now SUBMITTED → answering again is rejected
    again = await client.post(
        f"/practice/{start['entry_id']}/answer", headers=_auth(token), json={"idx": 0, "result": {}}
    )
    assert again.status_code == 409


async def test_practice_answer_out_of_order_rejected(client: AsyncClient, db_session: AsyncSession):
    db_session.add(_q("Q1"))
    await db_session.flush()
    token = await _register(client, "pa5@example.com", "pa5")
    start = await _start_category(client, token)
    r = await client.post(
        f"/practice/{start['entry_id']}/answer", headers=_auth(token), json={"idx": 1, "result": {}}
    )
    assert r.status_code == 409  # round 1 before round 0


async def test_mixed_practice_reveals_every_round_type(
    client: AsyncClient, db_session: AsyncSession
):
    # The explanation-absent + no-options paths: a mixed session has trivia (seed → no explanation),
    # rapid_math (options, no explanation), and memory_flash (no options). Each must reveal cleanly.
    await load_trivia(db_session)
    token = await _register(client, "pa6@example.com", "pa6")
    start = (
        await client.post("/practice/start", headers=_auth(token))
    ).json()  # no category → mixed
    answers = await _answers(db_session, start["entry_id"])

    body = None
    for a in answers:
        body = (
            await client.post(
                f"/practice/{start['entry_id']}/answer",
                headers=_auth(token),
                json={"idx": a.idx, "result": _correct_result(a)},
            )
        ).json()
        assert "answer" in body  # a reveal is returned for every module type...
        assert "explanation" in body  # ...and the explanation key is always present (may be null)
    assert body["finished"] is True


async def test_practice_client_spec_never_leaks_answer_or_explanation(
    client: AsyncClient, db_session: AsyncSession
):
    db_session.add(_q("Q1", explanation="secret why"))
    await db_session.flush()
    token = await _register(client, "pa7@example.com", "pa7")
    start = await _start_category(client, token)
    for rnd in start["rounds"]:
        assert "correctIndex" not in rnd["client_spec"]  # answer never pre-sent
        assert "explanation" not in rnd["client_spec"]  # explanation only arrives post-answer


async def test_ranked_contest_reveal_carries_no_explanation(
    client: AsyncClient, db_session: AsyncSession
):
    # The boundary: the ranked contest's per-round reveal must NOT include an explanation field.
    from datetime import UTC, datetime, timedelta

    from app.models import ContestWindow

    await load_trivia(db_session)
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=now.date(),
        slot="night",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=OPEN,
        template_id="m4_night",
    )
    db_session.add(window)
    await db_session.flush()
    token = await _register(client, "pa8@example.com", "pa8")
    enter = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token))).json()
    answers = await _answers(db_session, enter["entry_id"])

    r = await client.post(
        f"/entries/{enter['entry_id']}/answer",
        headers=_auth(token),
        json={"idx": 0, "result": _correct_result(answers[0])},
    )
    assert r.status_code == 200, r.text
    assert "explanation" not in r.json()  # contest reveal unchanged — no learn-this payload
