"""The video round: one Royale slot, three scored answers.

The properties worth a test rather than a look:

ANSWERS NEVER LEAVE THE SERVER. The authored content puts every correct answer at index 0 — a
writing convenience that would be a free win for anyone who noticed. Options are shuffled from the
instance seed before being served, and the client's choice is mapped back through that same order,
so the authored index is unobservable and guessing it gains nothing.

THE CHANGE QUESTION DECIDES THE ROUND. Points are the sum of three, but the streak and the Rot
Rating game key off `correct` alone — and that is the change question, because it is the round's
actual test. Getting both comprehension questions right and the change question wrong must still be
a failed round.

EXISTING ROUND TYPES ARE UNCHANGED. `sub_scores` is a new optional field on the shared
`RoundJudgement`; every other type leaves it None and must score exactly as before.
"""

from __future__ import annotations

import uuid

import pytest
from app.models import CognitionAttempt, CognitionVideoItem
from app.modules.base import RoundJudgement
from app.services import cognition
from app.services.cognition import (
    VIDEO_QUESTION_TIME_LIMIT_MS,
    start_video_with_item,
    video_option_order,
)
from app.services.registration import register_guest
from app.services.royale_rounds import bridge_judgement
from app.services.scoring import compute_points
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio


def _question(prompt: str) -> dict:
    # Correct answer at index 0, exactly as the authored file writes it.
    return {
        "prompt": prompt,
        "options": ["right", "wrong a", "wrong b", "wrong c"],
        "correct_index": 0,
    }


async def _item(session: AsyncSession, key: str = "test_clip") -> CognitionVideoItem:
    item = CognitionVideoItem(
        key=key,
        base_asset=f"{key}_base.mp4",
        altered_asset=f"{key}_altered.mp4",
        width=720,
        height=1280,
        duration_ms=5040,
        questions=[_question("q one"), _question("q two")],
        change_question=_question("what changed"),
        difficulty="medium",
    )
    session.add(item)
    await session.flush()
    return item


async def _start(session: AsyncSession, seed: int = 4242):
    user = await register_guest(session)
    await session.flush()
    item = await _item(session)
    started = await start_video_with_item(session, user.id, seed, item)
    return user, item, started


# ── the spec the client actually receives ────────────────────────────────────────────────────


async def test_the_spec_never_carries_a_correct_index(db_session: AsyncSession) -> None:
    _user, _item, started = await _start(db_session)
    blob = repr(started.spec)
    assert "correct_index" not in blob
    for q in [*started.spec["questions"], started.spec["change_question"]]:
        assert set(q) == {"prompt", "options"}, q


async def test_options_are_shuffled_so_index_zero_is_not_the_tell(
    db_session: AsyncSession,
) -> None:
    """Authored content is index-0-heavy. If that reached players, "always pick A" would beat the
    round without watching the clip at all."""
    positions = set()
    for seed in range(40):
        order = video_option_order(seed, 2, 4)
        positions.add(order.index(0))  # where the authored-correct option ended up
    assert len(positions) > 1, positions


async def test_the_spec_serves_two_questions_then_the_change_question(
    db_session: AsyncSession,
) -> None:
    _user, _item, started = await _start(db_session)
    assert len(started.spec["questions"]) == 2
    assert started.spec["change_question"]["prompt"] == "what changed"
    assert started.spec["question_time_limit_ms"] == VIDEO_QUESTION_TIME_LIMIT_MS
    # Absolute URLs: the native app loads its bundle from disk, so a relative path resolves against
    # the BUNDLE and 404s for content added after that binary shipped.
    assert started.spec["base_url"].startswith("http")
    assert "/content/video/" in started.spec["base_url"]


# ── answering ────────────────────────────────────────────────────────────────────────────────


async def _answer(session, inst_id, user_id, qi, *, right: bool, elapsed=1000):
    order = video_option_order(
        (await session.get(cognition.CognitionRoundInstance, inst_id)).seed, qi, 4
    )
    served = order.index(0) if right else order.index(1)
    return await cognition.video_answer(session, inst_id, user_id, qi, served, elapsed)


async def test_three_answers_complete_the_round(db_session: AsyncSession) -> None:
    user, _item, started = await _start(db_session)
    inst = started.instance
    for qi in (0, 1):
        out = await _answer(db_session, inst.id, user.id, qi, right=True)
        assert out.correct is True
        assert out.finished is False
    out = await _answer(db_session, inst.id, user.id, 2, right=True)
    assert out.finished is True
    await db_session.refresh(inst)
    assert inst.completed_at is not None
    assert inst.final_score == 3


async def test_a_wrong_choice_is_judged_wrong(db_session: AsyncSession) -> None:
    user, _item, started = await _start(db_session)
    out = await _answer(db_session, started.instance.id, user.id, 0, right=False)
    assert out.correct is False


