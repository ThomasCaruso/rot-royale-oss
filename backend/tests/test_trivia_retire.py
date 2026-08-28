"""Deleting a trivia question — `ingest --retire-missing`.

Until this existed, removing a question from a bank file did NOTHING: the row stayed servable
forever and the only way out was a hand-run script against production. Every other content type
(change, video, estimate) already had a retire path; trivia was the one that could be published and
never unpublished.

The interesting tests here are the REFUSALS. Trivia is the biggest corpus in the game and the one
the Daily Royale is built on, so the ways this can go wrong are all "quietly deactivate content
nobody meant to remove":

  * the path may be a single bank FILE, and retiring against one file would deactivate every other
    category — around 800 questions;
  * a rejected row looks exactly like a deleted one;
  * campaign levels resolve their questions out of the servable bank BY KEY, so retiring one a level
    references does not degrade that level, it breaks it outright.
"""

from __future__ import annotations

from typing import Any

import pytest
from app.models import Question
from content.ingest import ingest_bank
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio


def _row(prompt: str, category: str = "Science & Nature") -> dict[str, Any]:
    return {
        "category": category,
        "question": prompt,
        "options": ["a", "b", "c", "d"],
        "correct_index": 0,
        "difficulty": "medium",
        "explanation": "because.",
        "confidence": "high",
    }


async def _status(session: AsyncSession, prompt: str) -> str | None:
    rows = (
        (await session.execute(select(Question).where(Question.module_type == "trivia")))
        .scalars()
        .all()
    )
    for q in rows:
        if q.payload.get("prompt") == prompt:
            return q.status
    return None


async def test_a_question_dropped_from_the_files_stops_being_servable(
    db_session: AsyncSession,
) -> None:
    await ingest_bank(db_session, [_row("keep me"), _row("drop me")])
    report = await ingest_bank(db_session, [_row("keep me")], retire_missing=True)

    assert report.retired == 1
    assert await _status(db_session, "keep me") == "approved"
    # 'draft' is not servable (§5a's single gate), and the row SURVIVES — nothing is deleted, so a
    # question can always come back.
    assert await _status(db_session, "drop me") == "draft"


async def test_putting_a_question_back_makes_it_servable_again(db_session: AsyncSession) -> None:
    """Symmetry is what makes this safe to run on every deploy: reverting a bank file has to restore
    what it dropped, not leave production permanently short."""
    await ingest_bank(db_session, [_row("a"), _row("b")])
    await ingest_bank(db_session, [_row("a")], retire_missing=True)
    report = await ingest_bank(db_session, [_row("a"), _row("b")], retire_missing=True)

    assert report.restored == 1
    assert await _status(db_session, "b") == "approved"


async def test_without_the_flag_nothing_is_ever_retired(db_session: AsyncSession) -> None:
    """A plain ingest must not be a content release. It runs on every deploy and on demand, and
    turning any of those into a deletion would be a very expensive surprise."""
    await ingest_bank(db_session, [_row("a"), _row("b")])
    report = await ingest_bank(db_session, [_row("a")])

    assert report.retired == 0
    assert await _status(db_session, "b") == "approved"


async def test_a_rejected_row_blocks_retiring_entirely(db_session: AsyncSession) -> None:
    """A row that failed validation is indistinguishable from one that was deleted."""
    await ingest_bank(db_session, [_row("safe"), _row("gone"), _row("broken")])

    bad = _row("broken")
    bad["options"] = ["only", "two"]  # rejected
    report = await ingest_bank(db_session, [_row("safe"), bad], retire_missing=True)

    assert report.rejected, "the malformed row should have been rejected"
    assert report.retired == 0
    assert await _status(db_session, "gone") == "approved", "retired on a partial bank"


async def test_a_question_a_campaign_level_serves_is_never_retired(
    db_session: AsyncSession, monkeypatch
) -> None:
    """THE ONE THAT PROTECTS A WHOLE GAME MODE.

    Campaign levels resolve their questions from the servable bank by key. A key that no longer
    resolves raises CategoryUnavailableError, so retiring a referenced question does not make that
    level slightly worse — it makes it unplayable. The removal is refused and reported instead.
    """
    import content.ingest as ingest_mod
    from content.campaign.keys import question_key

    await ingest_bank(db_session, [_row("in a level"), _row("free agent")])
    monkeypatch.setattr(
        ingest_mod,
        "_campaign_question_keys",
        lambda: {question_key("Science & Nature", "in a level")},
    )

    report = await ingest_bank(db_session, [], retire_missing=True)

    assert report.retired == 1, "the unreferenced question should still go"
    assert await _status(db_session, "free agent") == "draft"
    assert await _status(db_session, "in a level") == "approved", "broke a campaign level"
    assert any("in a level" in b for b in report.retire_blocked), report.retire_blocked


async def test_retiring_is_idempotent(db_session: AsyncSession) -> None:
    """It is wired into the deploy, so a second identical run must be a no-op rather than
    re-reporting work it already did."""
    await ingest_bank(db_session, [_row("a"), _row("b")])
    await ingest_bank(db_session, [_row("a")], retire_missing=True)
    report = await ingest_bank(db_session, [_row("a")], retire_missing=True)

    assert (report.retired, report.restored) == (0, 0)


async def test_a_bank_that_arrives_incomplete_aborts_instead_of_gutting_the_game(
    db_session: AsyncSession,
) -> None:
    """The failure this guards against is not a typo — it is the bank arriving incomplete.

    The files come from a separate content repo fetched at build time. If one fails to land, every
    question in it looks deleted, and on a deploy-wired retire that would deactivate them all in
    silence. Deleting questions is a normal edit that happens a few at a time; losing a fifth of the
    corpus in one run is a symptom.
    """
    full = [_row(f"q{i}") for i in range(60)]
    await ingest_bank(db_session, full)

    # A deploy where most of the bank never arrived.
    report = await ingest_bank(db_session, full[:5], retire_missing=True)

    assert report.retired == 0
    assert report.retire_aborted is not None
    assert "refusing" in report.retire_aborted
    # Everything is still playable.
    assert await _status(db_session, "q59") == "approved"


async def test_an_ordinary_deletion_is_still_allowed(db_session: AsyncSession) -> None:
    """The cap must not be so tight that normal content work trips it."""
    full = [_row(f"q{i}") for i in range(60)]
    await ingest_bank(db_session, full)

    report = await ingest_bank(db_session, full[:-3], retire_missing=True)

    assert report.retire_aborted is None
    assert report.retired == 3
