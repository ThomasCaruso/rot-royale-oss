"""Per-round answer + reveal endpoint (Phase A): the Kahoot rhythm's server side.

The load-bearing test is `test_per_round_scoring_matches_batch`: incremental per-round scoring must
equal batch `score_entry` over the same submissions (so we didn't fork the scoring formula).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.models import ContestWindow, RoundAnswer
from app.models.contest import CLOSED, OPEN
from app.services.contest import (
    EntryNotSubmittableError,
    RoundSequenceError,
    answer_round,
)
from app.services.scoring import score_entry
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


async def _open_window(session: AsyncSession, *, template_id: str = "m4_night") -> ContestWindow:
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=now.date(),
        slot="night",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=OPEN,
        template_id=template_id,
    )
    session.add(window)
    await session.flush()
    return window


async def _round_answers(session: AsyncSession, entry_id: str) -> list[RoundAnswer]:
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


def _correct(module_type: str, server_answer: dict) -> dict:
    if module_type == "memory_flash":
        seq = server_answer["sequence"]
        return {"taps": seq, "tap_times": [100 * i for i in range(len(seq))], "elapsed_ms": 0}
    # trivia / rapid_math all submit a single {choice}
    return {"choice": server_answer["correctIndex"], "elapsed_ms": 0}


def _wrong(module_type: str, server_answer: dict) -> dict:
    if module_type == "memory_flash":
        return {"taps": [], "tap_times": [], "elapsed_ms": 1}
    return {"choice": server_answer["correctIndex"] + 1, "elapsed_ms": 1}


async def _enter(
    client: AsyncClient, db_session: AsyncSession, token: str
) -> tuple[str, uuid.UUID]:
    window = await _open_window(db_session)
    enter = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token))).json()
    me = (await client.get("/me", headers=_auth(token))).json()
    return enter["entry_id"], uuid.UUID(me["user_id"])


async def test_per_round_scoring_matches_batch(client: AsyncClient, db_session: AsyncSession):
    # The equivalence guarantee: the per-round path uses the SAME points/streak formula as batch
    # score_entry (no forked scoring). answer_round now also VERIFIES the answer time against the
    # server clock, so for equivalence to hold the injected timing must be plausible: each round is
    # answered after a gap leaving exactly its claimed think-time once the fixed UI overhead is
    # removed. With honest timing the verification is a no-op and both paths compute equal points.
    from datetime import timedelta

    from app.models import Entry
    from app.services.answer_timing import ROUND_REVEAL_MS, ROUND_SPLASH_MS

    await load_trivia(db_session)
    token = await _register(client, "ar1@example.com", "ar1")
    entry_id, user_id = await _enter(client, db_session, token)
    answers = await _round_answers(db_session, entry_id)
    started_at = (await db_session.get(Entry, uuid.UUID(entry_id))).started_at

    # Honest think-time of 5s per round; correct rounds carry it, wrong rounds score 0 regardless.
    think_ms = 5000

    def sub_for(a, correct: bool) -> dict:
        base = (_correct if correct else _wrong)(a.module_type, a.server_answer)
        return {**base, "elapsed_ms": think_ms if correct else 1}

    # A mixed correct/wrong sequence so streaks build AND reset (the hard case for incremental).
    subs = {a.idx: sub_for(a, i % 2 == 0) for i, a in enumerate(answers)}

    batch_results, batch_total = score_entry(
        [(a.idx, a.module_type, a.server_answer) for a in answers], subs
    )
    batch_points = {r.idx: r.points for r in batch_results}

    # Inject each round's server answer time so the measured gap = UI overhead + the honest think
    # time → the verification floors nothing and the per-round time_frac equals batch's.
    running = 0
    prev = started_at
    for a in answers:
        overhead = ROUND_SPLASH_MS if a.idx == 0 else (ROUND_REVEAL_MS + ROUND_SPLASH_MS)
        now = prev + timedelta(milliseconds=overhead + think_ms)
        outcome = await answer_round(
            db_session, uuid.UUID(entry_id), user_id, a.idx, subs[a.idx], now=now
        )
        assert outcome.points == batch_points[a.idx], f"round {a.idx} points diverged"
        running = outcome.total_score
        prev = now
    assert running == batch_total  # final running total == batch total


async def test_last_round_finalizes_entry(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "ar2@example.com", "ar2")
    entry_id, user_id = await _enter(client, db_session, token)
    answers = await _round_answers(db_session, entry_id)

    outcome = None
    for a in answers:
        outcome = await answer_round(
            db_session,
            uuid.UUID(entry_id),
            user_id,
            a.idx,
            _correct(a.module_type, a.server_answer),
        )
        assert outcome.idx == a.idx
        assert outcome.server_answer == a.server_answer  # reveal carries the answer (post-lock)
    assert outcome is not None and outcome.finished is True

    # entry is now SUBMITTED — answering again is rejected.
    with pytest.raises(EntryNotSubmittableError):
        await answer_round(db_session, uuid.UUID(entry_id), user_id, 0, {})


async def test_out_of_order_rejected(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "ar3@example.com", "ar3")
    entry_id, user_id = await _enter(client, db_session, token)
    with pytest.raises(RoundSequenceError):  # round 1 before round 0
        await answer_round(db_session, uuid.UUID(entry_id), user_id, 1, {})


async def test_double_answer_same_round_rejected(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "ar4@example.com", "ar4")
    entry_id, user_id = await _enter(client, db_session, token)
    answers = await _round_answers(db_session, entry_id)
    await answer_round(
        db_session,
        uuid.UUID(entry_id),
        user_id,
        0,
        _correct(answers[0].module_type, answers[0].server_answer),
    )
    with pytest.raises(RoundSequenceError):  # idx 0 already answered
        await answer_round(db_session, uuid.UUID(entry_id), user_id, 0, {})


async def test_answer_then_batch_submit_is_rejected_answer_oracle(
    client: AsyncClient, db_session: AsyncSession
):
    """C-1 regression: the per-round /answer reveal must not become an oracle for /submit.

    /answer reveals each round's correct index after locking it in (safe alone) but only finalizes
    the entry on the LAST round. If a player answered rounds 0..N-2 (harvesting every correctIndex
    while the entry stays IN_PROGRESS) then batch-/submit all N with the harvested answers,
    that is a guaranteed near-perfect score. This pins that /submit refuses an entry that has ANY
    recorded round_result — checking status alone did not catch it, since /answer leaves the entry
    IN_PROGRESS until the final round. Reproduced live before the fix (7/8, score 1600)."""
    await load_trivia(db_session)
    token = await _register(client, "oracle@example.com", "oracle")
    window = await _open_window(db_session)
    enter = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token))).json()
    entry_id = enter["entry_id"]
    answers = await _round_answers(db_session, entry_id)
    n = len(answers)

    # Harvest via /answer for every round except the last (entry stays IN_PROGRESS).
    harvested: dict[int, dict] = {}
    for a in answers[: n - 1]:
        r = await client.post(
            f"/entries/{entry_id}/answer",
            headers=_auth(token),
            json={"idx": a.idx, "result": {"choice": 0, "elapsed_ms": 0}},
        )
        assert r.status_code == 200, r.text
        harvested[a.idx] = r.json()["answer"]

    # Attempt the batch /submit with the harvested answers — must be REJECTED, not scored.
    rounds = [
        {
            "idx": a.idx,
            "result": {"choice": harvested.get(a.idx, {}).get("correctIndex", 0), "elapsed_ms": 0},
        }
        for a in answers
    ]
    r = await client.post(
        f"/entries/{entry_id}/submit", headers=_auth(token), json={"rounds": rounds}
    )
    assert r.status_code == 409, f"answer-oracle exploit not blocked: {r.status_code} {r.text}"


async def test_pure_batch_submit_works_but_earns_no_speed_bonus(
    client: AsyncClient, db_session: AsyncSession
):
    """The batch path still works for an entry that never used /answer, BUT (H-3) it credits no
    speed bonus: batch carries no server-measured per-round timing, so a self-reported `elapsed_ms`
    is unverifiable and would let a caller claim time_frac 1.0 on every round. Each round is scored
    at time_frac 0 (base points), regardless of the elapsed_ms sent. The ranked client never uses
    this path — it plays round-by-round through /answer."""
    from app.models import RoundResult as RR
    from sqlalchemy import select as sa_select

    await load_trivia(db_session)
    token = await _register(client, "batch@example.com", "batch")
    window = await _open_window(db_session)
    enter = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token))).json()
    answers = await _round_answers(db_session, enter["entry_id"])
    # Every round correct, all claiming elapsed_ms:0 (the would-be exploit input). `_correct`
    # already sends elapsed_ms:0 and builds the right shape per module type.
    rounds = [{"idx": a.idx, "result": _correct(a.module_type, a.server_answer)} for a in answers]
    r = await client.post(
        f"/entries/{enter['entry_id']}/submit", headers=_auth(token), json={"rounds": rounds}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_score"] > 0  # base points still awarded for correct answers
    # No speed bonus anywhere: every stored round_result has time_frac 0 despite elapsed_ms:0.
    stored = (
        (await db_session.execute(sa_select(RR).where(RR.entry_id == uuid.UUID(enter["entry_id"]))))
        .scalars()
        .all()
    )
    assert stored and all(float(r.time_frac) == 0.0 for r in stored), [
        float(r.time_frac) for r in stored
    ]


async def test_answer_via_api_and_closed_window(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "ar5@example.com", "ar5")
    window = await _open_window(db_session)
    enter = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token))).json()
    answers = await _round_answers(db_session, enter["entry_id"])

    r = await client.post(
        f"/entries/{enter['entry_id']}/answer",
        headers=_auth(token),
        json={"idx": 0, "result": _correct(answers[0].module_type, answers[0].server_answer)},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["idx"] == 0 and "answer" in body and "total_score" in body

    # close the window → further answers rejected.
    window.state = CLOSED
    window.close_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.flush()
    r2 = await client.post(
        f"/entries/{enter['entry_id']}/answer", headers=_auth(token), json={"idx": 1, "result": {}}
    )
    assert r2.status_code == 409


async def test_field_and_my_entry(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "field1@example.com", "fielder1")
    window = await _open_window(db_session)
    enter = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token))).json()

    # Before finishing: my_entry is IN_PROGRESS, and I am not yet in the field. The field holds REAL
    # submitted entries only — nobody has finished, so it is genuinely empty rather than bot-padded.
    me_entry = (await client.get(f"/contests/{window.id}/entry", headers=_auth(token))).json()
    assert me_entry["entry_id"] == enter["entry_id"]
    assert me_entry["status"] == "IN_PROGRESS"
    field0 = (await client.get(f"/contests/{window.id}/field", headers=_auth(token))).json()
    assert field0["entries"] == []  # no synthetic padding: an unplayed window has an empty field

    # Finish the run, then I appear in the field — as the only entrant, because I am the only one.
    answers = await _round_answers(db_session, enter["entry_id"])
    for a in answers:
        await client.post(
            f"/entries/{enter['entry_id']}/answer",
            headers=_auth(token),
            json={"idx": a.idx, "result": _correct(a.module_type, a.server_answer)},
        )
    field1 = (await client.get(f"/contests/{window.id}/field", headers=_auth(token))).json()
    assert len(field1["entries"]) == 1  # exactly the one real entrant
    mine = next(e for e in field1["entries"] if e["username"] == "fielder1")
    assert len(mine["points"]) == len(answers)
    me_entry2 = (await client.get(f"/contests/{window.id}/entry", headers=_auth(token))).json()
    assert me_entry2["status"] == "SUBMITTED"


async def test_my_entry_null_before_entering(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "field2@example.com", "fielder2")
    window = await _open_window(db_session)
    r = (await client.get(f"/contests/{window.id}/entry", headers=_auth(token))).json()
    assert r["entry_id"] is None  # no entry yet → lobby shows the playable state