async def test_a_timeout_scores_wrong_rather_than_erroring(db_session: AsyncSession) -> None:
    """The change round taught this: a timeout that 422s leaves the instance unresolved and the
    Royale bridge 409ing behind it, stranding the player mid-run with no way to finish."""
    user, _item, started = await _start(db_session)
    out = await cognition.video_answer(
        db_session, started.instance.id, user.id, 0, None, VIDEO_QUESTION_TIME_LIMIT_MS
    )
    assert out.correct is False
    assert out.answered == 1


async def test_answering_the_same_question_twice_is_refused(db_session: AsyncSession) -> None:
    # Enforced by the unique (instance, attempt_index) constraint, so name IntegrityError rather
    # than catching anything: a blind assert would pass even if the second answer failed for some
    # unrelated reason, which is exactly the bug this is meant to catch.
    user, _item, started = await _start(db_session)
    await _answer(db_session, started.instance.id, user.id, 0, right=True)
    with pytest.raises(IntegrityError):
        await _answer(db_session, started.instance.id, user.id, 0, right=True)


async def test_another_player_cannot_answer_your_round(db_session: AsyncSession) -> None:
    _user, _item, started = await _start(db_session)
    intruder = await register_guest(db_session)
    await db_session.flush()
    with pytest.raises(cognition.RoundNotFoundError):
        await cognition.video_answer(db_session, started.instance.id, intruder.id, 0, 0, 500)


# ── the scoring bridge ───────────────────────────────────────────────────────────────────────


async def test_the_change_question_decides_the_round(db_session: AsyncSession) -> None:
    """Both comprehension questions right, change question wrong = a FAILED round. The streak and
    the Rot Rating game key off `correct`, and this round's test is the change."""
    user, _item, started = await _start(db_session)
    inst = started.instance
    await _answer(db_session, inst.id, user.id, 0, right=True)
    await _answer(db_session, inst.id, user.id, 1, right=True)
    await _answer(db_session, inst.id, user.id, 2, right=False)
    j = await bridge_judgement(db_session, "video", inst)
    assert j.correct is False
    # ...but the two right answers still carry points.
    assert j.sub_scores is not None
    assert [c for c, _ in j.sub_scores] == [True, True]


async def test_points_are_the_sum_of_three_through_the_one_formula(
    db_session: AsyncSession,
) -> None:
    user, _item, started = await _start(db_session)
    inst = started.instance
    for qi in (0, 1, 2):
        await _answer(db_session, inst.id, user.id, qi, right=True, elapsed=0)
    j = await bridge_judgement(db_session, "video", inst)
    assert j.correct is True
    assert j.sub_scores is not None and len(j.sub_scores) == 2
    # What contest.answer_round does: the round's own points plus one compute_points per sub-score,
    # all at the same streak level, all through the same formula.
    total = compute_points(True, j.time_frac, 1)
    for c, f in j.sub_scores:
        if c:
            total += compute_points(True, f, 1)
    single = compute_points(True, j.time_frac, 1)
    assert total > single, "a three-answer round must out-score a one-answer round"
    assert total == pytest.approx(3 * single, rel=0.01), "an all-correct fast round is ~3x"


async def test_sub_scores_default_to_none_so_other_types_are_untouched() -> None:
    """The field is new on a type every round shares. Every other module must behave as before."""
    j = RoundJudgement(correct=True, time_frac=0.5, valid=True)
    assert j.sub_scores is None


async def test_attempt_zero_is_the_draw_marker_not_an_answer(db_session: AsyncSession) -> None:
    """Attempt 0 pins WHICH clip is in play, so the answers are judged against the item drawn at
    start rather than anything re-derived later."""
    _user, item, started = await _start(db_session)
    marker = (
        await db_session.execute(
            select(CognitionAttempt).where(
                CognitionAttempt.round_instance_id == started.instance.id,
                CognitionAttempt.attempt_index == 0,
            )
        )
    ).scalar_one()
    assert marker.payload["item_id"] == str(item.id)
    assert marker.is_correct is None


async def test_an_unknown_question_index_is_refused(db_session: AsyncSession) -> None:
    user, _item, started = await _start(db_session)
    with pytest.raises(cognition.RoundNotFoundError):
        await cognition.video_answer(db_session, started.instance.id, user.id, 9, 0, 500)


async def test_an_unknown_instance_is_refused(db_session: AsyncSession) -> None:
    user = await register_guest(db_session)
    await db_session.flush()
    with pytest.raises(cognition.RoundNotFoundError):
        await cognition.video_answer(db_session, uuid.uuid4(), user.id, 0, 0, 500)
