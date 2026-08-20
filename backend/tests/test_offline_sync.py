"""Offline play — the exactly-once key.

`entries.offline_client_id` carries a client-generated id for an offline-synced entry. A
partial-unique index (`uq_entries_offline_client_id`, WHERE offline_client_id IS NOT NULL) makes
replaying the same offline result idempotent: a second entry with the same non-null key is rejected
at the DB, so a later sync endpoint can look the entry up instead of double-crediting.
"""

from __future__ import annotations

import datetime
import uuid

import pytest
from app.models import Profile
from app.models.contest import Entry
from app.services.offline_sync import score_offline_items
from content.ingest import ingest_bank, read_bank_rows
from content.loader import load_trivia
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register", json={"email": email, "username": username, "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _ingest_banks(session: AsyncSession) -> None:
    rows = read_bank_rows(
        str(__import__("app.core.config", fromlist=["settings"]).settings.content_root / "bank")
    )
    report = await ingest_bank(session, rows)
    assert not report.rejected, report.rejected


async def _register_user_id(client: AsyncClient, db_session: AsyncSession):
    """Register a real user (so entries.user_id satisfies its FK) and return its id."""
    r = await client.post(
        "/auth/register",
        json={
            "email": "offline@example.com",
            "username": "offlineuser",
            "password": "super-secret-pw",
        },
    )
    assert r.status_code == 200, r.text
    return await db_session.scalar(select(Profile.user_id).limit(1))


@pytest.mark.asyncio
async def test_offline_client_id_is_unique(client: AsyncClient, db_session: AsyncSession):
    # Register a real user first so the two entries fail on the unique index, not the user_id FK.
    uid = await _register_user_id(client, db_session)
    now = datetime.datetime.now(datetime.UTC)
    e1 = Entry(
        user_id=uid,
        seed=1,
        round_set=[],
        started_at=now,
        status="submitted",
        offline_client_id="dup",
    )
    db_session.add(e1)
    await db_session.flush()
    e2 = Entry(
        user_id=uid,
        seed=2,
        round_set=[],
        started_at=now,
        status="submitted",
        offline_client_id="dup",
    )
    db_session.add(e2)
    with pytest.raises(IntegrityError):
        await db_session.flush()


def test_score_offline_items_reuses_scoring():
    bank_by_id = {
        "q1": {"payload": {"correctIndex": 2}, "difficulty": "easy"},
        "q2": {"payload": {"correctIndex": 0}, "difficulty": "hard"},
    }
    items = [
        {"question_id": "q1", "selected_source_index": 2, "elapsed_ms": 1000},  # correct
        {"question_id": "q2", "selected_source_index": 3, "elapsed_ms": 2000},  # wrong
    ]
    scored, correct, total = score_offline_items(items, bank_by_id)
    assert total == 2 and correct == 1
    assert scored[0].correct is True and scored[0].points > 0
    assert scored[1].correct is False and scored[1].points == 0


@pytest.mark.asyncio
async def test_campaign_offline_complete_scores_and_is_idempotent(
    client: AsyncClient, db_session: AsyncSession
):
    await _ingest_banks(db_session)
    token = await _register(client, "offlinecamp@example.com", "offlinecamp")

    # Pull the offline bundle and find Science L1 (a real unlocked level in the ingested banks).
    r = await client.get("/campaign/offline-bundle", headers=_auth(token))
    assert r.status_code == 200, r.text
    bundle = r.json()
    lvl = next(b for b in bundle["levels"] if b["world"] == "Science" and b["level"] == 1)
    rounds = lvl["rounds"]
    n = len(rounds)
    assert n > 0

    # Build all-correct items: the correct ORIGINAL option index is the source index of the
    # correct shuffled slot.
    items = [
        {
            "question_id": rd["question_id"],
            "selected_source_index": rd["option_source_index"][rd["correct_index"]],
            "elapsed_ms": 1000,
        }
        for rd in rounds
    ]

    client_id = str(uuid.uuid4())
    body = {"world": "Science", "level": 1, "client_id": client_id, "items": items}

    r1 = await client.post("/campaign/offline-complete", json=body, headers=_auth(token))
    assert r1.status_code == 200, r1.text
    j1 = r1.json()
    assert j1["passed"] is True
    assert j1["correct"] == n
    assert j1["total"] == n
    coins_first = j1["coins_awarded"]

    # Re-sync with the SAME client_id → identical coins, and exactly ONE entry carries the key.
    r2 = await client.post("/campaign/offline-complete", json=body, headers=_auth(token))
    assert r2.status_code == 200, r2.text
    j2 = r2.json()
    assert j2["coins_awarded"] == coins_first
    assert j2["correct"] == n

    entry_count = await db_session.scalar(
        select(func.count()).select_from(Entry).where(Entry.offline_client_id == client_id)
    )
    assert entry_count == 1


