"""Task 3.5 — Duel API routers + wallet bot-cap + /me/duel-stats.

These drive the duel services over the API. `client` + `db_session` share ONE rolled-back
transaction, so we register over the API, then grant gems / read stored answers directly on the
db_session. The human is forced correct by reading RoundAnswer.server_answer["correctIndex"]; the
rival is scripted by overwriting match.rival_run on the db_session before each round.
"""

from __future__ import annotations

import uuid

from app.models import DuelMatch, RoundAnswer, User
from app.services.gem_ledger import record_gem_delta
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


async def _user_id(session: AsyncSession, email: str) -> uuid.UUID:
    user = (await session.execute(select(User).where(User.email == email))).scalar_one()
    return user.id


async def _correct_index(session: AsyncSession, match: DuelMatch, idx: int) -> int:
    answer = await session.get(RoundAnswer, (match.entry_id, idx))
    assert answer is not None
    return int(answer.server_answer["correctIndex"])


async def _match(session: AsyncSession, match_id: str) -> DuelMatch:
    match = await session.get(DuelMatch, uuid.UUID(match_id))
    assert match is not None
    return match


async def _script_rival(session: AsyncSession, match: DuelMatch, run: list[dict]) -> None:
    match.rival_run = [dict(r) for r in run]  # reassign, not mutate (JSONB tracking)
    await session.flush()


