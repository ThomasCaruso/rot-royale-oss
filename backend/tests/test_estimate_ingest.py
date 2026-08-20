"""Estimate content ingest: all-or-nothing validation, upsert by source id, `_flags` stored as
diagnostic metadata that never reaches a player, playtest verdict preserved across re-ingest.
"""

from __future__ import annotations

import json

import pytest
from app.models import CognitionEstimateItem
from content.estimate_ingest import (
    export_estimate_verdicts,
    ingest_estimate_items,
    set_estimate_verdict,
    validate_estimate_items,
)
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


def _item(id: str = "fer_0001", **over) -> dict:
    it = {
        "id": id,
        "prompt": "How many adults span a football field?",
        "answer": 183,
        "unit": "people",
        "difficulty": "direct",
        "acceptable_pct": 20,
        "close_pct": 40,
        "components": [{"label": "field", "value": 91.4, "unit": "m", "source_url": "https://s"}],
        "reveal_explanation": "91 / 0.5 = 183.",
        "intuition_note": "people guess low",
        "category": "human_scale",
        "playtest_verdict": None,
        "_flags": {"dimension": "length", "path_repeat_index": 1},
    }
    it.update(over)
    return it


async def _one(session: AsyncSession, source_id: str) -> CognitionEstimateItem:
    return (
        await session.execute(
            select(CognitionEstimateItem).where(CognitionEstimateItem.source_id == source_id)
        )
    ).scalar_one()


async def _count(session: AsyncSession) -> int:
    return (
        await session.execute(select(func.count()).select_from(CognitionEstimateItem))
    ).scalar_one()


# ---------------------------------------------------------------- validation


def test_validation_accepts_a_clean_item():
    assert validate_estimate_items([_item()]) == []


def test_validation_catches_each_rule():
    def _has(items, needle):
        return any(needle in reason for _idx, reason in validate_estimate_items(items))

    assert _has([_item(answer=-5)], "answer")
    assert _has([_item(answer=0)], "answer")
    assert _has([_item(answer="lots")], "answer")
    assert _has([_item(difficulty="easy")], "difficulty")
    assert _has([_item(acceptable_pct=0)], "acceptable_pct")
    assert _has([_item(close_pct=-1)], "close_pct")
    assert _has([_item(acceptable_pct=40, close_pct=30)], "greater")  # close must exceed acceptable
    assert _has([_item(acceptable_pct=20, close_pct=20)], "greater")  # equal is not "greater"
    assert _has([_item(components={})], "components")  # not an array
    assert _has([_item(_flags=[1, 2])], "_flags")  # not an object
    assert _has([_item("dup"), _item("dup")], "duplicate")
    missing = _item()
    del missing["reveal_explanation"]
    assert _has([missing], "reveal_explanation")
    assert validate_estimate_items({"not": "a list"}) == [(-1, "file must be a JSON array")]


# ---------------------------------------------------------------- upsert


@pytest.mark.asyncio
async def test_ingest_inserts_stores_flags_and_is_idempotent(db_session: AsyncSession):
    items = [_item("fer_0001"), _item("fer_0002", prompt="Another?")]
    report = await ingest_estimate_items(db_session, items)
    assert report.added == 2
    assert report.updated == 0
    assert not report.rejected

    row = await _one(db_session, "fer_0001")
    assert float(row.answer) == 183.0
    assert float(row.acceptable_pct) == 20.0
    assert float(row.close_pct) == 40.0
    assert row.flags == {"dimension": "length", "path_repeat_index": 1}
    assert row.playtest_verdict is None  # never ingested from the file
    assert row.active is True

    # Re-ingesting the identical items writes nothing.
    report2 = await ingest_estimate_items(db_session, items)
    assert report2.added == 0
    assert report2.skipped == 2
    assert report2.updated == 0


