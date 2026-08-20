"""Task 3.4b — Duel per-round submit, finalize, and expiry cleanup.

These exercise the live-match path end-to-end against a SCRIPTED rival run: after create_duel we
overwrite match.rival_run with a deterministic [{correct, time_frac}, ...] (length 10), and we force
the human's correctness by reading each RoundAnswer.server_answer["correctIndex"] (submit it to be
correct; submit a different index to be wrong) and the human's speed via elapsed_ms.

Recall: user_time_ms ≈ elapsed_ms; rival_time_ms = round(10000 * (1 - rival_time_frac)).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.models import DuelMatch, GemLedger, Profile, RoundAnswer, User
from app.models.duel import DuelUserStats
from app.services.contest import EntryNotFoundError
from app.services.duel import (
    DuelNotFoundError,
    DuelRoundSequenceError,
    DuelStateError,
    cleanup_expired_duels,
    create_duel,
    finalize_duel,
    submit_duel_round,
)
from app.services.gem_ledger import record_gem_delta
from app.services.practice import answer_practice_round, submit_practice
from content.loader import load_trivia
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def _user(session: AsyncSession, *, gems: int = 0) -> uuid.UUID:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(Profile(user_id=user.id, username=f"u{uuid.uuid4().hex[:10]}", division="Bronze"))
    await session.flush()
    if gems:
        await record_gem_delta(session, user.id, gems, "test")
    return user.id


async def _script_rival(session: AsyncSession, match: DuelMatch, run: list[dict]) -> None:
    """Overwrite the rival run deterministically (reassign, not mutate, for JSONB tracking)."""
    match.rival_run = [dict(r) for r in run]
    await session.flush()


async def _correct_index(session: AsyncSession, match: DuelMatch, idx: int) -> int:
    answer = await session.get(RoundAnswer, (match.entry_id, idx))
    assert answer is not None
    return int(answer.server_answer["correctIndex"])


async def _submit(
    session: AsyncSession,
    uid: uuid.UUID,
    match: DuelMatch,
    idx: int,
    *,
    correct: bool,
    elapsed_ms: int = 2000,
):
    ci = await _correct_index(session, match, idx)
    choice = ci if correct else (ci + 1) % 4
    return await submit_duel_round(
        session, uid, match.id, idx, {"choice": choice, "elapsed_ms": elapsed_ms}
    )


# rival_time_frac for a desired rival_time_ms.
def _rtf(ms: int) -> float:
    return 1 - ms / 10000


# ---------------- round outcomes ----------------
async def test_outcome_user_correct_rival_wrong(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session)
    match = (await create_duel(db_session, uid, "training")).match
    await _script_rival(db_session, match, [{"correct": False, "time_frac": 0.5}] * 10)

    rev = await _submit(db_session, uid, match, 0, correct=True)
    assert rev.outcome == "user_win" and rev.outcome_reason == "correct_vs_wrong"
    assert rev.your_correct is True and rev.rival_correct is False
    assert rev.user_round_wins == 1 and rev.rival_round_wins == 0
    assert "correctIndex" in rev.answer


async def test_outcome_rival_correct_user_wrong(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session)
    match = (await create_duel(db_session, uid, "training")).match
    await _script_rival(db_session, match, [{"correct": True, "time_frac": 0.5}] * 10)

    rev = await _submit(db_session, uid, match, 0, correct=False)
    assert rev.outcome == "rival_win" and rev.outcome_reason == "correct_vs_wrong"
    assert rev.user_round_wins == 0 and rev.rival_round_wins == 1


async def test_outcome_both_wrong(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session)
    match = (await create_duel(db_session, uid, "training")).match
    await _script_rival(db_session, match, [{"correct": False, "time_frac": 0.5}] * 10)

    rev = await _submit(db_session, uid, match, 0, correct=False)
    assert rev.outcome == "no_point" and rev.outcome_reason == "both_wrong"
    assert rev.user_round_wins == 0 and rev.rival_round_wins == 0


async def test_outcome_both_correct_user_faster_speed_gap(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session)
    match = (await create_duel(db_session, uid, "training")).match
    # rival uses ~5000ms; user 1000ms → gap 4000 >= 350 → user_win/speed_gap.
    await _script_rival(db_session, match, [{"correct": True, "time_frac": _rtf(5000)}] * 10)

    rev = await _submit(db_session, uid, match, 0, correct=True, elapsed_ms=1000)
    assert rev.outcome == "user_win" and rev.outcome_reason == "speed_gap"
    assert rev.rival_time_ms == 5000


async def test_outcome_both_correct_near_tie(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session)
    match = (await create_duel(db_session, uid, "training")).match
    # rival 2100ms, user 2000ms → gap 100 < 350 → no_point/near_tie_correct.
    await _script_rival(db_session, match, [{"correct": True, "time_frac": _rtf(2100)}] * 10)

    rev = await _submit(db_session, uid, match, 0, correct=True, elapsed_ms=2000)
    assert rev.outcome == "no_point" and rev.outcome_reason == "near_tie_correct"


# ---------------- match resolution ----------------
async def test_first_to_4_early_end(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session)
    match = (await create_duel(db_session, uid, "training")).match
    await _script_rival(db_session, match, [{"correct": False, "time_frac": 0.5}] * 10)

    for idx in range(3):
        rev = await _submit(db_session, uid, match, idx, correct=True)
        assert rev.finished is False and rev.next == "normal"
    rev = await _submit(db_session, uid, match, 3, correct=True)
    assert rev.finished is True and rev.next == "done"
    assert rev.result is not None
    assert rev.result.winner == "user" and rev.result.result_reason == "first_to_4"
    assert rev.user_round_wins == 4

    # exactly 4 rounds played: a 5th submit → match no longer in_progress.
    with pytest.raises(DuelStateError):
        await _submit(db_session, uid, match, 4, correct=True)


async def test_higher_wins_after_7(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session)
    match = (await create_duel(db_session, uid, "training")).match
    await _script_rival(db_session, match, [{"correct": False, "time_frac": 0.5}] * 10)

    # 7 normal rounds: user wins 3 (0,1,2), rival wins 2 (3,4), 2 no-points (5,6) → 3-2, user leads.
    script = [
        (True, False),  # user_win
        (True, False),
        (True, False),
        (False, True),  # rival_win
        (False, True),
        (False, False),  # no_point
        (False, False),
    ]
    rev = None
    for idx, (u, r) in enumerate(script):
        # set this round's rival correctness
        run = list(match.rival_run)
        run[idx] = {"correct": r, "time_frac": 0.5}
        match.rival_run = run
        await db_session.flush()
        rev = await _submit(db_session, uid, match, idx, correct=u)
    assert rev is not None and rev.finished is True
    assert rev.result.result_reason == "higher_round_wins"
    assert rev.result.winner == "user"
    assert rev.user_round_wins == 3 and rev.rival_round_wins == 2


async def test_sudden_death_win(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session)
    match = (await create_duel(db_session, uid, "training")).match

    # 3-3 after 7 (3 user wins, 3 rival wins, 1 no-point), then 8th (SD) the user wins.
    script = [
        (True, False),
        (True, False),
        (True, False),
        (False, True),
        (False, True),
        (False, True),
        (False, False),  # 3-3 with 1 no-point
        (True, False),  # SD round → user wins
    ]
    # pad to 10
    full = [{"correct": r, "time_frac": 0.5} for (_, r) in script] + [
        {"correct": False, "time_frac": 0.5}
    ] * (10 - len(script))
    await _script_rival(db_session, match, full)

    rev = None
    for idx, (u, _r) in enumerate(script):
        rev = await _submit(db_session, uid, match, idx, correct=u)
        if idx < 7:
            assert rev.phase == "normal"
    assert rev is not None
    assert rev.phase == "sudden_death"
    assert rev.finished is True
    assert rev.result.winner == "user"
    assert rev.result.result_reason == "sudden_death"
    assert rev.user_round_wins == 4 and rev.rival_round_wins == 3


async def test_tiebreak_after_full_sudden_death(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session)
    match = (await create_duel(db_session, uid, "training")).match

    # 3-3 after 7, then 3 SD rounds all no_point (both wrong) → tiebreak.
    script = [
        (True, False),
        (True, False),
        (True, False),
        (False, True),
        (False, True),
        (False, True),
        (False, False),
        (False, False),  # SD 1 both wrong
        (False, False),  # SD 2
        (False, False),  # SD 3
    ]
    full = [{"correct": r, "time_frac": 0.5} for (_, r) in script]
    await _script_rival(db_session, match, full)

    rev = None
    for idx, (u, _r) in enumerate(script):
        rev = await _submit(db_session, uid, match, idx, correct=u)
    assert rev is not None and rev.finished is True
    assert rev.result.result_reason in {
        "tiebreak_total_correct",
        "tiebreak_avg_speed",
        "tiebreak_seed",
    }
    assert rev.result.winner in {"user", "rival"}
    # deterministic for this seed: re-running gives the same winner (pure final_tiebreak on seed).


# ---------------- economy / stats ----------------
async def test_spark_win_credits_pool(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session, gems=5)  # entry debits 1 at create → 4
    match = (await create_duel(db_session, uid, "spark")).match
    # rival wins round 0, user wins 1-4 → 4-1 win that is NOT perfect (user missed round 0), so
    # the base gem-win XP (10) applies with no perfect bonus.
    await _script_rival(
        db_session,
        match,
        [{"correct": True, "time_frac": 0.5}] + [{"correct": False, "time_frac": 0.5}] * 9,
    )

    rev = await _submit(db_session, uid, match, 0, correct=False)
    for idx in range(1, 5):
        rev = await _submit(db_session, uid, match, idx, correct=True)
    assert rev.finished is True and rev.result.winner == "user"

    profile = await db_session.get(Profile, uid)
    assert profile.gems_balance == 5 - 1 + 2  # start - entry + pool

    win_row = (
        await db_session.execute(
            select(GemLedger).where(GemLedger.idempotency_key == f"duel:{match.id}:win")
        )
    ).scalar_one()
    assert win_row.delta == 2 and win_row.reason == "duel_pool_win"

    assert match.gem_delta == 1
    stats = await db_session.get(DuelUserStats, uid)
    assert stats.wins == 1 and stats.total_gems_won == 2 and stats.current_streak == 1
    assert stats.duel_xp == 10
    assert stats.duel_tier == "bronze"
    assert match.winner == "user"


async def test_spark_loss(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session, gems=5)
    match = (await create_duel(db_session, uid, "spark")).match
    # rival wins 4 straight.
    await _script_rival(db_session, match, [{"correct": True, "time_frac": 0.5}] * 10)

    for idx in range(4):
        rev = await _submit(db_session, uid, match, idx, correct=False)
    assert rev.finished is True and rev.result.winner == "rival"

    # no pool row.
    n_win = await db_session.scalar(
        select(func.count())
        .select_from(GemLedger)
        .where(GemLedger.idempotency_key == f"duel:{match.id}:win")
    )
    assert n_win == 0
    assert match.gem_delta == -1
    stats = await db_session.get(DuelUserStats, uid)
    assert stats.losses == 1 and stats.total_gems_lost == 1 and stats.current_streak == 0


async def test_training_no_gems_no_streak(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session, gems=5)
    match = (await create_duel(db_session, uid, "training")).match
    # rival wins round 0 so the user's 4-1 win is NOT perfect → base training-win XP (2), no bonus.
    await _script_rival(
        db_session,
        match,
        [{"correct": True, "time_frac": 0.5}] + [{"correct": False, "time_frac": 0.5}] * 9,
    )

    rev = await _submit(db_session, uid, match, 0, correct=False)
    for idx in range(1, 5):
        rev = await _submit(db_session, uid, match, idx, correct=True)
    assert rev.finished is True and rev.result.winner == "user"
    assert rev.result.gem_delta == 0

    n_ledger = await db_session.scalar(
        select(func.count())
        .select_from(GemLedger)
        .where(GemLedger.user_id == uid, GemLedger.reason.in_(("duel_entry", "duel_pool_win")))
    )
    assert n_ledger == 0
    stats = await db_session.get(DuelUserStats, uid)
    assert stats.training_wins == 1 and stats.current_streak == 0
    assert stats.duel_xp == 2


async def test_perfect_win(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session, gems=5)
    match = (await create_duel(db_session, uid, "spark")).match
    # rival never correct → user 4-0, all correct → perfect.
    await _script_rival(db_session, match, [{"correct": False, "time_frac": 0.5}] * 10)

    for idx in range(4):
        rev = await _submit(db_session, uid, match, idx, correct=True)
    assert rev.finished is True
    assert rev.result.perfect is True
    stats = await db_session.get(DuelUserStats, uid)
    assert stats.perfect_wins == 1
    # gem win 10 + perfect bonus 5 = 15.
    assert rev.result.xp_awarded == 15
    assert stats.duel_xp == 15


async def test_finalize_idempotent_returns_persisted_facts(db_session: AsyncSession):
    """A SECOND finalize_duel on a completed match returns the SAME DuelResult (incl. perfect),
    writes nothing (no stats double-increment, no second ledger row). Exercised on a perfect gem
    win so perfect=True is reconstructed from the persisted match across both calls."""
    await load_trivia(db_session)
    uid = await _user(db_session, gems=5)
    match = (await create_duel(db_session, uid, "spark")).match
    # rival never correct → user 4-0, all correct → perfect gem win.
    await _script_rival(db_session, match, [{"correct": False, "time_frac": 0.5}] * 10)

    rev = None
    for idx in range(4):
        rev = await _submit(db_session, uid, match, idx, correct=True)
    assert rev is not None and rev.finished is True
    first = rev.result
    assert first is not None and first.perfect is True

    stats = await db_session.get(DuelUserStats, uid)
    perfect_wins_before = stats.perfect_wins
    wins_before = stats.wins
    xp_before = stats.duel_xp
    gems_won_before = stats.total_gems_won

    # call finalize AGAIN directly with the recorded winner/reason.
    again = await finalize_duel(
        db_session, match, match.winner, match.result_reason, datetime.now(UTC)
    )
    assert again.winner == first.winner == "user"
    assert again.result_reason == first.result_reason
    assert again.gem_delta == first.gem_delta
    assert again.xp_awarded == first.xp_awarded
    assert again.perfect is True and first.perfect is True
    assert again.comeback == first.comeback
    assert again.duel_tier == first.duel_tier

    # no double increment.
    stats = await db_session.get(DuelUserStats, uid)
    assert stats.perfect_wins == perfect_wins_before
    assert stats.wins == wins_before
    assert stats.duel_xp == xp_before
    assert stats.total_gems_won == gems_won_before

    # still exactly ONE pool-win ledger row.
    n_win = await db_session.scalar(
        select(func.count())
        .select_from(GemLedger)
        .where(GemLedger.idempotency_key == f"duel:{match.id}:win")
    )
    assert n_win == 1


async def test_comeback_win(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session, gems=5)
    match = (await create_duel(db_session, uid, "spark")).match

    # rival wins first 3 (lead 3-0 → max_rival_lead 3 >= 2), then user wins 4 → comeback.
    script = [
        (False, True),
        (False, True),
        (False, True),
        (True, False),
        (True, False),
        (True, False),
        (True, False),
    ]
    full = [{"correct": r, "time_frac": 0.5} for (_, r) in script] + [
        {"correct": False, "time_frac": 0.5}
    ] * 3
    await _script_rival(db_session, match, full)

    rev = None
    for idx, (u, _r) in enumerate(script):
        rev = await _submit(db_session, uid, match, idx, correct=u)
    assert rev is not None and rev.finished is True
    assert rev.result.winner == "user"
    assert rev.result.comeback is True
    stats = await db_session.get(DuelUserStats, uid)
    assert stats.comeback_wins == 1


async def test_finalize_idempotent_no_double_submit(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session, gems=5)
    match = (await create_duel(db_session, uid, "spark")).match
    await _script_rival(db_session, match, [{"correct": False, "time_frac": 0.5}] * 10)

    for idx in range(4):
        await _submit(db_session, uid, match, idx, correct=True)

    # pool credited exactly once.
    n_win = await db_session.scalar(
        select(func.count())
        .select_from(GemLedger)
        .where(GemLedger.idempotency_key == f"duel:{match.id}:win")
    )
    assert n_win == 1
    with pytest.raises(DuelStateError):
        await _submit(db_session, uid, match, 4, correct=True)


# ---------------- expiry cleanup ----------------
async def test_cleanup_expired_duels(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session, gems=5)
    now = datetime.now(UTC)
    match = (await create_duel(db_session, uid, "spark", now=now)).match
    # force expiry into the past.
    match.expires_at = now - timedelta(minutes=5)
    await db_session.flush()

    # a separate, fresh (non-expired) match must be untouched.
    fresh = (await create_duel(db_session, uid, "training", now=now)).match

    n = await cleanup_expired_duels(db_session, now=now)
    assert n == 1

    await db_session.refresh(match)
    assert match.status == "abandoned"
    assert match.winner == "rival"
    assert match.result_reason == "abandoned"
    assert match.gem_delta == -1

    stats = await db_session.get(DuelUserStats, uid)
    assert stats.losses == 1
    # no pool refund row.
    n_refund = await db_session.scalar(
        select(func.count())
        .select_from(GemLedger)
        .where(GemLedger.user_id == uid, GemLedger.reason == "duel_pool_win")
    )
    assert n_refund == 0

    await db_session.refresh(fresh)
    assert fresh.status == "in_progress"


# ---------------- guards ----------------
async def test_wrong_idx_sequence_error(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session)
    match = (await create_duel(db_session, uid, "training")).match
    await _script_rival(db_session, match, [{"correct": False, "time_frac": 0.5}] * 10)

    with pytest.raises(DuelRoundSequenceError):
        await submit_duel_round(db_session, uid, match.id, 3, {"choice": 0, "elapsed_ms": 1000})


async def test_other_users_match_not_found(db_session: AsyncSession):
    await load_trivia(db_session)
    owner = await _user(db_session)
    intruder = await _user(db_session)
    match = (await create_duel(db_session, owner, "training")).match

    with pytest.raises(DuelNotFoundError):
        await submit_duel_round(
            db_session, intruder, match.id, 0, {"choice": 0, "elapsed_ms": 1000}
        )


async def test_unknown_match_not_found(db_session: AsyncSession):
    uid = await _user(db_session)
    with pytest.raises(DuelNotFoundError):
        await submit_duel_round(db_session, uid, uuid.uuid4(), 0, {"choice": 0, "elapsed_ms": 1000})


async def test_duel_entry_rejected_on_practice_paths(db_session: AsyncSession):
    await load_trivia(db_session)
    uid = await _user(db_session)
    match = (await create_duel(db_session, uid, "training")).match

    with pytest.raises(EntryNotFoundError):
        await answer_practice_round(
            db_session, match.entry_id, uid, 0, {"choice": 0, "elapsed_ms": 1000}
        )
    with pytest.raises(EntryNotFoundError):
        await submit_practice(db_session, match.entry_id, uid, {0: {"choice": 0}})


# ---------------- taste-profile integration ----------------
async def test_duel_round_feeds_brain_model(db_session: AsyncSession) -> None:
    from app.models import QuestionInteractionEvent
    from sqlalchemy import select

    await load_trivia(db_session)
    uid = await _user(db_session, gems=100)
    match = (await create_duel(db_session, uid, "training")).match
    await _script_rival(db_session, match, [{"correct": False, "time_frac": 0.5}] * 10)
    idx0 = await _correct_index(db_session, match, 0)

    await submit_duel_round(db_session, uid, match.id, 0, {"choice": idx0, "elapsed_ms": 1000})

    events = (
        (
            await db_session.execute(
                select(QuestionInteractionEvent).where(QuestionInteractionEvent.user_id == uid)
            )
        )
        .scalars()
        .all()
    )
    assert len(events) == 1
    assert events[0].mode == "duel"
    assert events[0].is_correct is True