# ---------------- config ----------------
async def test_config_lists_tiers_and_cap(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "d_cfg@example.com", "dcfg")

    r = await client.get("/duel/config", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["bot_gem_cap"] == 3
    assert body["bot_gem_used"] == 0
    assert "gems_balance" in body
    tiers = {t["type"]: t for t in body["tiers"]}
    assert tiers["training"]["unlocked"] is True
    assert tiers["spark"]["unlocked"] is True
    assert tiers["crown"]["unlocked"] is False
    assert tiers["royal"]["unlocked"] is False


# ---------------- create ----------------
async def test_create_training_returns_answer_free_rounds(
    client: AsyncClient, db_session: AsyncSession
):
    await load_trivia(db_session)
    token = await _register(client, "d_tr@example.com", "dtr")

    r = await client.post("/duel/create", json={"duel_type": "training"}, headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert "match_id" in body
    assert len(body["rounds"]) == 10
    for rnd in body["rounds"]:
        assert "correctIndex" not in rnd["client_spec"]  # answers never reach the client
    assert body["rival_tier"] in {"rookie", "solid", "sharp", "elite"}
    assert body["duel_type"] == "training"


async def test_create_locked_tier(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "d_lock@example.com", "dlock")
    r = await client.post("/duel/create", json={"duel_type": "crown"}, headers=_auth(token))
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == "duel_locked"


async def test_create_unknown_type(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "d_unk@example.com", "dunk")
    r = await client.post("/duel/create", json={"duel_type": "mega"}, headers=_auth(token))
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == "unknown_duel_type"


async def test_create_insufficient_gems(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "d_poor@example.com", "dpoor")
    r = await client.post("/duel/create", json={"duel_type": "spark"}, headers=_auth(token))
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "insufficient_gems"


# ---------------- full match ----------------
async def test_full_training_match_over_api(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "d_full@example.com", "dfull")

    created = (
        await client.post("/duel/create", json={"duel_type": "training"}, headers=_auth(token))
    ).json()
    match = await _match(db_session, created["match_id"])
    # rival never correct → user sweeps 4-0.
    await _script_rival(db_session, match, [{"correct": False, "time_frac": 0.5}] * 10)

    rev = None
    for idx in range(4):
        ci = await _correct_index(db_session, match, idx)
        r = await client.post(
            f"/duel/{created['match_id']}/round",
            json={"idx": idx, "result": {"choice": ci, "elapsed_ms": 1000}},
            headers=_auth(token),
        )
        assert r.status_code == 200, r.text
        rev = r.json()
    assert rev is not None and rev["finished"] is True
    assert rev["result"] is not None
    assert rev["result"]["winner"] == "user"
    assert rev["result"]["result_reason"] == "first_to_4"
    assert rev["user_round_wins"] == 4
    assert "correctIndex" in rev["answer"]

    # an extra round → 409 duel_not_in_progress.
    ci = await _correct_index(db_session, match, 4)
    extra = await client.post(
        f"/duel/{created['match_id']}/round",
        json={"idx": 4, "result": {"choice": ci, "elapsed_ms": 1000}},
        headers=_auth(token),
    )
    assert extra.status_code == 409, extra.text
    assert extra.json()["detail"] == "duel_not_in_progress"


async def test_match_state(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "d_state@example.com", "dstate")
    created = (
        await client.post("/duel/create", json={"duel_type": "training"}, headers=_auth(token))
    ).json()
    match = await _match(db_session, created["match_id"])
    await _script_rival(db_session, match, [{"correct": False, "time_frac": 0.5}] * 10)

    ci = await _correct_index(db_session, match, 0)
    await client.post(
        f"/duel/{created['match_id']}/round",
        json={"idx": 0, "result": {"choice": ci, "elapsed_ms": 1000}},
        headers=_auth(token),
    )

    r = await client.get(f"/duel/{created['match_id']}", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "in_progress"
    assert body["rounds_played"] == 1
    assert body["user_round_wins"] == 1
    assert body["duel_type"] == "training"


async def test_match_state_not_found(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "d_nf@example.com", "dnf")
    r = await client.post(
        f"/duel/{uuid.uuid4()}/round",
        json={"idx": 0, "result": {"choice": 0, "elapsed_ms": 1000}},
        headers=_auth(token),
    )
    assert r.status_code == 404, r.text
    assert r.json()["detail"] == "duel_not_found"


# ---------------- stats + wallet ----------------
async def test_duel_stats_reflects_completed_match(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "d_stats@example.com", "dstats")

    # fresh user → zeros.
    fresh = (await client.get("/me/duel-stats", headers=_auth(token))).json()
    assert fresh["training_wins"] == 0 and fresh["duel_tier"] == "bronze"

    created = (
        await client.post("/duel/create", json={"duel_type": "training"}, headers=_auth(token))
    ).json()
    match = await _match(db_session, created["match_id"])
    await _script_rival(db_session, match, [{"correct": False, "time_frac": 0.5}] * 10)
    for idx in range(4):
        ci = await _correct_index(db_session, match, idx)
        await client.post(
            f"/duel/{created['match_id']}/round",
            json={"idx": idx, "result": {"choice": ci, "elapsed_ms": 1000}},
            headers=_auth(token),
        )

    r = await client.get("/me/duel-stats", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["training_wins"] == 1
    assert body["perfect_wins"] == 1  # 4-0 sweep, all correct
    assert body["duel_xp"] > 0


async def test_wallet_includes_duel_cap(client: AsyncClient, db_session: AsyncSession):
    await load_trivia(db_session)
    token = await _register(client, "d_wal@example.com", "dwal")
    r = await client.get("/me/wallet", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert "coins_balance" in body and "gems_balance" in body
    assert body["duel"]["bot_gem_duels_used"] == 0
    assert body["duel"]["bot_gem_duels_cap"] == 3


async def test_create_spark_with_gems(client: AsyncClient, db_session: AsyncSession):
    """A user granted gems can enter spark; the wallet then reflects one used bot Gem duel."""
    await load_trivia(db_session)
    token = await _register(client, "d_spark@example.com", "dspark")
    uid = await _user_id(db_session, "d_spark@example.com")
    await record_gem_delta(db_session, uid, 5, "test")
    await db_session.flush()

    r = await client.post("/duel/create", json={"duel_type": "spark"}, headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["entry_gems"] == 1

    wallet = (await client.get("/me/wallet", headers=_auth(token))).json()
    assert wallet["gems_balance"] == 4  # 5 - 1 entry
    assert wallet["duel"]["bot_gem_duels_used"] == 1