@pytest.mark.asyncio
async def test_reingest_of_exponent_scale_components_is_a_no_op(db_session: AsyncSession):
    """Postgres stores JSON numbers as `numeric`, so a component written `1.41e+18` reads back as
    `1410000000000000000`. Comparing raw JSON text marked those items changed on EVERY ingest —
    invisible until the astronomy items landed, and now load-bearing, because the deploy runs
    ingest on every start and would rewrite them forever."""
    astro = _item(
        "fer_0100",
        components=[
            {"label": "Sun's volume", "value": 1.41e18, "unit": "km^3"},
            {"label": "Earth's volume", "value": 1.08e12, "unit": "km^3"},
        ],
    )
    assert (await ingest_estimate_items(db_session, [astro])).added == 1
    db_session.expire_all()  # re-read from Postgres, so we compare the JSONB round-trip and not
    # the identity map's copy of what we just wrote (which would hide the bug entirely)

    report = await ingest_estimate_items(db_session, [astro])
    assert report.updated == 0
    assert report.skipped == 1


@pytest.mark.asyncio
async def test_ingest_updates_changed_item_in_place(db_session: AsyncSession):
    await ingest_estimate_items(db_session, [_item("fer_0001"), _item("fer_0002")])
    report = await ingest_estimate_items(
        db_session, [_item("fer_0001", prompt="CHANGED"), _item("fer_0002")]
    )
    assert report.updated == 1
    assert report.skipped == 1
    assert (await _one(db_session, "fer_0001")).prompt == "CHANGED"


@pytest.mark.asyncio
async def test_ingest_rejects_whole_file_and_writes_nothing(db_session: AsyncSession):
    """One bad item rejects the ENTIRE file — no partial writes."""
    items = [_item("fer_0001"), _item("fer_0002", answer=-1), _item("fer_0003")]
    report = await ingest_estimate_items(db_session, items)
    assert report.rejected  # non-empty, names the bad item
    assert report.added == 0
    assert await _count(db_session) == 0  # the two valid items were NOT written


@pytest.mark.asyncio
async def test_reingest_preserves_admin_playtest_verdict(db_session: AsyncSession):
    """Re-ingest refreshes content but must NOT wipe an admin-set verdict."""
    await ingest_estimate_items(db_session, [_item("fer_0001")])
    await set_estimate_verdict(db_session, "fer_0001", "repetitive", "4th ratio question")

    report = await ingest_estimate_items(db_session, [_item("fer_0001", prompt="CHANGED")])
    assert report.updated == 1
    row = await _one(db_session, "fer_0001")
    assert row.prompt == "CHANGED"  # content refreshed
    assert row.playtest_verdict == "repetitive"  # verdict preserved
    assert row.playtest_note == "4th ratio question"


# ---------------------------------------------------------------- retire-missing (deploy sync)


@pytest.mark.asyncio
async def test_retire_missing_is_off_by_default(db_session: AsyncSession):
    """A plain re-ingest of a SUBSET must never deactivate anything — `active` stays operational
    state unless the caller explicitly opts into file-as-the-active-set."""
    await ingest_estimate_items(db_session, [_item("fer_0001"), _item("fer_0002")])
    report = await ingest_estimate_items(db_session, [_item("fer_0001")])

    assert report.retired == 0
    assert (await _one(db_session, "fer_0002")).active is True


@pytest.mark.asyncio
async def test_retire_missing_deactivates_rows_absent_from_the_file(db_session: AsyncSession):
    """The deploy path: the file is the ACTIVE set, so a superseded row is retired (kept, not
    deleted, so an already-pinned window plan still resolves it)."""
    await ingest_estimate_items(db_session, [_item("fer_0001"), _item("fer_0002")])

    report = await ingest_estimate_items(db_session, [_item("fer_0001")], retire_missing=True)
    assert report.retired == 1
    assert (await _one(db_session, "fer_0001")).active is True
    assert (await _one(db_session, "fer_0002")).active is False
    assert await _count(db_session) == 2  # retired, NOT deleted

    # Idempotent: the second run has nothing left to retire.
    report2 = await ingest_estimate_items(db_session, [_item("fer_0001")], retire_missing=True)
    assert report2.retired == 0


