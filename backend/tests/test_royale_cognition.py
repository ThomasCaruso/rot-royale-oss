"""Daily Royale with cognition round types: mixed round sequence pinned on the window, interactive
rounds backed by cognition instances bound to (entry_id, round_idx), all scored onto the trivia
points scale through the one canonical formula. The Royale stays the single daily object.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.models import (
    CognitionEstimateItem,
    CognitionRoundInstance,
    ContestWindow,
    Entry,
    RoundAnswer,
    RoundResult,
)
from app.models.contest import OPEN
from content.change_manifest import ingest_change_manifest
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


async def _seed_all_content(session: AsyncSession) -> None:
    await load_trivia(session)
    session.add(
        CognitionEstimateItem(
            prompt="How many candy bars tall is it?",
            answer=Decimal("100"),  # decade bounds [10, 1000]; a guess of 100 is correct
            unit="bars",
            components=[],
            reveal_explanation="e",
            difficulty="direct",
            acceptable_pct=Decimal("20"),
            source_id="fer_royale",
        )
    )
    await session.flush()
    await ingest_change_manifest(
        session,
        {
            "version": 2,
            "items": [
                {
                    "key": "r1",
                    "base_asset": "r1_base.png",
                    "altered_asset": "r1_altered.png",
                    "width": 1024,
                    "height": 768,
                    "bbox": {"x": 0.40, "y": 0.30, "w": 0.10, "h": 0.10},
                }
            ],
        },
    )


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


async def test_royale_round_set_is_mixed_and_pins_types(
    client: AsyncClient, db_session: AsyncSession
):
    await _seed_all_content(db_session)
    window = await _royale_window(db_session)

    token = await _register(client, "rc1@example.com", "rcuser1")
    body = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token))).json()
    rounds = body["rounds"]
    assert len(rounds) == 8
    types = [r["type"] for r in rounds]
    assert types[0] == "change_detection"  # fast visual/reaction opener
    assert types[7] == "estimate"  # highest-difficulty available finale
    assert set(types) <= {"trivia", "estimate", "change_detection", "memory_flash"}

    for r in rounds:
        spec = r["client_spec"]
        if r["type"] == "estimate":
            assert "cognition_instance_id" in spec
            assert "slider_min" in spec and "answer" not in spec  # magnitude-only bounds, no answer
        elif r["type"] == "change_detection":
            assert "cognition_instance_id" in spec
            assert "bbox" not in spec  # the box never leaves the server
        else:  # trivia
            assert "correctIndex" not in spec

    # The plan is pinned on the window — a second player gets the IDENTICAL type sequence.
    token2 = await _register(client, "rc2@example.com", "rcuser2")
    body2 = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token2))).json()
    assert [r["type"] for r in body2["rounds"]] == types

    # The interactive instances are bound to (entry_id, round_idx).
    entry = (
        (
            await db_session.execute(
                select(Entry).where(Entry.window_id == window.id).order_by(Entry.started_at)
            )
        )
        .scalars()
        .first()
    )
    bound = (
        (
            await db_session.execute(
                select(CognitionRoundInstance).where(CognitionRoundInstance.entry_id == entry.id)
            )
        )
        .scalars()
        .all()
    )
    assert bound, "interactive rounds must create bound instances"
    assert all(b.round_idx is not None for b in bound)


async def _play_royale(
    client: AsyncClient, token: str, db_session: AsyncSession, window_id
) -> dict:
    """Play every round of a mixed Royale correctly, in order; returns the last answer response."""
    body = (await client.post(f"/contests/{window_id}/enter", headers=_auth(token))).json()
    entry_id = body["entry_id"]
    entry = await db_session.get(Entry, entry_id)
    last = {}
    for rnd in body["rounds"]:
        idx = rnd["idx"]
        rtype = rnd["type"]
        spec = rnd["client_spec"]
        if rtype == "trivia":
            answer = await db_session.get(RoundAnswer, (entry.id, idx))
            result = {"choice": answer.server_answer["correctIndex"], "elapsed_ms": 500}
        elif rtype == "change_detection":
            iid = spec["cognition_instance_id"]
            r = await client.post(
                f"/cognition/change/{iid}/submit",
                headers=_auth(token),
                json={"x": 0.45, "y": 0.35, "elapsed_ms": 0},
            )
            assert r.json()["hit"] is True, r.text
            result = {}
        elif rtype == "memory_flash":
            # ATOMIC and generated, so it answers through /entries/{id}/answer like trivia. The
            # sequence is legitimately in client_spec (it is the stimulus the player watches); the
            # anti-cheat property is that the submitted TAPS are validated against the stored one.
            # Tap times must clear MIN_PLAUSIBLE_INPUT_MS or the module flags the run as a spoof.
            taps = list(spec["sequence"])
            result = {
                "taps": taps,
                "tap_times": [300 * (i + 1) for i in range(len(taps))],
                "elapsed_ms": 300 * len(taps),
            }
        else:  # estimate
            iid = spec["cognition_instance_id"]
            r = await client.post(
                f"/cognition/estimate/{iid}/guess", headers=_auth(token), json={"value": 100}
            )
            assert r.json()["correct"] is True, r.text
            result = {}
        ans = await client.post(
            f"/entries/{entry_id}/answer", headers=_auth(token), json={"idx": idx, "result": result}
        )
        assert ans.status_code == 200, ans.text
        last = ans.json()
    return {"entry_id": entry_id, "last": last}


async def test_mixed_royale_scores_every_type_on_the_trivia_scale(
    client: AsyncClient, db_session: AsyncSession
):
    await _seed_all_content(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rc3@example.com", "rcuser3")

    out = await _play_royale(client, token, db_session, window.id)
    assert out["last"]["finished"] is True

    entry = await db_session.get(Entry, out["entry_id"])
    assert entry.status == "SUBMITTED"
    assert entry.scoring_version == 3  # a Royale containing cognition rounds

    results = (
        (
            await db_session.execute(
                select(RoundResult)
                .where(RoundResult.entry_id == entry.id)
                .order_by(RoundResult.idx)
            )
        )
        .scalars()
        .all()
    )
    assert len(results) == 8
    # Every round — trivia, change, estimate — scored correct on the SAME scale, no second economy:
    # compute_points(correct, time_frac∈[0,1], streak∈[1,5]) ranges 112..256 for a correct round.
    for r in results:
        assert r.correct is True
        assert 112 <= r.points <= 256
    assert entry.total_score == sum(r.points for r in results)
    assert entry.total_score > 800  # 8 correct rounds with streak multiplier


async def test_interactive_round_cannot_finalize_before_resolved(
    client: AsyncClient, db_session: AsyncSession
):
    await _seed_all_content(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rc4@example.com", "rcuser4")
    body = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token))).json()
    entry_id = body["entry_id"]
    # Round 0 is change_detection; finalize it via /answer WITHOUT playing the instance first.
    assert body["rounds"][0]["type"] == "change_detection"
    r = await client.post(
        f"/entries/{entry_id}/answer", headers=_auth(token), json={"idx": 0, "result": {}}
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "round_not_resolved"


async def test_batch_submit_rejected_for_mixed_royale(
    client: AsyncClient, db_session: AsyncSession
):
    await _seed_all_content(db_session)
    window = await _royale_window(db_session)
    token = await _register(client, "rc5@example.com", "rcuser5")
    body = (await client.post(f"/contests/{window.id}/enter", headers=_auth(token))).json()
    entry_id = body["entry_id"]
    r = await client.post(f"/entries/{entry_id}/submit", headers=_auth(token), json={"rounds": []})
    assert r.status_code == 409  # must play round-by-round through /answer
