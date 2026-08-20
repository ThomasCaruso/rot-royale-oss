"""User taste profile updates — "gameplay categorizes the user".

Bounded, clamped increments only: one question can nudge a preference, never define it. The
profile is personalization-only state — nothing here reads or writes scores/coins/rating.

Signal model (spec-locked):
- fast correct +0.06 · normal correct +0.04 · slow correct +0.02
- fast wrong +0.015 (interest without mastery)
- wrong + explanation engaged +0.03 · wrong + quit −0.06 · timeout −0.03
- share/replay +0.05 · explanation read >3s +0.025 extra
Affinities live in [-1, 1]. Difficulty/humor/brainrot/educational prefs live in [0, 1] and move
by small EMA steps toward the engaged question's scores. `confidence_score = min(1, n/50)` —
the RANKING side uses it to phase personalization in gently; updates here are full strength.

JSONB rule: dict/list columns are REASSIGNED, never mutated in place (change tracking).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.timezone import ET as _GROWTH_ET
from app.models import (
    Entry,
    Question,
    QuestionAIMetadata,
    QuestionInteractionEvent,
    RoundAnswer,
    UserTasteProfile,
)
from app.modules.trivia import TRIVIA_TIME_LIMIT_MS
from app.schemas.personalization import QuestionInteractionEventIn

logger = logging.getLogger(__name__)

# Response-speed bands as fractions of the (flat 10s) trivia timer.
FAST_FRACTION = 0.4
SLOW_FRACTION = 0.8

# Signal sizes.
SIG_FAST_CORRECT = 0.06
SIG_CORRECT = 0.04
SIG_SLOW_CORRECT = 0.02
SIG_FAST_WRONG = 0.015
SIG_WRONG_ENGAGED = 0.03
SIG_WRONG_QUIT = -0.06
SIG_TIMEOUT = -0.03
SIG_SHARE_REPLAY = 0.05
SIG_EXPLANATION_READ = 0.025

EXPLANATION_READ_MS = 3000  # "actually read it" threshold
DIFFICULTY_STEP = 0.02
PREF_EMA_STEP = 0.1
BRAINROT_QUIT_PENALTY = 0.05
HIGH_BRAINROT = 0.6

AFFINITY_MIN, AFFINITY_MAX = -1.0, 1.0
DISLIKE_THRESHOLD = -0.15
CONFIDENCE_FULL_AT = 50

MAX_DISLIKED = 20
MAX_WEAK = 20
MAX_LAST_TOPICS = 30
MAX_LAST_CATEGORIES = 10


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _speed(event: QuestionInteractionEvent) -> str:
    """ "fast" | "normal" | "slow" from response_ms vs the server's flat trivia timer."""
    if event.response_ms is None:
        return "normal"
    frac = event.response_ms / TRIVIA_TIME_LIMIT_MS
    if frac < FAST_FRACTION:
        return "fast"
    if frac > SLOW_FRACTION:
        return "slow"
    return "normal"


def _explanation_engaged(event: QuestionInteractionEvent) -> bool:
    return event.explanation_opened or (event.explanation_read_ms or 0) >= EXPLANATION_READ_MS


def interest_signal(event: QuestionInteractionEvent) -> float:
    """The per-event interest delta applied to category/subcategory/topic affinities."""
    if event.timed_out:
        signal = SIG_TIMEOUT + (SIG_WRONG_QUIT if event.quit_after else 0.0)
    elif event.is_correct:
        speed = _speed(event)
        signal = {"fast": SIG_FAST_CORRECT, "slow": SIG_SLOW_CORRECT}.get(speed, SIG_CORRECT)
    elif event.is_correct is False:
        if event.quit_after:
            signal = SIG_WRONG_QUIT
        elif _explanation_engaged(event):
            signal = SIG_WRONG_ENGAGED
        elif _speed(event) == "fast":
            signal = SIG_FAST_WRONG  # answered quickly/curiously: interest, not mastery
        else:
            signal = 0.0
    else:
        signal = 0.0  # correctness unknown (e.g. pure engagement ping)

    if event.shared_after or event.replayed_after:
        signal += SIG_SHARE_REPLAY
    if (event.explanation_read_ms or 0) > EXPLANATION_READ_MS:
        signal += SIG_EXPLANATION_READ
    return signal


def _bump(affinity: dict[str, float], key: str, delta: float) -> dict[str, float]:
    out = dict(affinity)
    out[key] = round(_clamp(out.get(key, 0.0) + delta, AFFINITY_MIN, AFFINITY_MAX), 4)
    return out


def _rolling(seen: list[str], new: list[str], cap: int) -> list[str]:
    """Most-recent-first rolling list, deduped, capped."""
    out = list(new)
    for item in seen:
        if item not in out:
            out.append(item)
    return out[:cap]