@pytest.mark.asyncio
async def test_campaign_offline_complete_rejects_mismatched_items(
    client: AsyncClient, db_session: AsyncSession
):
    await _ingest_banks(db_session)
    token = await _register(client, "offlinemismatch@example.com", "offlinemismatch")

    r = await client.get("/campaign/offline-bundle", headers=_auth(token))
    assert r.status_code == 200, r.text
    bundle = r.json()
    lvl = next(b for b in bundle["levels"] if b["world"] == "Science" and b["level"] == 1)
    rounds = lvl["rounds"]
    assert len(rounds) > 0

    items = [
        {
            "question_id": rd["question_id"],
            "selected_source_index": rd["option_source_index"][rd["correct_index"]],
            "elapsed_ms": 1000,
        }
        for rd in rounds
    ]
    # Tamper: replace one question_id with a bogus one → authored-set validation must reject.
    items[0]["question_id"] = "not-a-real-id"

    body = {"world": "Science", "level": 1, "client_id": str(uuid.uuid4()), "items": items}
    resp = await client.post("/campaign/offline-complete", json=body, headers=_auth(token))
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_offline_sync_respects_daily_coin_cap(client: AsyncClient, db_session: AsyncSession):
    """Draining many offline campaign clears in one batch cannot exceed the ET-day coin cap.

    Each all-correct clear unlocks the next level (FIFO), so we clear Science levels in order,
    re-fetching the bundle each time to pick up the newly-unlocked level's authored rounds. With a
    first-clear perfect paying 80 (25+15+40) and the cap at 300, the 4th clear must trip the cap.
    This also implicitly proves the FIFO unlock chain: a level that never appears after clearing the
    prior one would break the loop and fail the `capped is True` assertion.
    """
    from app.core.constants import CAMPAIGN_DAILY_COIN_CAP

    await _ingest_banks(db_session)
    token = await _register(client, "cap@example.com", "capuser")

    total = 0
    capped = False
    level = 1
    while True:
        bundle = (await client.get("/campaign/offline-bundle", headers=_auth(token))).json()
        lvl = next(
            (b for b in bundle["levels"] if b["world"] == "Science" and b["level"] == level),
            None,
        )
        if lvl is None:
            break
        items = [
            {
                "question_id": rd["question_id"],
                "selected_source_index": rd["option_source_index"][rd["correct_index"]],
                "elapsed_ms": 1000,
            }
            for rd in lvl["rounds"]
        ]
        body = {
            "world": "Science",
            "level": level,
            "client_id": str(uuid.uuid4()),
            "items": items,
        }
        res = (
            await client.post("/campaign/offline-complete", json=body, headers=_auth(token))
        ).json()
        assert res["passed"] is True, res  # all-correct → every level clears (unlocks the next)
        total += res["coins_awarded"]
        if capped:
            # Once the cap is hit, any further clear must award zero.
            assert res["coins_awarded"] == 0, res
        capped = capped or res["daily_cap_reached"]
        level += 1
        if level > 40:  # safety bound (never reached: cap trips at level 4)
            break

    # The batch of clears never exceeds the cap, and the cap was actually reached.
    assert total <= CAMPAIGN_DAILY_COIN_CAP
    assert capped is True


