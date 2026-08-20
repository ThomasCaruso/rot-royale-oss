"""Practice Mode service (M8): no-stakes sessions that reuse the contest round/scoring path.

A practice session is a 5-round mixed set (the PRACTICE template). It is server-authoritative — the
SAME generate()/score() path as contests, the same client_spec/server_answer split, the same
plausibility validation for memory_flash. It writes NO coins and NO rating, and gives no
contest advantage (nothing in scoring/settlement/rating reads `sharpness`). Completion only nudges
the personal `sharpness` progress stat, capped at SHARPNESS_MAX. Practice entries carry
`window_id = NULL` + `is_practice = True`, so every window-keyed contest query excludes them.
"""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from random import Random
from typing import Any

from content.loader import fetch_bank
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import SHARPNESS_MAX, SHARPNESS_PER_SESSION
from app.models import Entry, Profile, Question, RoundAnswer, RoundResult
from app.models.contest import IN_PROGRESS, SUBMITTED
from app.models.duel import DuelMatch
from app.modules.base import GenerationContext
from app.modules.registry import get_module
from app.services.contest import (
    CategoryUnavailableError,
    EntryNotFoundError,
    EntryNotSubmittableError,
    RoundSequenceError,
)
from app.services.engine import build_round_set
from app.services.personalization import personalize_bank
from app.services.scoring import ScoredRound, compute_points, score_entry
from app.services.taste_profile import question_id_from_server_answer, record_answer_signal
from app.services.templates import CATEGORY_SESSION, PRACTICE, QUICK_PLAY, STARTER_CHECK


@dataclass
class PracticeResult:
    entry: Entry
    rounds: list[ScoredRound]
    correct: int
    total: int
    accuracy: float  # 0..1
    sharpness_before: int
    sharpness_after: int
    sharpness_gained: int


@dataclass
class PracticeAnswerOutcome:
    """One practice round's lesson-mode reveal (post-lock): correct answer + explanation."""

    idx: int
    module_type: str
    correct: bool
    valid: bool
    server_answer: dict[str, Any]  # the correct answer, surfaced now (no-stakes → safe post-lock)
    explanation: str | None  # the "here's why" payload (trivia bank questions); None for generated
    finished: bool
    # Populated only on the final round (entry finalizes here):
    correct_count: int | None = None
    total: int | None = None
    accuracy: float | None = None
    sharpness_after: int | None = None
    sharpness_gained: int | None = None


async def _reject_if_duel_entry(session: AsyncSession, entry_id: uuid.UUID) -> None:
    """A duel's play Entry is also is_practice=True — it is adjudicated via /duel/*, never
    /practice/* (defense-in-depth; entry_id is server-internal). Campaign entries use this path."""
    if await session.scalar(select(DuelMatch.id).where(DuelMatch.entry_id == entry_id)) is not None:
        raise EntryNotFoundError()


async def _update_sharpness(
    session: AsyncSession, user_id: uuid.UUID, accuracy: float
) -> tuple[int, int, int]:
    """Apply the session's sharpness gain. Returns (before, after, gained). The ONE place the
    sharpness formula lives, so the batch (submit) and per-round (answer) paths never diverge."""
    profile = await session.get(Profile, user_id, with_for_update=True)  # lock like the ledger
    if profile is None:
        raise EntryNotFoundError()
    before = profile.sharpness
    after = min(SHARPNESS_MAX, before + round(accuracy * SHARPNESS_PER_SESSION))
    profile.sharpness = after
    return before, after, after - before


async def _explanation_for(session: AsyncSession, server_answer: dict[str, Any]) -> str | None:
    """The bank explanation for a trivia round (looked up by question_id at reveal time). Kept OUT
    of the shared server_answer on purpose, so the ranked contest's reveal payload is unchanged."""
    qid = server_answer.get("question_id")
    if not qid:
        return None
    return await session.scalar(select(Question.explanation).where(Question.id == uuid.UUID(qid)))


