"""Ingesting the video round's content package.

The package is deliberately TWO files — a mechanical manifest probed from the asset files, and an
authored file holding everything a person decided — and the whole risk lives at the seam where they
are merged. `video/manifest.json` is regenerated from the clips whenever one is added, so anything
authored that ends up living there is destroyed on the next regeneration, silently, with no error
and no failing test. That already applied to the questions; it applies just as much to difficulty,
which is a judgement about how hard a change is to SPOT and cannot be probed from a file.

The other half is the usual ingest discipline: upsert by key, and reject a malformed clip loudly
rather than letting it land half-formed and surface as a broken round mid-Royale.
"""

from __future__ import annotations

from typing import Any

import pytest
from app.jobs.run import _ingest_video
from app.models import CognitionVideoItem
from content.video_manifest import (
    COMPREHENSION_QUESTIONS,
    MANIFEST_VERSION,
    OPTIONS_PER_QUESTION,
    ingest_video_manifest,
    merge_questions,
    validate_manifest,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio


def _q(prompt: str) -> dict[str, Any]:
    return {
        "prompt": prompt,
        "options": ["right", "wrong a", "wrong b", "wrong c"],
        "correct_index": 0,
    }


def _authored(difficulty: str | None = "hard") -> dict[str, Any]:
    item: dict[str, Any] = {
        "questions": [_q("q one"), _q("q two")],
        "change_question": _q("what changed"),
    }
    if difficulty is not None:
        item["difficulty"] = difficulty
    return {"clip_a": item}


def _mechanical() -> dict[str, Any]:
    """What the manifest generator writes: assets and dimensions, and nothing a human chose."""
    return {
        "version": MANIFEST_VERSION,
        "items": [
            {
                "key": "clip_a",
                "base_asset": "clip_a_base.mp4",
                "altered_asset": "clip_a_altered.mp4",
                "width": 720,
                "height": 1280,
                "duration_ms": 5040,
            }
        ],
    }


# ── the merge seam ───────────────────────────────────────────────────────────────────────────


def test_the_merge_stamps_every_authored_field_onto_the_mechanical_manifest():
    m = _mechanical()
    assert merge_questions(m, _authored()) == 1
    item = m["items"][0]
    assert len(item["questions"]) == COMPREHENSION_QUESTIONS
    assert item["change_question"]["prompt"] == "what changed"
    assert item["difficulty"] == "hard"


def test_regenerating_the_manifest_cannot_drop_the_authored_difficulty():
    """The regression this file exists for.

    Difficulty used to be readable only from the manifest, which is rebuilt from the asset files
    every time a clip is added. Round-tripping through a freshly generated manifest is exactly what
    happens in practice, and it must come back out the far side unchanged.
    """
    authored = _authored("hard")
    for _ in range(3):  # add a clip, regenerate, ingest — three times over
        m = _mechanical()  # a fresh mechanical manifest: no difficulty anywhere in it
        assert "difficulty" not in m["items"][0]
        merge_questions(m, authored)
        assert m["items"][0]["difficulty"] == "hard"


def test_the_merge_never_overwrites_what_the_manifest_already_carries():
    """Precedence has to be one-directional or the two files can disagree with no way to tell."""
    m = _mechanical()
    m["items"][0]["difficulty"] = "easy"
    m["items"][0]["change_question"] = _q("already here")
    merge_questions(m, _authored("hard"))
    assert m["items"][0]["difficulty"] == "easy"
    assert m["items"][0]["change_question"]["prompt"] == "already here"


def test_an_absent_difficulty_is_left_absent_rather_than_invented():
    m = _mechanical()
    merge_questions(m, _authored(None))
    assert "difficulty" not in m["items"][0]


# ── validation ───────────────────────────────────────────────────────────────────────────────


def _validated(mutate) -> list[str]:
    m = _mechanical()
    merge_questions(m, _authored())
    mutate(m["items"][0])
    # content_root=None skips the on-disk asset check; this is about the manifest's own shape.
    return [reason for _, reason in validate_manifest(m, None)]


def test_a_clean_merged_manifest_validates():
    assert _validated(lambda item: None) == []


def test_an_unknown_difficulty_is_refused():
    reasons = _validated(lambda item: item.update(difficulty="brutal"))
    assert any("difficulty" in r for r in reasons), reasons


def test_a_question_with_the_wrong_number_of_options_is_refused():
    reasons = _validated(lambda item: item["questions"][0].update(options=["a", "b"]))
    assert reasons, f"{OPTIONS_PER_QUESTION} options are required"


def test_a_correct_index_outside_the_options_is_refused():
    reasons = _validated(lambda item: item["questions"][0].update(correct_index=9))
    assert reasons


def test_a_duplicate_key_is_refused():
    m = _mechanical()
    merge_questions(m, _authored())
    m["items"].append(dict(m["items"][0]))
    assert any("duplicate" in r for _, r in validate_manifest(m, None))


# ── ingest ───────────────────────────────────────────────────────────────────────────────────


async def _ingest(session: AsyncSession, difficulty: str | None = "hard"):
    m = _mechanical()
    merge_questions(m, _authored(difficulty))
    return await ingest_video_manifest(session, m, None)


async def _row(session: AsyncSession) -> CognitionVideoItem:
    return (
        await session.execute(select(CognitionVideoItem).where(CognitionVideoItem.key == "clip_a"))
    ).scalar_one()


async def test_ingest_lands_the_authored_difficulty_in_the_row(db_session: AsyncSession) -> None:
    report = await _ingest(db_session)
    assert (report.added, report.rejected) == (1, [])
    assert (await _row(db_session)).difficulty == "hard"


async def test_re_ingesting_an_unchanged_package_is_a_no_op(db_session: AsyncSession) -> None:
    """The deploy re-ingests on every start, so an unchanged file must not rewrite every row."""
    await _ingest(db_session)
    report = await _ingest(db_session)
    assert (report.added, report.updated, report.skipped) == (0, 0, 1)


async def test_an_edited_difficulty_refreshes_the_row_in_place(db_session: AsyncSession) -> None:
    await _ingest(db_session, "hard")
    report = await _ingest(db_session, "easy")
    assert report.updated == 1
    assert (await _row(db_session)).difficulty == "easy"


async def test_a_malformed_item_is_rejected_loudly_and_never_lands(
    db_session: AsyncSession,
) -> None:
    """A half-formed clip is worse than a missing one: it becomes an unanswerable ranked round."""
    m = _mechanical()
    merge_questions(m, _authored())
    m["items"][0]["change_question"]["options"] = ["only", "two"]
    report = await ingest_video_manifest(db_session, m, None)
    assert report.rejected, "a bad item must be reported, not silently skipped"
    assert report.added == 0
    assert (
        await db_session.execute(
            select(CognitionVideoItem).where(CognitionVideoItem.key == "clip_a")
        )
    ).scalar_one_or_none() is None


class TestAMissingManifestIsNotADeployFailure:
    """`ingest-video` sits in the web service's `&&` startCommand: its exit code gates the deploy.

    A content package with no `video/` at all is a legitimate state — `royale_content_availability`
    only puts "video" in the Royale pool when active rows exist, so a deployment without video
    content simply runs the other four types. Exiting non-zero there would abort the chain before
    uvicorn and kill the deploy on its health check, for content the game never needed.

    The asymmetry is the point, and it is why `required` exists rather than a blanket skip: a path
    someone TYPED must exist, because silently doing nothing about a typo is how a content release
    goes missing unnoticed.
    """

    async def test_a_resolved_path_that_is_absent_is_a_no_op(
        self, tmp_path: Any, capsys: Any
    ) -> None:
        await _ingest_video(str(tmp_path / "video" / "manifest.json"), required=False)
        assert "skipping" in capsys.readouterr().out

    async def test_it_does_NOT_retire_the_corpus_when_the_manifest_is_absent(
        self, tmp_path: Any, monkeypatch: Any
    ) -> None:
        """The dangerous reading of a missing manifest is "every item was deleted"."""

        def _boom(*a: Any, **k: Any) -> None:
            raise AssertionError("the retire pass must not run against a manifest that is absent")

        monkeypatch.setattr("content.video_manifest.ingest_video_manifest", _boom)
        await _ingest_video(
            str(tmp_path / "video" / "manifest.json"), retire_missing=True, required=False
        )

    async def test_a_typed_path_that_is_absent_still_fails_loudly(self, tmp_path: Any) -> None:
        with pytest.raises(SystemExit):
            await _ingest_video(str(tmp_path / "typo.json"), required=True)
