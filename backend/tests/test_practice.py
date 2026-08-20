"""Practice Mode (M8): server-scored, no stakes.

Practice reuses the contest round-module + scoring path but writes NO coins, NO rating, and never
appears in windows/standings/history. Completion updates the personal `sharpness` stat (capped 100).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from app.models import CoinLedger, ContestWindow, Entry, Profile, RoundAnswer
from app.models.contest import OPEN
from content.loader import load_trivia
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register", json={"email": email, "username": username, "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _correct_result(module_type: str, server_answer: dict) -> dict:
    """Build a correct per-round submission from the stored server answer (test has DB access)."""
    if module_type == "memory_flash":
        seq = server_answer["sequence"]
        return {"taps": seq, "tap_times": [100 * i for i in range(len(seq))], "elapsed_ms": 0}
    # trivia / rapid_math all submit a single {choice}
    return {"choice": server_answer["correctIndex"], "elapsed_ms": 0}


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


async def test_practice_starts_with_mixed_specs_and_no_answers(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    token = await _register(client, "pr1@example.com", "prac1")

    r = await client.post("/practice/start", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["rounds"]) == 5
    types = {rnd["type"] for rnd in body["rounds"]}
    assert types == {"trivia", "rapid_math", "memory_flash"}
    for rnd in body["rounds"]:
        assert "correctIndex" not in rnd["client_spec"]  # answers never reach the client


async def test_quick_play_is_eight_mixed_trivia(client: AsyncClient, db_session: AsyncSession):
    """Quick Play (mode="quick"): 8 trivia rounds drawn from the full mixed bank — the Daily
    Royale's shape with no stakes. Still a practice entry (window-less, no coins, no rating)."""
    await load_trivia(db_session)
    token = await _register(client, "qp1@example.com", "quick1")

    r = await client.post("/practice/start", headers=_auth(token), json={"mode": "quick"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["rounds"]) == 8
    assert all(rnd["type"] == "trivia" for rnd in body["rounds"])
    for rnd in body["rounds"]:
        assert "correctIndex" not in rnd["client_spec"]  # answers never reach the client

    # The entry is a plain practice entry — window-less and flagged, so it can never rank.
    entry = await db_session.get(Entry, body["entry_id"])
    assert entry is not None
    assert entry.is_practice is True
    assert entry.window_id is None


async def test_quick_play_ignores_category_and_stays_mixed(
    client: AsyncClient, db_session: AsyncSession
):
    """Quick Play is always the full mixed bank: a category sent alongside mode="quick" is ignored
    (never scoped, never a 400 for a thin category)."""
    await load_trivia(db_session)
    token = await _register(client, "qp2@example.com", "quick2")

    r = await client.post(
        "/practice/start", headers=_auth(token), json={"mode": "quick", "category": "Nonexistent"}
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["rounds"]) == 8


async def test_practice_scores_server_side_full_accuracy(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    token = await _register(client, "pr2@example.com", "prac2")
    start = (await client.post("/practice/start", headers=_auth(token))).json()

    rounds = [
        {"idx": a.idx, "result": _correct_result(a.module_type, a.server_answer)}
        for a in await _answers(db_session, start["entry_id"])
    ]
    r = await client.post(
        f"/practice/{start['entry_id']}/submit", headers=_auth(token), json={"rounds": rounds}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["correct"] == 5
    assert body["total"] == 5
    assert body["accuracy"] == pytest.approx(1.0)
    assert all(rr["correct"] for rr in body["rounds"])


async def test_practice_grants_no_coins_and_no_rating(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    token = await _register(client, "pr3@example.com", "prac3")
    me = (await client.get("/me", headers=_auth(token))).json()
    user_id = me["user_id"]

    ledger_before = (
        await db_session.execute(
            select(func.count()).select_from(CoinLedger).where(CoinLedger.user_id == user_id)
        )
    ).scalar_one()
    rating_before = me["rating"]

    start = (await client.post("/practice/start", headers=_auth(token))).json()
    rounds = [
        {"idx": a.idx, "result": _correct_result(a.module_type, a.server_answer)}
        for a in await _answers(db_session, start["entry_id"])
    ]
    await client.post(
        f"/practice/{start['entry_id']}/submit", headers=_auth(token), json={"rounds": rounds}
    )

    ledger_after = (
        await db_session.execute(
            select(func.count()).select_from(CoinLedger).where(CoinLedger.user_id == user_id)
        )
    ).scalar_one()
    profile = await db_session.get(Profile, user_id)
    assert ledger_after == ledger_before  # no coin rows written
    assert profile is not None
    assert profile.rating == rating_before  # rating untouched
    assert profile.coins_balance == me["coins_balance"]  # balance cache untouched


async def test_practice_updates_sharpness(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "pr4@example.com", "prac4")
    start = (await client.post("/practice/start", headers=_auth(token))).json()
    rounds = [
        {"idx": a.idx, "result": _correct_result(a.module_type, a.server_answer)}
        for a in await _answers(db_session, start["entry_id"])
    ]
    body = (
        await client.post(
            f"/practice/{start['entry_id']}/submit", headers=_auth(token), json={"rounds": rounds}
        )
    ).json()
    # perfect 5/5 session → +5 sharpness from a fresh (0) profile.
    assert body["sharpness_gained"] == 5
    assert body["sharpness"] == 5


async def test_practice_sharpness_caps_at_100(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "pr5@example.com", "prac5")
    me = (await client.get("/me", headers=_auth(token))).json()
    profile = await db_session.get(Profile, me["user_id"])
    assert profile is not None
    profile.sharpness = 98  # near the cap
    await db_session.flush()

    start = (await client.post("/practice/start", headers=_auth(token))).json()
    rounds = [
        {"idx": a.idx, "result": _correct_result(a.module_type, a.server_answer)}
        for a in await _answers(db_session, start["entry_id"])
    ]
    body = (
        await client.post(
            f"/practice/{start['entry_id']}/submit", headers=_auth(token), json={"rounds": rounds}
        )
    ).json()
    # a perfect session would add 5, but it clamps at 100 → only +2 applied.
    assert body["sharpness"] == 100
    assert body["sharpness_gained"] == 2


async def test_practice_spoof_is_rejected_by_same_validation(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    token = await _register(client, "pr6@example.com", "prac6")
    start = (await client.post("/practice/start", headers=_auth(token))).json()

    rounds = []
    for a in await _answers(db_session, start["entry_id"]):
        if a.module_type == "trivia":
            # spoof: submit a deliberately wrong index → rejected, not counted (server knows truth).
            result = {"choice": a.server_answer["correctIndex"] + 1, "elapsed_ms": 1}
        else:
            result = _correct_result(a.module_type, a.server_answer)
        rounds.append({"idx": a.idx, "result": result})

    body = (
        await client.post(
            f"/practice/{start['entry_id']}/submit", headers=_auth(token), json={"rounds": rounds}
        )
    ).json()
    spoofed = [rr for rr in body["rounds"] if rr["module_type"] == "trivia"]
    assert spoofed  # the practice mix includes trivia rounds
    assert all(rr["correct"] is False for rr in spoofed)  # wrong index rejected by server scoring
    assert body["correct"] == 3  # the 2 rapid_math + 1 memory_flash rounds counted
    assert body["accuracy"] == pytest.approx(0.6)


async def test_contest_submit_rejects_a_practice_entry(
    client: AsyncClient, db_session: AsyncSession
):
    # The two paths are disjoint: a practice entry must not be submittable via the contest endpoint
    # (guards the is_practice check that replaced relying on get(ContestWindow, None)).
    await load_trivia(db_session)
    token = await _register(client, "pr8@example.com", "prac8")
    start = (await client.post("/practice/start", headers=_auth(token))).json()
    r = await client.post(
        f"/entries/{start['entry_id']}/submit", headers=_auth(token), json={"rounds": []}
    )
    assert r.status_code == 404, r.text


async def test_practice_submit_rejects_a_contest_entry(
    client: AsyncClient, db_session: AsyncSession
):
    # ...and a real contest entry must not be submittable via the practice endpoint.
    await load_trivia(db_session)
    token = await _register(client, "pr9@example.com", "prac9")
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=now.date(),
        slot="night",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=OPEN,
        template_id="m2_trivia_7",
    )
    db_session.add(window)
    await db_session.flush()
    enter = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token))).json()
    r = await client.post(
        f"/practice/{enter['entry_id']}/submit", headers=_auth(token), json={"rounds": []}
    )
    assert r.status_code == 404, r.text


async def test_practice_does_not_touch_windows_or_history(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    token = await _register(client, "pr7@example.com", "prac7")

    # An open window exists alongside the practice session.
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=now.date(),
        slot="midday",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=OPEN,
        template_id="m2_trivia_7",
    )
    db_session.add(window)
    await db_session.flush()

    start = (await client.post("/practice/start", headers=_auth(token))).json()
    rounds = [
        {"idx": a.idx, "result": _correct_result(a.module_type, a.server_answer)}
        for a in await _answers(db_session, start["entry_id"])
    ]
    await client.post(
        f"/practice/{start['entry_id']}/submit", headers=_auth(token), json={"rounds": rounds}
    )

    # The practice entry is flagged and window-less.
    entry = await db_session.get(Entry, start["entry_id"])
    assert entry is not None
    assert entry.is_practice is True
    assert entry.window_id is None

    # It does NOT inflate the window's real field count, and never shows in history.
    current = (await client.get("/contests/current", headers=_auth(token))).json()
    counts = {w["id"]: w["entry_count"] for w in current["schedule"]}
    assert counts.get(str(window.id), 0) == 0
    history = (await client.get("/me/history", headers=_auth(token))).json()
    assert history["items"] == []