def _calibration_bank(
    bank: list[dict[str, Any]], seed: int, per_category: int = 6
) -> list[dict[str, Any]]:
    """Category-balanced subset for the Starter Check: up to `per_category` seeded picks from each
    category, so a brand-new player's 8 draws spread across the bank's breadth (the first Brain
    Profile read needs cross-category signal, not 8 questions about one topic). Pure function of
    (bank, seed) — the entry stays regenerable from its stored seed."""
    rng = Random(f"starter:{seed}")
    by_category: dict[str, list[dict[str, Any]]] = {}
    for q in bank:
        by_category.setdefault(q["category"], []).append(q)
    picked: list[dict[str, Any]] = []
    for category in sorted(by_category):  # sorted → independent of dict/bank grouping order
        pool = list(by_category[category])
        rng.shuffle(pool)
        picked.extend(pool[:per_category])
    return picked or bank


async def start_practice(
    session: AsyncSession,
    user_id: uuid.UUID,
    category: str | None = None,
    mode: str | None = None,
    now: datetime | None = None,
    locale: str = "en",
) -> Entry:
    """Create a practice entry (window-less, flagged) with a fresh seeded round set.

    mode="quick" → Quick Play, the 8-question mixed-category trivia run (QUICK_PLAY) — the Daily
    Royale's shape with no stakes; always the full mixed bank (`category` is ignored). Otherwise:
    no category → the 5-round mixed PRACTICE template across all categories (unchanged). A category
    → a category-scoped 10-question trivia session (CATEGORY_SESSION) drawn from that category's
    servable bank with a difficulty mix. An empty/all-draft category raises CategoryUnavailable.
    """
    now = now or datetime.now(UTC)
    seed = secrets.randbits(63)
    if mode == "starter":
        # Starter Check (Brain Boost onboarding): first-ever calibration run — gentle difficulty
        # ramp over a category-balanced bank. Cold-start users make personalize_bank a no-op,
        # but the calibration bank is the point: breadth for the first Brain Profile read.
        template = STARTER_CHECK
        bank = _calibration_bank(await fetch_bank(session, "trivia", locale=locale), seed)
        personalize_mode = "starter"
    elif mode == "quick":
        template = QUICK_PLAY
        bank = await fetch_bank(session, "trivia", locale=locale)
        personalize_mode = "quick"
    elif category is None:
        template = PRACTICE
        bank = await fetch_bank(session, "trivia", locale=locale)
        personalize_mode = "practice"
    else:
        template = CATEGORY_SESSION
        bank = await fetch_bank(session, "trivia", category=category, locale=locale)
        if not bank:
            raise CategoryUnavailableError(category)
        personalize_mode = "category"
    # No-stakes modes may draw from a taste-profile-trimmed pool (no-op for cold-start users;
    # the engine never learns about personalization — same pre-filter seam as category scoping).
    bank = await personalize_bank(session, user_id, bank, mode=personalize_mode, seed=seed)
    ctx = GenerationContext(bank=bank, seed=seed)
    rounds = build_round_set(seed, template, ctx)

    entry = Entry(
        window_id=None,
        user_id=user_id,
        is_practice=True,
        seed=seed,
        round_set=[
            {"idx": r.idx, "type": r.module_type, "client_spec": r.client_spec} for r in rounds
        ],
        mode=personalize_mode,
        started_at=now,
        status=IN_PROGRESS,
    )
    session.add(entry)
    await session.flush()  # assign entry.id

    for r in rounds:
        session.add(
            RoundAnswer(
                entry_id=entry.id,
                idx=r.idx,
                module_type=r.module_type,
                server_answer=r.server_answer,
            )
        )
    await session.flush()
    return entry


