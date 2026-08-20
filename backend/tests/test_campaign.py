"""Campaign Mode: unlock logic, clear thresholds, coin rewards (first-clear stacking vs flat
replay), the daily cap, idempotent completion, and the invariant that coins never touch rating.

A campaign play reuses the practice answer loop, so these tests start a level via /campaign/start,
answer each round through /practice/{entry}/answer (the test reads the stored server answers to
force a target correct-count), then settle via /campaign/{entry}/complete.
"""

from __future__ import annotations

import uuid

import pytest
from app.core.constants import CAMPAIGN_DAILY_COIN_CAP
from app.models import (
    CampaignSession,
    CoinLedger,
    GemLedger,
    Profile,
    RoundAnswer,
    UserCampaignProgress,
)
from content.campaign import manifest as cm
from content.campaign.keys import question_key
from content.ingest import ingest_bank, read_bank_rows
from content.loader import fetch_bank
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# Campaign topology is declared by the active content package (campaign/config.json), so these
# assertions read it rather than hard-coding the production numbers. The same tests therefore
# validate the synthetic sample campaign and the private production one.
def _spec():
    from app.core.config import settings
    from content.campaign.spec import load as _load

    return _load(settings.content_root)


QPL = _spec().questions_per_level
LPW = _spec().levels_per_world

# Answer counts that produce each performance tier, derived from the spec's own thresholds. A
# "clear" must stay BELOW the strong threshold, otherwise the tier under test is not the tier
# produced — which is exactly how these tests started failing at a different level width.
N_CLEAR = _spec().clear_threshold
N_STRONG = _spec().strong_threshold
N_PERFECT = _spec().perfect_threshold
assert N_CLEAR < N_STRONG <= N_PERFECT, "spec cannot express a non-strong clear"


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register", json={"email": email, "username": username, "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _ingest_banks(session: AsyncSession) -> None:
    """Load the real content/bank/*.json as servable questions into the test transaction, so
    campaign levels resolve their authored question keys."""
    from app.core.config import settings

    rows = read_bank_rows(str(settings.content_root / "bank"))
    report = await ingest_bank(session, rows)
    assert not report.rejected, report.rejected


async def _ordered_answers(session: AsyncSession, entry_id: str) -> list[RoundAnswer]:
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


async def _balance(session: AsyncSession, token_email_user_id) -> int:
    p = await session.get(Profile, token_email_user_id)
    return p.coins_balance