@pytest.mark.asyncio
async def test_practice_offline_submit_scores_and_is_idempotent(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    token = await _register(client, "offlineprac@example.com", "offlineprac")

    pool = (await client.get("/practice/offline-pool", headers=_auth(token))).json()
    rounds = pool["questions"][:5]
    assert len(rounds) == 5

    # All-correct: the correct ORIGINAL option index is the source index of the correct slot.
    items = [
        {
            "question_id": rd["question_id"],
            "selected_source_index": rd["option_source_index"][rd["correct_index"]],
            "elapsed_ms": 1200,
        }
        for rd in rounds
    ]

    client_id = str(uuid.uuid4())
    body = {"mode": "practice", "category": None, "client_id": client_id, "items": items}

    r1 = await client.post("/practice/offline-submit", json=body, headers=_auth(token))
    assert r1.status_code == 200, r1.text
    j1 = r1.json()
    assert j1["correct"] == 5
    assert j1["total"] == 5
    sharpness_first = j1["sharpness"]
    assert j1["sharpness_gained"] > 0  # a first no-stakes clear nudges sharpness

    # Re-sync SAME client_id → same numbers, NO further sharpness (idempotent), exactly one entry.
    r2 = await client.post("/practice/offline-submit", json=body, headers=_auth(token))
    assert r2.status_code == 200, r2.text
    j2 = r2.json()
    assert j2["correct"] == 5
    assert j2["sharpness"] == sharpness_first  # no double sharpness
    assert j2["sharpness_gained"] == 0

    entry_count = await db_session.scalar(
        select(func.count()).select_from(Entry).where(Entry.offline_client_id == client_id)
    )
    assert entry_count == 1


@pytest.mark.asyncio
async def test_practice_offline_submit_rejects_unknown_question(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    token = await _register(client, "offlinebad@example.com", "offlinebad")
    pool = (await client.get("/practice/offline-pool", headers=_auth(token))).json()
    rd = pool["questions"][0]
    # A question_id the servable bank does not contain must be rejected, not silently mis-scored.
    body = {
        "mode": "practice",
        "category": None,
        "client_id": str(uuid.uuid4()),
        "items": [
            {
                "question_id": "not-a-real-question-id",
                "selected_source_index": rd["option_source_index"][rd["correct_index"]],
                "elapsed_ms": 1200,
            }
        ],
    }
    resp = await client.post("/practice/offline-submit", json=body, headers=_auth(token))
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_campaign_offline_complete_rejects_locked_level(
    client: AsyncClient, db_session: AsyncSession
):
    await _ingest_banks(db_session)
    # Fresh user: Science level 2 not unlocked (level 1 not cleared) → must be rejected 409.
    token = await _register(client, "offlinelocked@example.com", "offlinelocked")

    r = await client.get("/campaign/offline-bundle", headers=_auth(token))
    assert r.status_code == 200, r.text
    bundle = r.json()

    lvl2 = next((b for b in bundle["levels"] if b["world"] == "Science" and b["level"] == 2), None)
    if lvl2 is not None:
        rounds = lvl2["rounds"]
        items = [
            {
                "question_id": rd["question_id"],
                "selected_source_index": rd["option_source_index"][rd["correct_index"]],
                "elapsed_ms": 1000,
            }
            for rd in rounds
        ]
    else:
        # Level 2 is locked and beyond the bundle lookahead — target it directly.
        items = []

    body = {"world": "Science", "level": 2, "client_id": str(uuid.uuid4()), "items": items}
    resp = await client.post("/campaign/offline-complete", json=body, headers=_auth(token))
    assert resp.status_code == 409, resp.text
