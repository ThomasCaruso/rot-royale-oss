"""Daily Royale trivia second-chance (CLAUDE.md §5f).

A WRONG first pick on a ranked Daily Royale trivia round does NOT end the round: the answer stays
hidden, the picked option is reported as `eliminated`, and the player gets a fixed retry window to
pick once more for HALF points (which still counts as correct for the streak + Rot Rating). A second
wrong pick, re-sending the greyed option, or a lapsed window ends the round at 0.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.core.constants import TRIVIA_RETRY_MS
from app.models import ContestWindow, Entry, RoundAnswer, RoundResult
from app.models.contest import OPEN
from app.services.contest import answer_round
from app.services.scoring import compute_points
from content.loader import load_trivia
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register",
        json={"email": email, "username": username, "password": "super-secret-pw"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _royale_window(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    w = ContestWindow(
        contest_date=now.date(),
        slot="royale",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=OPEN,
        template_id="dr_8_trivia",
    )
    session.add(w)
    await session.flush()
    return w


async def _enter(client: AsyncClient, token: str, window_id) -> dict:
    return (await client.post(f"/contests/{window_id}/enter", headers=_auth(token))).json()


async def _correct_index(session: AsyncSession, entry_id, idx: int) -> int:
    ans = await session.get(RoundAnswer, (entry_id, idx))
    assert ans is not None
    return int(ans.server_answer["correctIndex"])


def test_compute_points_half() -> None:
    full = compute_points(True, 0.5, 3)
    assert compute_points(True, 0.5, 3, half=True) == round(full / 2)
    assert compute_points(False, 0.5, 3, half=True) == 0  # a miss is still 0


async def test_wrong_first_pick_offers_retry_without_revealing(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rt1@example.com", "rtuser1")
    body = await _enter(client, token, window.id)
    entry_id = body["entry_id"]
    ci = await _correct_index(db_session, entry_id, 0)
    wrong = (ci + 1) % 4

    r = await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={"idx": 0, "supports_retry": True, "result": {"choice": wrong, "elapsed_ms": 500}},
    )
    out = r.json()
    assert out["retry_available"] is True
    assert out["eliminated"] == wrong
    assert out["retry_ms"] == TRIVIA_RETRY_MS
    assert out["finished"] is False
    assert out["correct"] is False
    assert out["points"] == 0
    assert out["answer"] == {}  # the answer is NOT revealed on the offer
    # No RoundResult yet — the round is not finalized, so the next idx is still blocked.
    results = (
        (await db_session.execute(select(RoundResult).where(RoundResult.entry_id == entry_id)))
        .scalars()
        .all()
    )
    assert results == []
    # The pending retry state is stored on the round answer.
    ans = await db_session.get(RoundAnswer, (entry_id, 0))
    assert ans is not None and ans.retry is not None and ans.retry["choice"] == wrong


async def test_retry_correct_scores_half_and_counts_correct(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rt2@example.com", "rtuser2")
    body = await _enter(client, token, window.id)
    entry_id = body["entry_id"]
    ci = await _correct_index(db_session, entry_id, 0)

    # First pick wrong -> retry offered.
    await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={
            "idx": 0,
            "supports_retry": True,
            "result": {"choice": (ci + 1) % 4, "elapsed_ms": 500},
        },
    )
    # Second pick correct -> half points, correct True, round advances (RoundResult idx 0 created).
    r2 = await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={"idx": 0, "supports_retry": True, "result": {"choice": ci, "elapsed_ms": 200}},
    )
    out = r2.json()
    assert out["correct"] is True
    assert out["retry_available"] is False
    assert out["answer"]  # the answer IS revealed now (round finalized)
    # Points are HALF of a full correct at this streak/time — bounded well under a normal 112..256.
    assert 0 < out["points"] <= 128
    result = (
        await db_session.execute(
            select(RoundResult).where(RoundResult.entry_id == entry_id, RoundResult.idx == 0)
        )
    ).scalar_one()
    assert result.correct is True
    assert "retry" in result.flags
    # The pending retry state was cleared.
    ans = await db_session.get(RoundAnswer, (entry_id, 0))
    assert ans is not None and ans.retry is None
    # The round advanced: idx 1 is now answerable.
    ci1 = await _correct_index(db_session, entry_id, 1)
    r3 = await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={"idx": 1, "supports_retry": True, "result": {"choice": ci1, "elapsed_ms": 200}},
    )
    assert r3.status_code == 200


async def test_retry_correct_continues_the_streak(client: AsyncClient, db_session: AsyncSession):
    # A retry-correct counts as correct, so a following first-try correct is streak 2, not 1.
    # Asserted against the round's OWN stored time_frac (timing-independent) so it isn't flaky.
    await load_trivia(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rt3@example.com", "rtuser3")
    body = await _enter(client, token, window.id)
    entry_id = body["entry_id"]

    ci0 = await _correct_index(db_session, entry_id, 0)
    await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={
            "idx": 0,
            "supports_retry": True,
            "result": {"choice": (ci0 + 1) % 4, "elapsed_ms": 300},
        },
    )
    await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={"idx": 0, "supports_retry": True, "result": {"choice": ci0, "elapsed_ms": 100}},
    )
    ci1 = await _correct_index(db_session, entry_id, 1)
    r = await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={"idx": 1, "supports_retry": True, "result": {"choice": ci1, "elapsed_ms": 0}},
    )
    idx1 = (
        await db_session.execute(
            select(RoundResult).where(RoundResult.entry_id == entry_id, RoundResult.idx == 1)
        )
    ).scalar_one()
    tf = float(idx1.time_frac)
    # Points match streak 2 (retry kept it alive), NOT streak 1 (would be the case if it reset).
    assert r.json()["points"] == compute_points(True, tf, 2)
    assert r.json()["points"] != compute_points(True, tf, 1)


async def test_second_wrong_pick_ends_round_at_zero(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rt4@example.com", "rtuser4")
    body = await _enter(client, token, window.id)
    entry_id = body["entry_id"]
    ci = await _correct_index(db_session, entry_id, 0)
    wrong_a = (ci + 1) % 4
    wrong_b = (ci + 2) % 4

    await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={"idx": 0, "supports_retry": True, "result": {"choice": wrong_a, "elapsed_ms": 300}},
    )
    r2 = await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={"idx": 0, "supports_retry": True, "result": {"choice": wrong_b, "elapsed_ms": 100}},
    )
    out = r2.json()
    assert out["correct"] is False
    assert out["points"] == 0
    assert out["retry_available"] is False  # no third chance


async def test_repicking_the_eliminated_option_is_wrong(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rt5@example.com", "rtuser5")
    body = await _enter(client, token, window.id)
    entry_id = body["entry_id"]
    ci = await _correct_index(db_session, entry_id, 0)
    wrong = (ci + 1) % 4

    await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={"idx": 0, "supports_retry": True, "result": {"choice": wrong, "elapsed_ms": 300}},
    )
    # Re-send the greyed option (a scripted client) -> treated as wrong, 0.
    r2 = await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={"idx": 0, "supports_retry": True, "result": {"choice": wrong, "elapsed_ms": 100}},
    )
    assert r2.json()["correct"] is False
    assert r2.json()["points"] == 0


async def test_lapsed_retry_window_scores_zero(client: AsyncClient, db_session: AsyncSession):
    # Drive the service directly to inject a `now` past the retry deadline.
    await load_trivia(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rt6@example.com", "rtuser6")
    body = await _enter(client, token, window.id)
    entry_id = body["entry_id"]
    entry = await db_session.get(Entry, entry_id)
    ci = await _correct_index(db_session, entry_id, 0)
    t0 = datetime.now(UTC)

    await answer_round(
        db_session,
        entry.id,
        entry.user_id,
        0,
        {"choice": (ci + 1) % 4, "elapsed_ms": 300},
        now=t0,
        supports_retry=True,
    )
    # Correct pick, but AFTER the retry window lapsed -> zero.
    late = t0 + timedelta(milliseconds=TRIVIA_RETRY_MS + 500)
    out = await answer_round(
        db_session, entry.id, entry.user_id, 0, {"choice": ci, "elapsed_ms": 100}, now=late
    )
    assert out.correct is False
    assert out.points == 0
    assert "retry_lapsed" in out.flags


async def test_timeout_no_pick_does_not_offer_retry(client: AsyncClient, db_session: AsyncSession):
    # A round that TIMES OUT sends no choice (null). There is no option to grey, so it must NOT
    # offer a retry — it finalizes as a normal miss and the run advances (no server/client desync).
    await load_trivia(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rt8@example.com", "rtuser8")
    body = await _enter(client, token, window.id)
    entry_id = body["entry_id"]

    r = await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={"idx": 0, "supports_retry": True, "result": {"choice": None, "elapsed_ms": 10000}},
    )
    out = r.json()
    assert out["retry_available"] is False
    assert out["correct"] is False
    assert out["points"] == 0
    assert out["answer"]  # revealed — the round is finalized like any miss
    # idx 1 is now answerable (the round advanced, no pending retry left dangling).
    ci1 = await _correct_index(db_session, entry_id, 1)
    r2 = await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={"idx": 1, "supports_retry": True, "result": {"choice": ci1, "elapsed_ms": 200}},
    )
    assert r2.status_code == 200


async def test_correct_first_pick_is_full_points_no_retry(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rt7@example.com", "rtuser7")
    body = await _enter(client, token, window.id)
    entry_id = body["entry_id"]
    ci = await _correct_index(db_session, entry_id, 0)

    r = await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={"idx": 0, "supports_retry": True, "result": {"choice": ci, "elapsed_ms": 0}},
    )
    out = r.json()
    assert out["correct"] is True
    assert out["retry_available"] is False
    assert out["points"] >= 112  # full-points range, not halved
    assert out["answer"]  # revealed on a normal finalize


async def test_legacy_client_never_gets_a_retry_offer(
    client: AsyncClient, db_session: AsyncSession
):
    """A client that does not declare `supports_retry` gets the pre-§5f contract, unchanged.

    This is not a nicety. The second chance withholds the RoundResult so the sequence guard can
    still block the next idx — which is correct for a client that knows to re-answer the SAME idx,
    and fatal for one that does not. The shipped App Store binary predates §5f: it read the offer as
    an ordinary reveal, advanced, and then wedged against the guard on the following round. It
    cannot be updated, so the SERVER defaults to the old behaviour and the new client opts in.
    """
    await load_trivia(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rt8@example.com", "rtuser8")
    body = await _enter(client, token, window.id)
    entry_id = body["entry_id"]
    ci = await _correct_index(db_session, entry_id, 0)

    r = await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={"idx": 0, "result": {"choice": (ci + 1) % 4, "elapsed_ms": 500}},
    )
    out = r.json()
    assert out["retry_available"] is False
    assert out["eliminated"] is None
    assert out["correct"] is False
    assert out["points"] == 0
    assert out["answer"]  # the round is FINALIZED, so the answer is revealed as it always was
    # The round is recorded, so the legacy client's next idx is accepted rather than 409-wedged.
    ans = await db_session.get(RoundAnswer, (entry_id, 0))
    assert ans is not None and ans.retry is None
    ci1 = await _correct_index(db_session, entry_id, 1)
    r2 = await client.post(
        f"/entries/{entry_id}/answer",
        headers=_auth(token),
        json={"idx": 1, "result": {"choice": ci1, "elapsed_ms": 200}},
    )
    assert r2.status_code == 200, r2.text