async def _play(
    client: AsyncClient,
    session: AsyncSession,
    token: str,
    world: str,
    level: int,
    n_correct: int,
) -> dict:
    """Start a campaign level, answer it with exactly `n_correct` correct rounds, and complete it.
    Returns the /complete JSON. The first `n_correct` rounds are answered correctly."""
    r = await client.post(
        "/campaign/start", json={"world": world, "level": level}, headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    entry_id = r.json()["entry_id"]
    assert len(r.json()["rounds"]) == QPL
    answers = await _ordered_answers(session, entry_id)
    assert len(answers) == QPL
    for i, ans in enumerate(answers):
        ci = ans.server_answer["correctIndex"]
        choice = ci if i < n_correct else (ci + 1) % 4
        rr = await client.post(
            f"/practice/{entry_id}/answer",
            json={"idx": i, "result": {"choice": choice, "elapsed_ms": 0}},
            headers=_auth(token),
        )
        assert rr.status_code == 200, rr.text
    done = await client.post(f"/campaign/{entry_id}/complete", headers=_auth(token))
    assert done.status_code == 200, done.text
    return done.json()


async def _user_id(session: AsyncSession) -> uuid.UUID:
    """The single registered user's id (each gem test registers exactly one user)."""
    return await session.scalar(select(Profile.user_id).limit(1))


async def _gem_rows(session: AsyncSession, reason: str) -> list[int]:
    """All gem-ledger deltas with this reason (one per test user)."""
    return list(
        (await session.execute(select(GemLedger.delta).where(GemLedger.reason == reason)))
        .scalars()
        .all()
    )


async def _seed_cleared(
    session: AsyncSession,
    user_id: uuid.UUID,
    world: str,
    levels: range | list[int],
    *,
    status: str = "clear",
) -> None:
    """Directly insert cleared UserCampaignProgress rows (bulk seeding for world-completion tests).
    Avoids dozens of full plays; the triggering level is still played for real."""
    for n in levels:
        session.add(
            UserCampaignProgress(
                user_id=user_id,
                world=world,
                level_number=n,
                best_correct=N_PERFECT if status == "perfect" else N_CLEAR,
                clear_status=status,
                first_clear_claimed=True,
                times_cleared=1,
            )
        )
    await session.flush()


@pytest.mark.asyncio
async def test_level5_chest_grants_one_gem_once(client: AsyncClient, db_session: AsyncSession):
    await _ingest_banks(db_session)
    token = await _register(client, "g5@example.com", "ggem5")

    # Clear L1-4 to unlock L5, then clear L5.
    for lvl in range(1, 5):
        await _play(client, db_session, token, "Science", lvl, n_correct=N_CLEAR)
    b5 = await _play(client, db_session, token, "Science", 5, n_correct=N_CLEAR)
    assert b5["passed"] is True
    assert b5["gems_awarded"] == 1
    assert await _gem_rows(db_session, "campaign_level5_chest") == [1]

    # Replay L5 → no new chest gem (still exactly one row, 0 new gems this completion).
    replay = await _play(client, db_session, token, "Science", 5, n_correct=N_PERFECT)
    assert replay["gems_awarded"] == 0
    assert await _gem_rows(db_session, "campaign_level5_chest") == [1]


@pytest.mark.asyncio
async def test_boss_clear_grants_two_gems_once(client: AsyncClient, db_session: AsyncSession):
    await _ingest_banks(db_session)
    token = await _register(client, "gb@example.com", "ggemboss")
    for lvl in range(1, LPW):
        await _play(client, db_session, token, "Science", lvl, n_correct=N_CLEAR)
    boss = await _play(
        client, db_session, token, "Science", 10, n_correct=N_CLEAR
    )  # non-perfect boss
    assert boss["is_boss"] is True and boss["passed"] is True
    # +2 boss only (non-perfect). L5 chest was earned on the L5 completion, not here.
    assert boss["gems_awarded"] == 2
    assert await _gem_rows(db_session, "campaign_boss_clear") == [2]
    assert await _gem_rows(db_session, "campaign_perfect_boss") == []


@pytest.mark.asyncio
async def test_perfect_boss_grants_boss_plus_perfect(client: AsyncClient, db_session: AsyncSession):
    await _ingest_banks(db_session)
    token = await _register(client, "gpb@example.com", "ggemperfboss")
    for lvl in range(1, LPW):
        await _play(client, db_session, token, "Science", lvl, n_correct=N_CLEAR)
    boss = await _play(
        client, db_session, token, "Science", 10, n_correct=N_PERFECT
    )  # perfect boss
    # +2 boss AND +1 perfect_boss on this completion.
    assert boss["gems_awarded"] == 3
    assert await _gem_rows(db_session, "campaign_boss_clear") == [2]
    assert await _gem_rows(db_session, "campaign_perfect_boss") == [1]


@pytest.mark.asyncio
async def test_perfect_boss_fires_on_later_perfect_replay(
    client: AsyncClient, db_session: AsyncSession
):
    """First boss clear non-perfect (+2). A later perfect replay grants the +1 perfect_boss, and
    does NOT re-grant the boss."""
    await _ingest_banks(db_session)
    token = await _register(client, "gpr@example.com", "ggemperfreplay")
    for lvl in range(1, LPW):
        await _play(client, db_session, token, "Science", lvl, n_correct=N_CLEAR)
    boss = await _play(client, db_session, token, "Science", 10, n_correct=N_CLEAR)  # non-perfect
    assert boss["gems_awarded"] == 2

    replay = await _play(
        client, db_session, token, "Science", 10, n_correct=N_PERFECT
    )  # now perfect
    assert replay["gems_awarded"] == 1  # only the perfect_boss +1, boss not re-granted
    assert await _gem_rows(db_session, "campaign_boss_clear") == [2]
    assert await _gem_rows(db_session, "campaign_perfect_boss") == [1]


@pytest.mark.asyncio
async def test_perfect_world_grants_three_gems_once(client: AsyncClient, db_session: AsyncSession):
    """Seed 9 levels of a world as 'perfect', then play the 10th at 10/10 → +3 perfect_world."""
    await _ingest_banks(db_session)
    token = await _register(client, "gpw@example.com", "ggemperfworld")
    uid = await _user_id(db_session)
    # Seed L1-9 perfect (this also clears L9, so L10 unlocks).
    await _seed_cleared(db_session, uid, "Science", range(1, LPW), status="perfect")

    b10 = await _play(client, db_session, token, "Science", 10, n_correct=N_PERFECT)
    assert b10["passed"] is True
    # +2 boss, +1 perfect_boss, +3 perfect_world == 6 (L5 chest was seeded, not played here).
    assert await _gem_rows(db_session, "campaign_perfect_world") == [3]
    assert b10["gems_awarded"] == 2 + 1 + 3


@pytest.mark.asyncio
async def test_all_worlds_grants_ten_gems_once(client: AsyncClient, db_session: AsyncSession):
    """Seed 5 full worlds cleared + 9 levels of the 6th, then play the final level → +10."""
    await _ingest_banks(db_session)
    token = await _register(client, "gaw@example.com", "ggemallworlds")
    uid = await _user_id(db_session)
    worlds = [w.world for w in cm.worlds()]
    # Seed the first five worlds fully cleared.
    for w in worlds[:5]:
        await _seed_cleared(db_session, uid, w, range(1, 11))
    last = worlds[5]
    # Seed L1-9 of the sixth (unlocks L10), then play L10.
    await _seed_cleared(db_session, uid, last, range(1, LPW))

    b = await _play(client, db_session, token, last, 10, n_correct=N_CLEAR)  # non-perfect final
    assert b["passed"] is True
    assert await _gem_rows(db_session, "campaign_all_worlds") == [10]
    # +2 boss + +10 all_worlds on this completion (non-perfect → no perfect_boss/perfect_world).
    assert b["gems_awarded"] == 2 + 10


@pytest.mark.asyncio
async def test_milestone_gems_bypass_the_coin_cap(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """A near-zero coin cap clamps coins, but the milestone gem is still granted in full."""
    await _ingest_banks(db_session)
    monkeypatch.setattr("app.services.campaign.CAMPAIGN_DAILY_COIN_CAP", 1)
    token = await _register(client, "gcap@example.com", "ggemcap")
    uid = await _user_id(db_session)
    await _seed_cleared(db_session, uid, "Science", range(1, 5))  # unlock L5

    b5 = await _play(client, db_session, token, "Science", 5, n_correct=N_CLEAR)
    assert b5["daily_cap_reached"] is True
    assert b5["coins_awarded"] <= 1  # coins clamped by the tiny cap
    assert b5["gems_awarded"] == 1  # gems unaffected by the coin cap
    assert await _gem_rows(db_session, "campaign_level5_chest") == [1]


@pytest.mark.asyncio
async def test_milestone_completion_is_idempotent_for_gems(
    client: AsyncClient, db_session: AsyncSession
):
    """Re-calling complete on a milestone entry returns the same gems_awarded and adds no rows."""
    await _ingest_banks(db_session)
    token = await _register(client, "gidem@example.com", "ggemidem")
    uid = await _user_id(db_session)
    await _seed_cleared(db_session, uid, "Science", range(1, 5))  # unlock L5

    r = await client.post(
        "/campaign/start", json={"world": "Science", "level": 5}, headers=_auth(token)
    )
    entry_id = r.json()["entry_id"]
    answers = await _ordered_answers(db_session, entry_id)
    for i, ans in enumerate(answers):
        ci = ans.server_answer["correctIndex"]
        await client.post(
            f"/practice/{entry_id}/answer",
            json={"idx": i, "result": {"choice": ci, "elapsed_ms": 0}},
            headers=_auth(token),
        )
    first = await client.post(f"/campaign/{entry_id}/complete", headers=_auth(token))
    second = await client.post(f"/campaign/{entry_id}/complete", headers=_auth(token))
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["gems_awarded"] == 1
    assert second.json()["gems_awarded"] == 1  # same total reported, no re-grant
    assert await _gem_rows(db_session, "campaign_level5_chest") == [1]  # exactly one row


@pytest.mark.asyncio
async def test_level_two_locked_until_level_one_cleared(
    client: AsyncClient, db_session: AsyncSession
):
    await _ingest_banks(db_session)
    token = await _register(client, "c1@example.com", "camp1")

    # Level 1 starts fine; level 2 is locked.
    r1 = await client.post(
        "/campaign/start", json={"world": "Science", "level": 1}, headers=_auth(token)
    )
    assert r1.status_code == 200, r1.text
    r2 = await client.post(
        "/campaign/start", json={"world": "Science", "level": 2}, headers=_auth(token)
    )
    assert r2.status_code == 409  # locked

    # Clear level 1 → level 2 unlocks.
    body = await _play(client, db_session, token, "Science", 1, n_correct=N_CLEAR)
    assert body["passed"] is True
    assert body["clear_status"] == "clear"
    assert body["next_level_unlocked"] is True
    r2b = await client.post(
        "/campaign/start", json={"world": "Science", "level": 2}, headers=_auth(token)
    )
    assert r2b.status_code == 200, r2b.text


@pytest.mark.asyncio
async def test_clear_thresholds_and_first_clear_coin_stacking(
    client: AsyncClient, db_session: AsyncSession
):
    await _ingest_banks(db_session)

    # Clear (7/10) → +25, status clear.
    t_clear = await _register(client, "cc@example.com", "cclear")
    b = await _play(client, db_session, t_clear, "Science", 1, n_correct=N_CLEAR)
    assert (b["clear_status"], b["coins_awarded"], b["first_clear"]) == ("clear", 25, True)

    # Strong (8/10) → 25 + 15 = 40, status strong.
    t_strong = await _register(client, "cs@example.com", "cstrong")
    b = await _play(client, db_session, t_strong, "Science", 1, n_correct=N_STRONG)
    assert (b["clear_status"], b["coins_awarded"]) == ("strong", 40)

    # Perfect (10/10) → 25 + 15 + 40 = 80, status perfect.
    t_perfect = await _register(client, "cp@example.com", "cperfect")
    b = await _play(client, db_session, t_perfect, "Science", 1, n_correct=N_PERFECT)
    assert (b["clear_status"], b["coins_awarded"]) == ("perfect", 80)


@pytest.mark.asyncio
async def test_failing_run_earns_nothing_and_keeps_next_locked(
    client: AsyncClient, db_session: AsyncSession
):
    await _ingest_banks(db_session)
    token = await _register(client, "cf@example.com", "cfail")

    # One short of the spec's clear threshold — the smallest genuine failure at any level width.
    n_fail = N_CLEAR - 1
    b = await _play(client, db_session, token, "Science", 1, n_correct=n_fail)
    assert b["passed"] is False
    assert b["clear_status"] is None
    assert b["coins_awarded"] == 0
    assert b["next_level_unlocked"] is False
    # best_correct still recorded for the attempt
    assert b["best_correct"] == n_fail

    r2 = await client.post(
        "/campaign/start", json={"world": "Science", "level": 2}, headers=_auth(token)
    )
    assert r2.status_code == 409  # still locked


@pytest.mark.asyncio
async def test_replay_pays_flat_five_not_the_big_bonuses(
    client: AsyncClient, db_session: AsyncSession
):
    await _ingest_banks(db_session)
    token = await _register(client, "cr@example.com", "creplay")

    first = await _play(client, db_session, token, "Science", 1, n_correct=N_CLEAR)
    assert first["coins_awarded"] == 25

    # Replay the SAME level with a perfect score: only the flat replay reward, NOT 80 (anti-farm).
    replay = await _play(client, db_session, token, "Science", 1, n_correct=N_PERFECT)
    assert replay["first_clear"] is False
    assert replay["coins_awarded"] == 5
    assert replay["clear_status"] == "perfect"  # status reported for this run
    assert replay["best_correct"] == QPL


@pytest.mark.asyncio
async def test_daily_cap_clamps_campaign_coins(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    await _ingest_banks(db_session)
    # Bind a low cap on the service's local reference.
    monkeypatch.setattr("app.services.campaign.CAMPAIGN_DAILY_COIN_CAP", 30)
    token = await _register(client, "cap@example.com", "ccap")
    me_id = await db_session.scalar(select(Profile.user_id).limit(1))  # noqa: F841 (sanity)

    b1 = await _play(
        client, db_session, token, "Science", 1, n_correct=N_CLEAR
    )  # +25 (first clear)
    assert b1["coins_awarded"] == 25
    # Level 2 first clear would be +25, but only 5 of the daily 30 remain → clamped to 5.
    b2 = await _play(client, db_session, token, "Science", 2, n_correct=N_CLEAR)
    assert b2["coins_awarded"] == 5
    assert b2["daily_cap_reached"] is True

    # Ledger sum for campaign today == cap.
    total = await db_session.scalar(
        select(func.coalesce(func.sum(CoinLedger.delta), 0)).where(
            CoinLedger.reason.like("campaign_%")
        )
    )
    assert int(total) == 30


@pytest.mark.asyncio
async def test_complete_is_idempotent(client: AsyncClient, db_session: AsyncSession):
    await _ingest_banks(db_session)
    token = await _register(client, "ci@example.com", "cidem")

    # Start + finish a level, then call /complete twice directly.
    r = await client.post(
        "/campaign/start", json={"world": "Science", "level": 1}, headers=_auth(token)
    )
    entry_id = r.json()["entry_id"]
    answers = await _ordered_answers(db_session, entry_id)
    for i, ans in enumerate(answers):
        ci = ans.server_answer["correctIndex"]
        await client.post(
            f"/practice/{entry_id}/answer",
            json={"idx": i, "result": {"choice": ci, "elapsed_ms": 0}},
            headers=_auth(token),
        )
    first = await client.post(f"/campaign/{entry_id}/complete", headers=_auth(token))
    second = await client.post(f"/campaign/{entry_id}/complete", headers=_auth(token))
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["coins_awarded"] == 80
    assert second.json()["coins_awarded"] == 80  # reports the same total, doesn't pay again

    # Balance reflects ONE payout and equals the ledger sum (invariant).
    rows = (
        (
            await db_session.execute(
                select(CoinLedger.delta).where(CoinLedger.reason.like("campaign_%"))
            )
        )
        .scalars()
        .all()
    )
    assert sum(rows) == 80
    bal = await db_session.scalar(select(Profile.coins_balance).limit(1))
    ledger_sum = await db_session.scalar(select(func.coalesce(func.sum(CoinLedger.delta), 0)))
    assert bal == ledger_sum


@pytest.mark.asyncio
async def test_campaign_coins_never_change_rating_or_division(
    client: AsyncClient, db_session: AsyncSession
):
    await _ingest_banks(db_session)
    token = await _register(client, "cra@example.com", "crating")
    prof = await db_session.scalar(select(Profile).limit(1))
    rating_before, division_before = prof.rating, prof.division

    await _play(client, db_session, token, "Science", 1, n_correct=N_PERFECT)  # earns coins

    await db_session.refresh(prof)
    assert prof.coins_balance == 80  # coins did move
    assert prof.rating == rating_before  # ...but rating/division are untouched by campaign
    assert prof.division == division_before


@pytest.mark.asyncio
async def test_complete_is_idempotent_for_zero_coin_runs(
    client: AsyncClient, db_session: AsyncSession
):
    """A failed run pays no coins, so the per-entry settled marker (not a coin row) must guard
    idempotency: re-completing must not re-run the progress upsert or pay anything."""
    await _ingest_banks(db_session)
    token = await _register(client, "cz@example.com", "czero")

    r = await client.post(
        "/campaign/start", json={"world": "Science", "level": 1}, headers=_auth(token)
    )
    entry_id = r.json()["entry_id"]
    answers = await _ordered_answers(db_session, entry_id)
    for i, ans in enumerate(answers):  # every round WRONG → a failed run
        ci = ans.server_answer["correctIndex"]
        await client.post(
            f"/practice/{entry_id}/answer",
            json={"idx": i, "result": {"choice": (ci + 1) % 4, "elapsed_ms": 0}},
            headers=_auth(token),
        )
    first = await client.post(f"/campaign/{entry_id}/complete", headers=_auth(token))
    second = await client.post(f"/campaign/{entry_id}/complete", headers=_auth(token))
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["passed"] is False and first.json()["coins_awarded"] == 0
    assert second.json()["coins_awarded"] == 0

    # No campaign coins paid, the link is marked settled, and progress is upserted exactly once.
    total = await db_session.scalar(
        select(func.coalesce(func.sum(CoinLedger.delta), 0)).where(
            CoinLedger.reason.like("campaign_%")
        )
    )
    assert int(total) == 0
    link = await db_session.get(CampaignSession, uuid.UUID(entry_id))
    assert link.settled_at is not None
    prog = await db_session.scalar(select(UserCampaignProgress).limit(1))
    assert prog.times_cleared == 0 and prog.clear_status is None and prog.best_correct == 0


@pytest.mark.asyncio
async def test_complete_on_non_campaign_entry_is_404(client: AsyncClient, db_session: AsyncSession):
    await _ingest_banks(db_session)
    token = await _register(client, "cn@example.com", "cnoncamp")
    # A plain practice session has no campaign link.
    r = await client.post("/practice/start", headers=_auth(token))
    entry_id = r.json()["entry_id"]
    done = await client.post(f"/campaign/{entry_id}/complete", headers=_auth(token))
    assert done.status_code == 404


@pytest.mark.asyncio
async def test_ladder_reflects_unlock_and_clear(client: AsyncClient, db_session: AsyncSession):
    await _ingest_banks(db_session)
    token = await _register(client, "cl@example.com", "cladder")

    r = await client.get("/campaign", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert [w["world"] for w in body["worlds"]] == [
        "Science",
        "History",
        "Sports",
        "Geography",
        "Arts",
        "Pop Culture",
    ]
    assert body["daily_coins_cap"] == CAMPAIGN_DAILY_COIN_CAP
    science = next(w for w in body["worlds"] if w["world"] == "Science")
    levels = [lvl for arc in science["arcs"] for lvl in arc["levels"]]
    assert len(levels) == LPW
    assert levels[0]["unlocked"] is True and levels[1]["unlocked"] is False
    assert levels[9]["is_boss"] is True
    assert science["cleared_count"] == 0

    await _play(client, db_session, token, "Science", 1, n_correct=N_STRONG)
    r2 = await client.get("/campaign", headers=_auth(token))
    science2 = next(w for w in r2.json()["worlds"] if w["world"] == "Science")
    levels2 = [lvl for arc in science2["arcs"] for lvl in arc["levels"]]
    assert levels2[0]["cleared"] is True and levels2[0]["clear_status"] == "strong"
    assert levels2[1]["unlocked"] is True
    assert science2["cleared_count"] == 1


# --- Authored-content guards: campaign serves the manifest's exact questions, never random ---


async def _start_keys(
    client: AsyncClient, token: str, world: str, level: int, category: str
) -> list[str]:
    """Start a campaign level and return its served questions as stable keys, in serve order."""
    r = await client.post(
        "/campaign/start", json={"world": world, "level": level}, headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    return [question_key(category, rnd["client_spec"]["prompt"]) for rnd in r.json()["rounds"]]


@pytest.mark.asyncio
async def test_campaign_start_serves_questions_in_manifest_order(
    client: AsyncClient, db_session: AsyncSession
):
    await _ingest_banks(db_session)
    token = await _register(client, "cmo@example.com", "cmorder")
    level = cm.get_level("Science", 1)
    assert level is not None
    served = await _start_keys(client, token, "Science", 1, level.category)
    assert served == list(level.question_keys)  # exact authored set, in the manifest's order


@pytest.mark.asyncio
async def test_campaign_levels_are_authored_not_random(
    client: AsyncClient, db_session: AsyncSession
):
    """Two starts of the same level must serve the IDENTICAL questions in the same order — proof
    the level is loaded from the manifest, not generated by the random practice/contest engine."""
    await _ingest_banks(db_session)
    token = await _register(client, "cnr@example.com", "cnorandom")
    level = cm.get_level("Science", 1)
    assert level is not None
    first = await _start_keys(client, token, "Science", 1, level.category)
    second = await _start_keys(client, token, "Science", 1, level.category)
    assert first == second
    assert len(set(first)) == QPL
    assert first == list(level.question_keys)


@pytest.mark.asyncio
async def test_every_manifest_key_resolves_to_a_servable_question(db_session: AsyncSession):
    """No dangling references: every authored question key in every level resolves to an
    approved/live (servable) question in the ingested bank."""
    await _ingest_banks(db_session)
    for w in cm.worlds():
        bank = await fetch_bank(db_session, "trivia", category=w.category)
        servable = {question_key(w.category, q["payload"]["prompt"]) for q in bank}
        for arc in w.arcs:
            for level in arc.levels:
                missing = [k for k in level.question_keys if k not in servable]
                assert not missing, f"{w.world} L{level.level_number} unresolved keys: {missing}"