@pytest.mark.asyncio
async def test_retire_missing_reactivates_a_returning_item(db_session: AsyncSession):
    """Symmetry is what makes the deploy wiring safe: reverting the content file must RESTORE the
    previous active set, not leave prod permanently missing the rows a bad edit dropped."""
    await ingest_estimate_items(db_session, [_item("fer_0001"), _item("fer_0002")])
    await ingest_estimate_items(db_session, [_item("fer_0001")], retire_missing=True)
    assert (await _one(db_session, "fer_0002")).active is False

    report = await ingest_estimate_items(
        db_session, [_item("fer_0001"), _item("fer_0002")], retire_missing=True
    )
    assert report.reactivated == 1
    assert (await _one(db_session, "fer_0002")).active is True


@pytest.mark.asyncio
async def test_retire_missing_writes_nothing_when_the_file_rejects(db_session: AsyncSession):
    """All-or-nothing covers the retire too — a malformed file must not empty the live bank."""
    await ingest_estimate_items(db_session, [_item("fer_0001"), _item("fer_0002")])

    report = await ingest_estimate_items(
        db_session, [_item("fer_0003", answer=-1)], retire_missing=True
    )
    assert report.rejected
    assert report.retired == 0
    assert (await _one(db_session, "fer_0001")).active is True
    assert (await _one(db_session, "fer_0002")).active is True


@pytest.mark.asyncio
async def test_retire_missing_leaves_rows_with_no_source_id_alone(db_session: AsyncSession):
    """Rows created outside the ingest pipeline (older seeds/tests) carry no source_id, so the file
    says nothing about them — they must not be swept up by the retire."""
    db_session.add(
        CognitionEstimateItem(
            prompt="hand-made",
            answer=10,
            components=[],
            reveal_explanation="x",
            difficulty="direct",
            acceptable_pct=20,
            active=True,
        )
    )
    await db_session.flush()

    report = await ingest_estimate_items(db_session, [_item("fer_0001")], retire_missing=True)
    assert report.retired == 0
    untracked = (
        await db_session.execute(
            select(CognitionEstimateItem).where(CognitionEstimateItem.source_id.is_(None))
        )
    ).scalar_one()
    assert untracked.active is True


# ---------------------------------------------------------------- no player-facing leak


@pytest.mark.asyncio
async def test_flags_and_verdict_never_reach_a_player(
    client: AsyncClient, db_session: AsyncSession
):
    """`_flags` and playtest verdict are diagnostic/admin-only — they must never appear in the
    estimate client_spec or the resolve reveal."""
    await ingest_estimate_items(db_session, [_item("fer_0001")])  # the only active item → drawn
    await set_estimate_verdict(db_session, "fer_0001", "broken", "leaky")

    token = await _register(client, "leak@example.com", "leakuser")
    start = (await client.post("/cognition/estimate/start", headers=_auth(token))).json()
    start_blob = json.dumps(start)
    assert "flags" not in start_blob
    assert "playtest" not in start_blob
    assert "source_id" not in start_blob
    assert "dimension" not in start_blob  # a flag VALUE

    instance_id = start["instance_id"]
    guess = await client.post(
        f"/cognition/estimate/{instance_id}/guess", headers=_auth(token), json={"value": 183}
    )
    assert guess.json()["correct"] is True
    resolve = (
        await client.post(f"/cognition/estimate/{instance_id}/resolve", headers=_auth(token))
    ).json()
    blob = json.dumps(resolve)
    assert "flags" not in blob
    assert "playtest" not in blob
    assert "source_id" not in blob
    assert "dimension" not in blob


# ---------------------------------------------------------------- export


@pytest.mark.asyncio
async def test_export_pairs_flags_and_verdicts(db_session: AsyncSession):
    await ingest_estimate_items(db_session, [_item("fer_0001"), _item("fer_0002")])
    await set_estimate_verdict(db_session, "fer_0001", "repetitive", "seen it")

    out = await export_estimate_verdicts(db_session)
    by_id = {o["id"]: o for o in out}

    assert set(by_id) == {"fer_0001", "fer_0002"}
    a = by_id["fer_0001"]
    # The correlation input: flags AND verdict come out together, per item.
    assert a["flags"] == {"dimension": "length", "path_repeat_index": 1}
    assert a["playtest_verdict"] == "repetitive"
    assert a["playtest_note"] == "seen it"
    assert a["answer"] == 183.0
    assert a["difficulty"] == "direct"
    assert "prompt" in a
    assert by_id["fer_0002"]["playtest_verdict"] is None