async def submit_practice(
    session: AsyncSession,
    entry_id: uuid.UUID,
    user_id: uuid.UUID,
    submissions_by_idx: dict[int, dict[str, Any]],
    now: datetime | None = None,
) -> PracticeResult:
    """Server-score a practice session and update sharpness. Never touches coins/rating."""
    now = now or datetime.now(UTC)

    entry = await session.get(Entry, entry_id)
    # Only this user's PRACTICE entries are submittable here (a contest entry → 404, keeping the
    # paths disjoint). This is the play service, not the engine/scheduler/settlement.
    if entry is None or entry.user_id != user_id or not entry.is_practice:
        raise EntryNotFoundError()
    if entry.status != IN_PROGRESS:
        raise EntryNotSubmittableError()
    await _reject_if_duel_entry(session, entry_id)

    answer_rows = (
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
    answers = [(a.idx, a.module_type, a.server_answer) for a in answer_rows]
    # Identical scoring path as contests — incl. memory_flash plausibility checks.
    results, total_points = score_entry(answers, submissions_by_idx)

    total = len(results)
    correct = sum(1 for r in results if r.correct and r.valid)  # same "counts" rule as scoring
    accuracy = correct / total if total else 0.0
    before, after, _gained = await _update_sharpness(session, user_id, accuracy)

    entry.total_score = total_points  # recorded for completeness; never surfaced in standings
    entry.submitted_at = now
    entry.status = SUBMITTED
    await session.flush()

    return PracticeResult(
        entry=entry,
        rounds=results,
        correct=correct,
        total=total,
        accuracy=accuracy,
        sharpness_before=before,
        sharpness_after=after,
        sharpness_gained=after - before,
    )


async def answer_practice_round(
    session: AsyncSession,
    entry_id: uuid.UUID,
    user_id: uuid.UUID,
    idx: int,
    result: dict[str, Any],
    now: datetime | None = None,
) -> PracticeAnswerOutcome:
    """Lesson-mode per-round answer (practice only). Scores ONE round, stores its result, and shows
    the correct answer + explanation so the player learns before continuing at their own pace.

    Strictly sequential like the contest's per-round rhythm (same compute_points/streak via the
    canonical scoring, so it matches batch submit_practice), but with NO window/time checks and no
    auto-advance — practice is self-paced. The last round finalizes the entry (SUBMITTED) and
    applies the sharpness gain via the shared `_update_sharpness`. Does not commit.
    """
    now = now or datetime.now(UTC)

    entry = await session.get(Entry, entry_id)
    # Only this user's PRACTICE entries answer here — a contest entry → 404 (paths stay disjoint).
    if entry is None or entry.user_id != user_id or not entry.is_practice:
        raise EntryNotFoundError()
    if entry.status != IN_PROGRESS:
        raise EntryNotSubmittableError()
    await _reject_if_duel_entry(session, entry_id)

    num_rounds = len(entry.round_set)
    prior = (
        (
            await session.execute(
                select(RoundResult)
                .where(RoundResult.entry_id == entry_id)
                .order_by(RoundResult.idx)
            )
        )
        .scalars()
        .all()
    )
    # one answer per round, in order: idx must be exactly the next unanswered round.
    if idx != len(prior) or idx >= num_rounds:
        raise RoundSequenceError()

    answer = await session.get(RoundAnswer, (entry_id, idx))
    if answer is None:
        raise RoundSequenceError()

    judgement = get_module(answer.module_type).score(answer.server_answer, result)
    counts = judgement.correct and judgement.valid

    # streak = trailing consecutive (correct & valid) ending at this round — matches score_entry.
    streak_prev = 0
    for r in reversed(prior):
        if r.correct and r.valid:
            streak_prev += 1
        else:
            break
    points = compute_points(True, judgement.time_frac, streak_prev + 1) if counts else 0

    session.add(
        RoundResult(
            entry_id=entry_id,
            idx=idx,
            module_type=answer.module_type,
            points=points,
            correct=judgement.correct,
            time_frac=judgement.time_frac,
            valid=judgement.valid,
            flags=judgement.flags,
        )
    )

    await record_answer_signal(
        session,
        user_id,
        question_id=question_id_from_server_answer(answer.server_answer),
        mode="practice",
        is_correct=bool(counts),
        time_frac=judgement.time_frac,
        limit_ms=get_module(answer.module_type).time_limit_ms,
        streak_before=streak_prev,
        streak_after=streak_prev + 1 if counts else 0,
        session_id=entry_id,
        difficulty=answer.server_answer.get("difficulty"),
    )

    outcome = PracticeAnswerOutcome(
        idx=idx,
        module_type=answer.module_type,
        correct=judgement.correct,
        valid=judgement.valid,
        server_answer=answer.server_answer,
        explanation=await _explanation_for(session, answer.server_answer),
        finished=idx == num_rounds - 1,
    )

    if outcome.finished:
        correct_count = sum(1 for r in prior if r.correct and r.valid) + (1 if counts else 0)
        accuracy = correct_count / num_rounds if num_rounds else 0.0
        entry.total_score = sum(int(r.points) for r in prior) + points
        entry.submitted_at = now
        entry.status = SUBMITTED
        _before, after, gained = await _update_sharpness(session, user_id, accuracy)
        outcome.correct_count = correct_count
        outcome.total = num_rounds
        outcome.accuracy = accuracy
        outcome.sharpness_after = after
        outcome.sharpness_gained = gained

    await session.flush()
    return outcome
