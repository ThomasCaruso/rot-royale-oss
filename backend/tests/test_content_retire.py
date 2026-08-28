"""`--retire-missing` for the change and video content packages.

Both ingests gained the flag at once and share one contract, so they are tested together: the
manifest becomes the ACTIVE SET, retiring deactivates rather than deletes, and the whole thing is
symmetric so reverting a content file restores what it dropped.

THE PROPERTY THAT MATTERS IS THE REFUSAL. `ingest-estimate` can retire safely because it is
all-or-nothing — a malformed file writes nothing and therefore retires nothing. These two reject
PER ITEM and carry on, which means a typo'd item and a deliberately deleted item look identical
from the retire pass's point of view. Retiring on a partial manifest would silently pull working
content out of the ranked Daily Royale on the strength of a typo, so it is refused outright.

The concrete case this was built for: a change pair needed pulling from the live set, and there was
no way to do it through the content pipeline at all — removing it from the manifest left the row
active forever. Publishing content was a one-way door. (That particular pair was reviewed and kept,
which exercised the other half of the contract: putting the key back reactivated it.)
"""

from __future__ import annotations

from typing import Any

import pytest
from app.models import CognitionChangeItem, CognitionVideoItem
from content.change_manifest import MANIFEST_VERSION as CHANGE_VERSION
from content.change_manifest import ingest_change_manifest
from content.video_manifest import MANIFEST_VERSION as VIDEO_VERSION
from content.video_manifest import ingest_video_manifest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio


# ── fixtures for the two package shapes ──────────────────────────────────────────────────────


def _change_item(key: str) -> dict[str, Any]:
    return {
        "key": key,
        "base_asset": f"{key}_base.jpg",
        "altered_asset": f"{key}_altered.jpg",
        "width": 1122,
        "height": 1402,
        "bbox": {"x": 0.3, "y": 0.3, "w": 0.2, "h": 0.2},
        "difficulty": "medium",
    }


def _video_q(prompt: str) -> dict[str, Any]:
    return {
        "prompt": prompt,
        "options": ["right", "wrong a", "wrong b", "wrong c"],
        "correct_index": 0,
    }


def _video_item(key: str) -> dict[str, Any]:
    return {
        "key": key,
        "base_asset": f"{key}_base.mp4",
        "altered_asset": f"{key}_altered.mp4",
        "width": 720,
        "height": 1280,
        "duration_ms": 5040,
        "questions": [_video_q("q one"), _video_q("q two")],
        "change_question": _video_q("what changed"),
    }


def _manifest(items: list[dict[str, Any]], version: int) -> dict[str, Any]:
    return {"version": version, "items": items}


async def _keys_active(session: AsyncSession, model) -> dict[str, bool]:
    rows = (await session.execute(select(model))).scalars().all()
    return {r.key: r.active for r in rows}


# Each entry: (label, ingest fn, item builder, model, manifest version). Everything below runs
# against both packages, because the contract is identical and a divergence between them is itself
# the bug. The versions differ (change is on 2, video on 1) and a manifest carrying the wrong one is
# a MANIFEST-level rejection — which would make every assertion here pass vacuously, so it is taken
# from the module constant rather than written out.
PACKAGES = [
    ("change", ingest_change_manifest, _change_item, CognitionChangeItem, CHANGE_VERSION),
    ("video", ingest_video_manifest, _video_item, CognitionVideoItem, VIDEO_VERSION),
]
IDS = [p[0] for p in PACKAGES]


@pytest.fixture(params=PACKAGES, ids=IDS)
def package(request):
    label, ingest, build, model, version = request.param

    async def run(session, keys, *, retire_missing=False, corrupt=False):
        items = [build(k) for k in keys]
        if corrupt:
            # A realistic authoring slip, not a structural one: the item is still an object with a
            # key, so it reaches the per-item validator and is rejected there rather than taking
            # the whole manifest down.
            items[-1]["width"] = -5
        report = await ingest(
            session, _manifest(items, version), None, retire_missing=retire_missing
        )
        # Guard against the vacuous pass: unless a test asked for a corrupt item, a rejection here
        # means the FIXTURE is malformed, and every count below would be a meaningless zero.
        if not corrupt:
            assert not report.rejected, f"{label} fixture rejected: {report.rejected}"
        return report

    return label, run, model


# ── the contract ─────────────────────────────────────────────────────────────────────────────


async def test_a_dropped_key_is_retired_not_deleted(db_session: AsyncSession, package) -> None:
    _label, run, model = package
    await run(db_session, ["keep_me", "drop_me"])
    report = await run(db_session, ["keep_me"], retire_missing=True)
    assert report.retired == 1
    active = await _keys_active(db_session, model)
    # The row SURVIVES. A window plan pinned earlier still has to resolve the item it drew.
    assert active == {"keep_me": True, "drop_me": False}


async def test_re_adding_a_key_reactivates_it(db_session: AsyncSession, package) -> None:
    """Symmetry is what makes this safe to run on every deploy: reverting the content file has to
    restore the previous active set, not leave prod permanently missing whatever an edit dropped."""
    _label, run, model = package
    await run(db_session, ["a", "b"])
    await run(db_session, ["a"], retire_missing=True)
    report = await run(db_session, ["a", "b"], retire_missing=True)
    assert report.reactivated == 1
    assert (await _keys_active(db_session, model))["b"] is True


async def test_without_the_flag_nothing_is_ever_deactivated(
    db_session: AsyncSession, package
) -> None:
    """`active` is operational state. A plain ingest must not touch it, or every run of the
    ordinary command becomes a content release."""
    _label, run, model = package
    await run(db_session, ["a", "b"])
    report = await run(db_session, ["a"])
    assert (report.retired, report.reactivated) == (0, 0)
    assert (await _keys_active(db_session, model))["b"] is True


async def test_a_rejected_item_blocks_retiring_entirely(db_session: AsyncSession, package) -> None:
    """The refusal, and the reason this is not a copy of the estimate implementation.

    `broken` is present in the manifest but malformed, so it is rejected and never written. To the
    retire pass an unwritten key is indistinguishable from a deleted one — and `gone` really was
    deleted. Retiring on that basis would take content out of the ranked game because of a typo, so
    NOTHING is retired until the manifest comes through clean.
    """
    _label, run, model = package
    await run(db_session, ["safe", "gone", "broken"])
    report = await run(db_session, ["safe", "broken"], retire_missing=True, corrupt=True)
    assert report.rejected, "the corrupt item should have been rejected"
    assert report.retired == 0
    assert (await _keys_active(db_session, model))["gone"] is True, "retired on a partial manifest"


async def test_a_clean_manifest_after_a_rejected_one_does_retire(
    db_session: AsyncSession, package
) -> None:
    """The refusal must be a pause, not a permanent block — fixing the typo has to let the
    pending retire through on the next run, or content can never be removed after one bad edit."""
    _label, run, model = package
    await run(db_session, ["safe", "gone", "broken"])
    await run(db_session, ["safe", "broken"], retire_missing=True, corrupt=True)
    report = await run(db_session, ["safe", "broken"], retire_missing=True)
    assert report.retired == 1
    assert (await _keys_active(db_session, model))["gone"] is False


async def test_retiring_is_idempotent(db_session: AsyncSession, package) -> None:
    """It runs on every deploy, so a second identical run must be a no-op rather than re-reporting
    work it already did."""
    _label, run, _model = package
    await run(db_session, ["a", "b"])
    await run(db_session, ["a"], retire_missing=True)
    report = await run(db_session, ["a"], retire_missing=True)
    assert (report.retired, report.reactivated) == (0, 0)
