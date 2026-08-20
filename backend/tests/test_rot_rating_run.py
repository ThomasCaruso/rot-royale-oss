"""Rot Rating updates at RUN COMPLETION (CLAUDE.md §5e) — end-to-end through the API.

A trivia-only Daily Royale is eight `know` games, so it exercises the whole path
without cognition content: enter -> answer 8 rounds -> the finish updates the three
sub-ratings + derived headline. Guests are excluded (a rating needs a saved profile).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.core import constants as C
from app.models import ContestWindow, Entry, RoundAnswer
from app.models.contest import OPEN
from app.models.rot_rating import RotRating, RotSubRating
from content.loader import load_trivia
from httpx import AsyncClient
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


async def _play(
    client: AsyncClient, token: str, session: AsyncSession, window_id, *, correct: bool
) -> Entry:
    body = (await client.post(f"/contests/{window_id}/enter", headers=_auth(token))).json()
    entry_id = body["entry_id"]
    entry = await session.get(Entry, entry_id)
    assert entry is not None
    for rnd in body["rounds"]:
        assert rnd["type"] == "trivia", "test assumes a trivia-only royale (no cognition content)"
        idx = rnd["idx"]
        answer = await session.get(RoundAnswer, (entry.id, idx))
        assert answer is not None
        ci = int(answer.server_answer["correctIndex"])
        choice = ci if correct else (ci + 1) % 4
        ans = await client.post(
            f"/entries/{entry_id}/answer",
            headers=_auth(token),
            json={"idx": idx, "result": {"choice": choice, "elapsed_ms": 500}},
        )
        assert ans.status_code == 200, ans.text
        if ans.json()["retry_available"]:
            # §5f: a wrong first pick opens a retry; finalize as a MISS with a second wrong pick so
            # the round still resolves incorrect (this helper's `correct=False` means all misses).
            ans = await client.post(
                f"/entries/{entry_id}/answer",
                headers=_auth(token),
                json={"idx": idx, "result": {"choice": (ci + 2) % 4, "elapsed_ms": 0}},
            )
            assert ans.status_code == 200, ans.text
    return entry


async def test_run_completion_creates_headline_and_subs(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rr1@example.com", "rruser1")
    entry = await _play(client, token, db_session, window.id, correct=True)

    headline = await db_session.get(RotRating, entry.user_id)
    assert headline is not None
    assert headline.rounds_played == 8
    assert headline.provisional is True  # 8 < ROT_PROVISIONAL_ROUNDS
    assert headline.direction == "up"  # an all-correct run raises the number
    assert headline.rating > C.ROT_SEED_RATING
    assert headline.version == C.ROT_RATING_VERSION

    know = await db_session.get(RotSubRating, (entry.user_id, "know"))
    assert know is not None and know.rounds == 8
    assert know.rating > C.ROT_SEED_RATING
    # the headline is derived from the only played verb, so it equals that sub-rating
    assert abs(headline.rating - know.rating) < 1e-6
    # untouched verbs are written at the seed with zero rounds
    estimate = await db_session.get(RotSubRating, (entry.user_id, "estimate"))
    assert estimate is not None and estimate.rounds == 0
    assert abs(estimate.rating - C.ROT_SEED_RATING) < 1e-6
    assert headline.rd <= C.ROT_RD_FLOOR + 1e-6  # RD floored, never below


async def test_all_wrong_run_lowers_and_points_down(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rr2@example.com", "rruser2")
    entry = await _play(client, token, db_session, window.id, correct=False)

    headline = await db_session.get(RotRating, entry.user_id)
    assert headline is not None
    assert headline.direction == "down"
    assert headline.rating < C.ROT_SEED_RATING


async def test_exposure_seed_then_after_run(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rr3@example.com", "rruser3")

    # Before any run: a provisional seed so the client always has a value.
    seed = (await client.get("/me/rot-rating", headers=_auth(token))).json()
    assert seed["rating"] == round(C.ROT_SEED_RATING)
    assert seed["provisional"] is True
    assert seed["rounds_played"] == 0
    assert seed["last_change"] == "flat"
    assert set(seed["sub_ratings"]) == set(C.ROT_VERBS)
    assert all(s["provisional"] for s in seed["sub_ratings"].values())

    await _play(client, token, db_session, window.id, correct=True)

    after = (await client.get("/me/rot-rating", headers=_auth(token))).json()
    assert after["rounds_played"] == 8
    assert after["last_change"] == "up"
    assert after["rating"] > round(C.ROT_SEED_RATING)
    assert after["sub_ratings"]["know"]["rounds_played"] == 8
    assert after["sub_ratings"]["know"]["provisional"] is False  # 8 >= 5
    assert after["sub_ratings"]["estimate"]["rounds_played"] == 0


async def test_guest_gets_no_rot_rating(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    window = await _royale_window(db_session)
    r = await client.post("/auth/guest")
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    entry = await _play(client, token, db_session, window.id, correct=True)

    assert await db_session.get(RotRating, entry.user_id) is None
    assert await db_session.get(RotSubRating, (entry.user_id, "know")) is None