async def get_or_create_profile(session: AsyncSession, user_id: uuid.UUID) -> UserTasteProfile:
    profile = await session.get(UserTasteProfile, user_id)
    if profile is None:
        profile = UserTasteProfile(
            user_id=user_id,
            category_affinity={},
            subcategory_affinity={},
            topic_affinity={},
            disliked_topics=[],
            weak_but_interesting_topics=[],
            last_seen_topic_tags=[],
            last_seen_categories=[],
        )
        session.add(profile)
        await session.flush()
    return profile


async def update_profile_from_event(
    session: AsyncSession,
    user_id: uuid.UUID,
    event: QuestionInteractionEvent,
    count_interaction: bool = True,
) -> UserTasteProfile:
    """Apply one interaction to the user's taste profile. Does not commit."""
    profile = await get_or_create_profile(session, user_id)

    meta: QuestionAIMetadata | None = None
    question: Question | None = None
    if event.question_id is not None:
        meta = await session.scalar(
            select(QuestionAIMetadata).where(QuestionAIMetadata.question_id == event.question_id)
        )
        question = await session.get(Question, event.question_id)

    category = meta.category if meta is not None else (question.category if question else None)
    subcategory = meta.subcategory if meta is not None else None
    topics: list[str] = list(meta.topic_tags) if meta is not None else []

    signal = interest_signal(event)

    if category:
        profile.category_affinity = _bump(profile.category_affinity, category, signal)
    if subcategory:
        profile.subcategory_affinity = _bump(profile.subcategory_affinity, subcategory, signal)
    topic_affinity = dict(profile.topic_affinity)
    for topic in topics:
        topic_affinity[topic] = round(
            _clamp(topic_affinity.get(topic, 0.0) + signal, AFFINITY_MIN, AFFINITY_MAX), 4
        )
    profile.topic_affinity = topic_affinity

    # Preferred difficulty drifts up on fast-correct, down on miss/timeout — never by one jump.
    if event.is_correct and _speed(event) == "fast":
        profile.difficulty_preference = _clamp(
            profile.difficulty_preference + DIFFICULTY_STEP, 0.0, 1.0
        )
    elif event.timed_out or event.is_correct is False:
        profile.difficulty_preference = _clamp(
            profile.difficulty_preference - DIFFICULTY_STEP, 0.0, 1.0
        )

    # Humor/brainrot/educational drift toward what the user ENGAGES with (positive signal only);
    # quitting on high-brainrot content lowers tolerance.
    if meta is not None:
        if signal > 0:
            profile.humor_preference = _clamp(
                profile.humor_preference
                + PREF_EMA_STEP * (meta.humor_score - profile.humor_preference),
                0.0,
                1.0,
            )
            profile.brainrot_tolerance = _clamp(
                profile.brainrot_tolerance
                + PREF_EMA_STEP * (meta.brainrot_score - profile.brainrot_tolerance),
                0.0,
                1.0,
            )
            profile.educational_preference = _clamp(
                profile.educational_preference
                + PREF_EMA_STEP * (meta.educational_score - profile.educational_preference),
                0.0,
                1.0,
            )
        if event.quit_after and meta.brainrot_score >= HIGH_BRAINROT:
            profile.brainrot_tolerance = _clamp(
                profile.brainrot_tolerance - BRAINROT_QUIT_PENALTY, 0.0, 1.0
            )
        if (event.explanation_read_ms or 0) > EXPLANATION_READ_MS:
            profile.educational_preference = _clamp(
                profile.educational_preference + SIG_EXPLANATION_READ, 0.0, 1.0
            )

    # Weak-but-interesting: got it wrong, but leaned in (opened/read the explanation, kept playing).
    weak = list(profile.weak_but_interesting_topics)
    if event.is_correct is False and not event.quit_after and _explanation_engaged(event):
        for topic in topics:
            if topic not in weak:
                weak.append(topic)
    if event.is_correct and _speed(event) == "fast":
        weak = [t for t in weak if t not in topics]  # mastered it — no longer "weak"
    profile.weak_but_interesting_topics = weak[:MAX_WEAK]

    # Disliked: topics whose accumulated affinity sank below threshold; recovery removes them.
    disliked = [t for t in profile.disliked_topics if profile.topic_affinity.get(t, 0.0) < 0.0]
    for topic in topics:
        if profile.topic_affinity.get(topic, 0.0) <= DISLIKE_THRESHOLD and topic not in disliked:
            disliked.append(topic)
    profile.disliked_topics = disliked[:MAX_DISLIKED]

    # Recency rings (used by ranking's novelty/repeat penalties).
    profile.last_seen_topic_tags = _rolling(profile.last_seen_topic_tags, topics, MAX_LAST_TOPICS)
    if category:
        profile.last_seen_categories = _rolling(
            profile.last_seen_categories, [category], MAX_LAST_CATEGORIES
        )

    if count_interaction:
        profile.interaction_count += 1
        profile.confidence_score = round(
            min(1.0, profile.interaction_count / CONFIDENCE_FULL_AT), 4
        )

    await session.flush()
    return profile


