"""Universal evaluation: every mode's per-round scoring feeds the taste profile (sub-project A)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.models import ContestWindow, QuestionInteractionEvent, RoundAnswer, User
from app.models.contest import OPEN
from app.services.contest import answer_round, enter_contest
from app.services.practice import answer_practice_round, start_practice
from app.services.taste_profile import get_or_create_profile
from content.loader import load_trivia
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


async def _user(session: AsyncSession) -> User:
    user = User(email=f"{uuid.uuid4().hex[:12]}@example.com", password_hash="x")
    session.add(user)
    await session.flush()
    return user


async def _round_answers(session: AsyncSession, entry_id) -> list[RoundAnswer]:
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


def _correct_result(module_type: str, server_answer: dict) -> dict:
    if module_type == "memory_flash":
        seq = server_answer["sequence"]
        return {"taps": seq, "tap_times": [100 * i for i in range(len(seq))], "elapsed_ms": 0}
    return {"choice": server_answer["correctIndex"], "elapsed_ms": 0}


async def _events(session: AsyncSession, user_id) -> list[QuestionInteractionEvent]:
    return list(
        (
            await session.execute(
                select(QuestionInteractionEvent).where(QuestionInteractionEvent.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )


async def _open_royale_window(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=now.date(),
        slot="royale",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=OPEN,
        template_id="dr_8_trivia",
    )
    session.add(window)
    await session.flush()
    return window


async def test_practice_answer_feeds_brain_model(db_session: AsyncSession) -> None:
    await load_trivia(db_session)
    user = await _user(db_session)
    entry = await start_practice(db_session, user.id, category=None, mode=None)
    answers = await _round_answers(db_session, entry.id)

    await answer_practice_round(
        db_session,
        entry.id,
        user.id,
        0,
        _correct_result(answers[0].module_type, answers[0].server_answer),
    )

    events = await _events(db_session, user.id)
    assert len(events) == 1
    assert events[0].is_correct is True
    assert events[0].mode == "practice"
    profile = await get_or_create_profile(db_session, user.id)
    assert profile.interaction_count == 1


async def test_royale_answer_feeds_brain_model(db_session: AsyncSession) -> None:
    await load_trivia(db_session)
    user = await _user(db_session)
    window = await _open_royale_window(db_session)
    entry = await enter_contest(db_session, window.id, user.id)
    answers = await _round_answers(db_session, entry.id)

    await answer_round(
        db_session,
        entry.id,
        user.id,
        0,
        _correct_result(answers[0].module_type, answers[0].server_answer),
    )

    events = await _events(db_session, user.id)
    assert len(events) == 1
    assert events[0].mode == "royale"
    assert events[0].is_correct is True


async def test_guest_play_builds_brain_model(db_session: AsyncSession) -> None:
    from app.models.user import GUEST_STATUS

    await load_trivia(db_session)
    guest = User(
        email=f"{uuid.uuid4().hex[:12]}@guest.invalid",
        password_hash="x",
        status=GUEST_STATUS,
    )
    db_session.add(guest)
    await db_session.flush()

    entry = await start_practice(db_session, guest.id, category=None, mode=None)
    answers = await _round_answers(db_session, entry.id)
    await answer_practice_round(
        db_session,
        entry.id,
        guest.id,
        0,
        _correct_result(answers[0].module_type, answers[0].server_answer),
    )

    profile = await get_or_create_profile(db_session, guest.id)
    assert profile.interaction_count == 1


async def test_practice_answer_counts_once_even_with_client_supplement(
    db_session: AsyncSession,
) -> None:
    """Server capture + a client engagement supplement for the same answer = one counted event."""
    from app.schemas.personalization import QuestionInteractionEventIn
    from app.services.taste_profile import record_interaction

    await load_trivia(db_session)
    user = await _user(db_session)
    entry = await start_practice(db_session, user.id, category=None, mode=None)
    answers = await _round_answers(db_session, entry.id)
    await answer_practice_round(
        db_session,
        entry.id,
        user.id,
        0,
        _correct_result(answers[0].module_type, answers[0].server_answer),
    )

    # The client posts its engagement-only supplement for the same round.
    await record_interaction(
        db_session,
        user.id,
        QuestionInteractionEventIn(
            mode="practice", entry_id=entry.id, idx=0, explanation_opened=True
        ),
    )

    profile = await get_or_create_profile(db_session, user.id)
    assert profile.interaction_count == 1  # server counted; the supplement did not
    events = await _events(db_session, user.id)
    assert len(events) == 2  # one server event + one engagement supplement row (both stored)
