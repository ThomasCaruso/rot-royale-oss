"""Contest play API: enter / submit. Covers the M2 anti-cheat requirements."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.core.config import settings
from app.models import ContestWindow, Entry, RoundAnswer, User
from app.models.contest import CLOSED, IN_PROGRESS, OPEN
from app.services import templates
from app.services.contest import AlreadyEnteredError, enter_contest
from app.services.templates import ContestTemplate, RoundSlot
from content.loader import load_trivia
from httpx import AsyncClient
from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine


async def _open_window(
    session: AsyncSession, *, state: str = OPEN, template_id: str = "m2_trivia_7"
) -> ContestWindow:
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=now.date(),
        slot="midday",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=state,
        template_id=template_id,
    )
    session.add(window)
    await session.flush()
    return window


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register", json={"email": email, "username": username, "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_enter_returns_specs_without_answers(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    window = await _open_window(db_session)
    token = await _register(client, "p1@example.com", "player1")

    r = await client.post(f"/contests/{window.id}/enter", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["rounds"]) == 7
    for rnd in body["rounds"]:
        spec = rnd["client_spec"]
        assert "prompt" in spec and "options" in spec
        assert "correctIndex" not in spec  # answer must never reach the client
        assert "question_id" not in spec


async def test_daily_royale_same_questions_for_everyone(
    client: AsyncClient, db_session: AsyncSession
):
    """Wordle property: every player in a window gets the IDENTICAL questions and option order,
    so the leaderboard and the 'beat my score' share are truly apples-to-apples. The seed is
    derived from the window (contest_date + slot), not a per-entry random draw."""
    await load_trivia(db_session)
    window = await _open_window(db_session)
    t1 = await _register(client, "alice@example.com", "alice")
    t2 = await _register(client, "bob@example.com", "bob")

    r1 = await client.post(f"/contests/{window.id}/enter", headers=_auth(t1))
    r2 = await client.post(f"/contests/{window.id}/enter", headers=_auth(t2))
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)

    def specs(body: dict) -> list[tuple[str, list[str]]]:
        return [(r["client_spec"]["prompt"], r["client_spec"]["options"]) for r in body["rounds"]]

    # Same prompts AND same option order — the puzzle is identical for both players.
    assert specs(r1.json()) == specs(r2.json())


async def test_daily_royale_varies_across_days(client: AsyncClient, db_session: AsyncSession):
    """The shared seed is per-window, so a different contest date yields a different puzzle."""
    await load_trivia(db_session)
    now = datetime.now(UTC)
    today = await _open_window(db_session)
    yesterday = ContestWindow(
        contest_date=now.date() - timedelta(days=1),
        slot="midday",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=OPEN,
        template_id="m2_trivia_7",
    )
    db_session.add(yesterday)
    await db_session.flush()
    token = await _register(client, "carol@example.com", "carol")

    a = await client.post(f"/contests/{today.id}/enter", headers=_auth(token))
    b = await client.post(f"/contests/{yesterday.id}/enter", headers=_auth(token))
    assert a.status_code == 200 and b.status_code == 200, (a.text, b.text)

    prompts_a = [r["client_spec"]["prompt"] for r in a.json()["rounds"]]
    prompts_b = [r["client_spec"]["prompt"] for r in b.json()["rounds"]]
    assert prompts_a != prompts_b


async def test_one_entry_per_window(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    window = await _open_window(db_session)
    token = await _register(client, "p1@example.com", "player1")

    first = await client.post(f"/contests/{window.id}/enter", headers=_auth(token))
    assert first.status_code == 200
    second = await client.post(f"/contests/{window.id}/enter", headers=_auth(token))
    assert second.status_code == 409  # pre-check rejects before any failing insert


async def test_enter_rejected_when_window_not_open(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    window = await _open_window(db_session, state=CLOSED)
    token = await _register(client, "p1@example.com", "player1")
    r = await client.post(f"/contests/{window.id}/enter", headers=_auth(token))
    assert r.status_code == 409


async def test_submit_scores_server_side_and_ignores_client_score(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    window = await _open_window(db_session)
    token = await _register(client, "p1@example.com", "player1")
    entry = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token))).json()
    entry_id = entry["entry_id"]

    # Read the stored correct answers (test has DB access) to answer everything correctly.
    answers = (
        (
            await db_session.execute(
                select(RoundAnswer)
                .where(RoundAnswer.entry_id == entry_id)
                .order_by(RoundAnswer.idx)
            )
        )
        .scalars()
        .all()
    )
    rounds = [
        {"idx": a.idx, "result": {"choice": a.server_answer["correctIndex"], "elapsed_ms": 10000}}
        for a in answers
    ]

    r = await client.post(
        f"/entries/{entry_id}/submit",
        headers=_auth(token),
        json={"rounds": rounds, "client_score": 999999},  # client_score must be ignored
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # 7 correct, full time used → streak multipliers 1.12..1.60 (capped) → exactly 1000.
    assert body["total_score"] == 1000
    assert body["total_score"] != 999999


async def test_tampered_score_does_not_beat_server(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    window = await _open_window(db_session)
    token = await _register(client, "p1@example.com", "player1")
    entry = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token))).json()
    entry_id = entry["entry_id"]

    # Answer everything WRONG but claim a huge client score; server must score it 0.
    answers = (
        (
            await db_session.execute(
                select(RoundAnswer)
                .where(RoundAnswer.entry_id == entry_id)
                .order_by(RoundAnswer.idx)
            )
        )
        .scalars()
        .all()
    )
    rounds = [
        {
            "idx": a.idx,
            "result": {"choice": (a.server_answer["correctIndex"] + 1) % 4, "elapsed_ms": 100},
        }
        for a in answers
    ]
    r = await client.post(
        f"/entries/{entry_id}/submit",
        headers=_auth(token),
        json={"rounds": rounds, "client_score": 999999},
    )
    assert r.status_code == 200, r.text
    assert r.json()["total_score"] == 0


async def test_mixed_template_renders_and_scores_all_module_types(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    window = await _open_window(db_session, template_id="m4_night")
    token = await _register(client, "p1@example.com", "player1")

    enter = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token))).json()
    types = {rnd["type"] for rnd in enter["rounds"]}
    # mixed round set from the template — trivia + rapid_math + memory_flash
    assert types == {"trivia", "rapid_math", "memory_flash"}

    answers = (
        (
            await db_session.execute(
                select(RoundAnswer)
                .where(RoundAnswer.entry_id == enter["entry_id"])
                .order_by(RoundAnswer.idx)
            )
        )
        .scalars()
        .all()
    )

    rounds = []
    for a in answers:
        if a.module_type == "memory_flash":
            seq = a.server_answer["sequence"]
            result = {"taps": seq, "tap_times": [100 * i for i in range(len(seq))], "elapsed_ms": 0}
        else:
            result = {"choice": a.server_answer["correctIndex"], "elapsed_ms": 0}
        rounds.append({"idx": a.idx, "result": result})

    res = await client.post(
        f"/entries/{enter['entry_id']}/submit", headers=_auth(token), json={"rounds": rounds}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert all(r["correct"] for r in body["rounds"])  # answered everything correctly
    assert body["total_score"] > 0
    assert {r["module_type"] for r in body["rounds"]} == {
        "trivia",
        "rapid_math",
        "memory_flash",
    }


async def test_submit_rejected_after_close(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    window = await _open_window(db_session)
    token = await _register(client, "p1@example.com", "player1")
    entry = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token))).json()

    window.state = CLOSED
    window.close_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.flush()

    r = await client.post(
        f"/entries/{entry['entry_id']}/submit",
        headers=_auth(token),
        json={"rounds": []},
    )
    assert r.status_code == 409


async def test_enter_no_double_entry_under_concurrent_enter(monkeypatch: pytest.MonkeyPatch):
    """TOCTOU race at READ COMMITTED (as in prod): a second concurrent enter for the same
    (window, user) slips past the pre-check, so the INSERT collides on uq_entry_window_user. The
    loser must map to a clean AlreadyEnteredError (→409), not a raw IntegrityError (→500).

    Reproduced deterministically via lock-blocking (same shape as the window-creation test):
    connection B holds an UNCOMMITTED entry for (W, U); the caller A blocks on that lock, then B
    commits, so A unblocks straight into the conflict. A no-trivia template avoids loading the bank.
    """
    user_id = uuid.UUID("00000000-0000-0000-0000-0000000000e1")
    window_id = uuid.UUID("00000000-0000-0000-0000-0000000000e2")
    monkeypatch.setitem(
        templates.TEMPLATES,
        "test_no_trivia",
        ContestTemplate(
            "test_no_trivia", (RoundSlot("rapid_math", 1), RoundSlot("memory_flash", 1))
        ),
    )

    now = datetime.now(UTC)
    a_engine = create_async_engine(settings.test_database_url)
    helper_engine = create_async_engine(settings.test_database_url)
    a_conn = a_trans = a_session = b_conn = None
    try:
        # Self-heal prior runs + commit the prerequisites so both connections can see them.
        async with helper_engine.begin() as s:
            await s.execute(delete(Entry).where(Entry.window_id == window_id))
            await s.execute(delete(ContestWindow).where(ContestWindow.id == window_id))
            await s.execute(delete(User).where(User.id == user_id))
            await s.execute(
                insert(User).values(id=user_id, email="enter-race@x.com", password_hash="x")
            )
            await s.execute(
                insert(ContestWindow).values(
                    id=window_id,
                    contest_date=now.date(),
                    slot="morning",
                    open_at=now - timedelta(hours=1),
                    close_at=now + timedelta(hours=1),
                    state=OPEN,
                    template_id="test_no_trivia",
                )
            )

        # B: hold an uncommitted entry for (W, U) → locks uq_entry_window_user.
        b_conn = await helper_engine.connect()
        b_trans = await b_conn.begin()
        await b_conn.execute(
            insert(Entry).values(
                id=uuid.uuid4(),
                window_id=window_id,
                user_id=user_id,
                seed=1,
                round_set=[],
                started_at=now,
                status=IN_PROGRESS,
            )
        )

        # A: a normal READ COMMITTED caller entering the same window; its INSERT blocks on B.
        a_conn = await a_engine.connect()
        a_trans = await a_conn.begin()
        a_session = AsyncSession(bind=a_conn, expire_on_commit=False)
        task = asyncio.create_task(enter_contest(a_session, window_id, user_id, now=now))
        await asyncio.sleep(0.3)  # let A reach + block on the entry INSERT
        await b_trans.commit()  # B wins the slot; A unblocks into the conflict
        with pytest.raises(AlreadyEnteredError):  # clean 409, not an IntegrityError (500)
            await task
    finally:
        if a_session is not None:
            await a_session.close()
        if a_trans is not None:
            await a_trans.rollback()
        if a_conn is not None:
            await a_conn.close()
        if b_conn is not None:
            await b_conn.close()
        async with helper_engine.begin() as s:
            await s.execute(delete(ContestWindow).where(ContestWindow.id == window_id))  # cascades
            await s.execute(delete(User).where(User.id == user_id))
        await a_engine.dispose()
        await helper_engine.dispose()