async def _resolve_question_id(
    session: AsyncSession, user_id: uuid.UUID, data: QuestionInteractionEventIn
) -> uuid.UUID | None:
    """Server-side question link: prefer (entry_id, idx) → round_answers.server_answer, since the
    client never needs to know bank ids. A client-sent question_id is accepted only if the
    question actually exists (the FK would otherwise abort the whole request transaction)."""
    if data.entry_id is not None and data.idx is not None:
        entry = await session.get(Entry, data.entry_id)
        if entry is not None and entry.user_id == user_id:
            answer = await session.get(RoundAnswer, (data.entry_id, data.idx))
            qid = answer.server_answer.get("question_id") if answer is not None else None
            if qid:
                try:
                    return uuid.UUID(str(qid))
                except ValueError:
                    return None
        return None
    if data.question_id is not None:
        exists = await session.scalar(select(Question.id).where(Question.id == data.question_id))
        return exists
    return None


def question_id_from_server_answer(server_answer: dict[str, Any]) -> uuid.UUID | None:
    """Pull the bank question id out of a stored server_answer (trivia carries it; generated
    modules like rapid_math/memory_flash do not). Returns None on absence or a malformed value."""
    raw = server_answer.get("question_id") if server_answer else None
    if not raw:
        return None
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError, TypeError):
        return None


async def record_answer_signal(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    question_id: uuid.UUID | None,
    mode: str,
    is_correct: bool,
    time_frac: float,
    limit_ms: int,
    streak_before: int | None = None,
    streak_after: int | None = None,
    session_id: uuid.UUID | None = None,
    difficulty: str | None = None,
) -> None:
    """Server-authoritative capture of one scored answer, fired from a mode's per-round scoring
    chokepoint. Speed is derived from the SERVER's time_frac (never client-reported). Best-effort:
    a failure here must never sink the surrounding score write. Does not commit (flush only).

    Gated on settings.personalization_enabled — with it off, nothing is recorded.
    """
    if not settings.personalization_enabled:
        return
    try:
        response_ms = max(0, round(limit_ms * (1.0 - time_frac)))
        event = QuestionInteractionEvent(
            user_id=user_id,
            question_id=question_id,
            mode=mode[:16],
            session_id=session_id,
            is_correct=is_correct,
            response_ms=response_ms,
            timed_out=False,
            streak_before=streak_before,
            streak_after=streak_after,
        )
        session.add(event)
        await session.flush()
        await update_profile_from_event(session, user_id, event, count_interaction=True)
        if settings.growth_tracking_enabled:
            from app.services import growth  # local import avoids any import-order coupling

            category = await growth.resolve_category(session, question_id)
            await growth.update_daily_stats(
                session,
                user_id,
                stat_date=datetime.now(_GROWTH_ET).date(),
                is_correct=is_correct,
                time_frac=time_frac,
                streak_after=streak_after,
                difficulty=difficulty,
                category=category,
            )
    except Exception:  # noqa: BLE001 — capture must never fail a score write
        logger.exception("answer-signal capture failed for user %s (mode=%s)", user_id, mode)

    # Adaptive-learning skill model (Phase 1): silent capture, best-effort — a failure here must
    # never sink the surrounding score write (same contract as the taste-profile update above).
    if settings.adaptive_learning_enabled:
        try:
            from app.services.skill_state import apply_answer_to_skill_state

            await apply_answer_to_skill_state(session, user_id, question_id, bool(is_correct))
        except Exception:  # noqa: BLE001 - signal capture is best-effort, never fatal
            logger.warning("skill-state update failed", exc_info=True)


async def record_interaction(
    session: AsyncSession, user_id: uuid.UUID, data: QuestionInteractionEventIn
) -> QuestionInteractionEvent:
    """Store one interaction event and (when enabled) fold it into the taste profile.

    The profile update is best-effort: a bug there must never fail the event write — and the
    whole endpoint is fire-and-forget on the client, so gameplay never blocks on any of this.
    """
    event = QuestionInteractionEvent(
        user_id=user_id,
        question_id=await _resolve_question_id(session, user_id, data),
        mode=data.mode,
        session_id=data.session_id,
        selected_answer=data.selected_answer,
        is_correct=data.is_correct,
        response_ms=data.response_ms,
        timed_out=data.timed_out,
        quit_after=data.quit_after,
        explanation_opened=data.explanation_opened,
        explanation_read_ms=data.explanation_read_ms,
        shared_after=data.shared_after,
        replayed_after=data.replayed_after,
        streak_before=data.streak_before,
        streak_after=data.streak_after,
    )
    session.add(event)
    await session.flush()

    if settings.personalization_enabled:
        try:
            await update_profile_from_event(session, user_id, event, count_interaction=False)
        except Exception:  # noqa: BLE001 — profile update must never sink the event write
            logger.exception("taste profile update failed for user %s", user_id)
    return event
