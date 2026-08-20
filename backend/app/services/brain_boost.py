"""Brain Boost summary — the Brain Profile read after a check (Starter Check or daily Brain Boost).

Computes, from ALREADY-STORED gameplay rows (round_results + round_answers + questions — never an
LLM call, never a new gameplay write):
- per-category performance (correct/total/accuracy/avg time_frac)
- strengths (top categories) and weak spots (bottom categories)
- a Rot Type (fun label, deterministic from the category mix — a nickname, not a grade)
- a Brain Score clamped to 300..900 (correctness + speed + streak + difficulty spice)
- movement vs the player's PREVIOUS check, so the reveal can say "Money +4 · Science −1"
- an optional weak-spot topic from AI metadata of missed questions (null when unclassified —
  the whole summary works without the classifier having run)

A "check" = a practice entry with mode in ("quick", "starter"), the Brain Boost ritual shapes.
"""

from __future__ import annotations

import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import ET
from app.models import Entry, Question, QuestionAIMetadata, RoundAnswer, RoundResult
from app.models.contest import SUBMITTED
from app.services.brain_score import SCORE_MAX, SCORE_MIN, brain_score  # noqa: F401 — re-exported

CHECK_MODES = ("quick", "starter")

# Rot Type: a deterministic nickname from the player's TOP category (flavor, not a grade).
_ROT_TYPE_BY_CATEGORY = {
    "Money & Business": "Market Menace",
    "Sports": "Sports Demon",
    "History": "History Menace",
    "Geography": "Geography Ghost",
    "Science & Nature": "Space Goblin",
    "Arts & Literature": "Culture Killer",
    "Pop Culture & Entertainment": "Meme Scholar",
}
_ROT_TYPE_FALLBACK = "Internet Scholar"
_ROT_TYPE_ROOKIE = "Money Rookie"  # very low first read — room to grow
_ROOKIE_ACCURACY = 0.375


@dataclass
class CategoryPerf:
    category: str
    correct: int
    total: int
    accuracy: float  # 0..1
    avg_time_frac: float  # 0..1, higher = faster


@dataclass
class BrainBoostSummary:
    entry_id: uuid.UUID
    mode: str
    submitted_at: datetime
    total: int
    correct: int
    accuracy: float
    brain_score: int
    rot_type: str
    strengths: list[CategoryPerf]  # top ≤3, best first
    weaknesses: list[CategoryPerf]  # bottom ≤2, weakest first
    categories: list[CategoryPerf]  # all, best first
    weak_spot_topic: str | None  # from AI metadata of missed questions; None when unclassified
    movements: dict[str, int] = field(default_factory=dict)  # category → delta (±, small ints)
    first_check: bool = True


class CheckNotFoundError(Exception):
    pass


def rot_type_for(categories: list[CategoryPerf], accuracy: float) -> str:
    if accuracy < _ROOKIE_ACCURACY:
        return _ROT_TYPE_ROOKIE
    if not categories:
        return _ROT_TYPE_FALLBACK
    return _ROT_TYPE_BY_CATEGORY.get(categories[0].category, _ROT_TYPE_FALLBACK)


async def _perf_rows(
    session: AsyncSession, entry_id: uuid.UUID
) -> list[tuple[RoundResult, RoundAnswer, str | None]]:
    """(result, answer, category) per round — category resolved via the stored question_id."""
    rows = (
        (
            await session.execute(
                select(RoundResult, RoundAnswer)
                .join(
                    RoundAnswer,
                    (RoundAnswer.entry_id == RoundResult.entry_id)
                    & (RoundAnswer.idx == RoundResult.idx),
                )
                .where(RoundResult.entry_id == entry_id)
                .order_by(RoundResult.idx)
            )
        )
        .tuples()
        .all()
    )
    qids: set[uuid.UUID] = set()
    for _res, ans in rows:
        qid = ans.server_answer.get("question_id")
        if qid:
            qids.add(uuid.UUID(str(qid)))
    category_by_qid: dict[uuid.UUID, str] = {}
    if qids:
        for q_id, cat in (
            await session.execute(
                select(Question.id, Question.category).where(Question.id.in_(qids))
            )
        ).all():
            category_by_qid[q_id] = cat
    out: list[tuple[RoundResult, RoundAnswer, str | None]] = []
    for res, ans in rows:
        qid = ans.server_answer.get("question_id")
        category = category_by_qid.get(uuid.UUID(str(qid))) if qid else None
        out.append((res, ans, category))
    return out


def _category_perf(
    rows: list[tuple[RoundResult, RoundAnswer, str | None]],
) -> list[CategoryPerf]:
    stats: dict[str, list[tuple[bool, float]]] = {}
    for res, _ans, category in rows:
        if category is None:
            continue
        stats.setdefault(category, []).append(
            (bool(res.correct and res.valid), float(res.time_frac))
        )
    perfs = [
        CategoryPerf(
            category=category,
            correct=sum(1 for c, _ in outcomes if c),
            total=len(outcomes),
            accuracy=sum(1 for c, _ in outcomes if c) / len(outcomes),
            avg_time_frac=sum(t for _, t in outcomes) / len(outcomes),
        )
        for category, outcomes in stats.items()
    ]
    # Best first: accuracy, then speed, then name for a stable order.
    perfs.sort(key=lambda p: (-p.accuracy, -p.avg_time_frac, p.category))
    return perfs


async def _weak_spot_topic(
    session: AsyncSession, rows: list[tuple[RoundResult, RoundAnswer, str | None]]
) -> str | None:
    """Most common AI-metadata topic among MISSED questions. None when nothing is classified —
    the reveal degrades gracefully to category-level language."""
    missed_qids: list[uuid.UUID] = []
    for res, ans, _cat in rows:
        qid = ans.server_answer.get("question_id")
        if qid and not (res.correct and res.valid):
            missed_qids.append(uuid.UUID(str(qid)))
    if not missed_qids:
        return None
    metas = (
        (
            await session.execute(
                select(QuestionAIMetadata.topic_tags).where(
                    QuestionAIMetadata.question_id.in_(missed_qids)
                )
            )
        )
        .scalars()
        .all()
    )
    counts: Counter[str] = Counter(t for tags in metas for t in tags)
    if not counts:
        return None
    topic, _n = counts.most_common(1)[0]
    return topic.title()


async def summarize_check(session: AsyncSession, entry: Entry) -> BrainBoostSummary:
    """Build the Brain Profile read for one submitted check entry. Pure read — no writes."""
    rows = await _perf_rows(session, entry.id)
    total = len(rows)
    correct = sum(1 for res, _a, _c in rows if res.correct and res.valid)
    accuracy = correct / total if total else 0.0
    avg_time_frac = sum(float(r.time_frac) for r, _a, _c in rows) / total if total else 0.0

    best_streak = streak = 0
    hard_correct = 0
    for res, ans, _cat in rows:
        if res.correct and res.valid:
            streak += 1
            best_streak = max(best_streak, streak)
            if ans.server_answer.get("difficulty") == "hard":
                hard_correct += 1
        else:
            streak = 0

    categories = _category_perf(rows)
    answered = [p for p in categories if p.total > 0]

    summary = BrainBoostSummary(
        entry_id=entry.id,
        mode=entry.mode or "quick",
        submitted_at=entry.submitted_at or datetime.now(UTC),
        total=total,
        correct=correct,
        accuracy=accuracy,
        brain_score=brain_score(
            accuracy=accuracy,
            avg_time_frac=avg_time_frac,
            best_streak=best_streak,
            hard_correct=hard_correct,
        ),
        rot_type=rot_type_for(answered, accuracy),
        strengths=answered[:3],
        weaknesses=list(reversed(answered[-2:])) if len(answered) > 1 else [],
        categories=categories,
        weak_spot_topic=await _weak_spot_topic(session, rows),
    )

    previous = await _previous_check(session, entry)
    if previous is not None:
        prev_summary_categories = _category_perf(await _perf_rows(session, previous.id))
        prev_by_name = {p.category: p for p in prev_summary_categories}
        movements: dict[str, int] = {}
        for perf in categories:
            prev = prev_by_name.get(perf.category)
            if prev is not None:
                delta = round((perf.accuracy - prev.accuracy) * 10)
                if delta != 0:
                    movements[perf.category] = delta
        summary.movements = movements
        summary.first_check = False
    return summary


async def _previous_check(session: AsyncSession, entry: Entry) -> Entry | None:
    previous: Entry | None = await session.scalar(
        select(Entry)
        .where(
            Entry.user_id == entry.user_id,
            Entry.is_practice.is_(True),
            Entry.mode.in_(CHECK_MODES),
            Entry.status == SUBMITTED,
            Entry.id != entry.id,
            Entry.submitted_at < (entry.submitted_at or datetime.now(UTC)),
        )
        .order_by(Entry.submitted_at.desc())
        .limit(1)
    )
    return previous


async def get_check_entry(session: AsyncSession, entry_id: uuid.UUID, user_id: uuid.UUID) -> Entry:
    """The user's own SUBMITTED check entry, or CheckNotFoundError (contest paths stay disjoint)."""
    entry = await session.get(Entry, entry_id)
    if (
        entry is None
        or entry.user_id != user_id
        or not entry.is_practice
        or entry.status != SUBMITTED
        or (entry.mode or "") not in CHECK_MODES
    ):
        raise CheckNotFoundError()
    return entry


async def latest_check(
    session: AsyncSession, user_id: uuid.UUID, *, now: datetime | None = None
) -> tuple[Entry | None, bool]:
    """(latest submitted check entry or None, whether it happened on today's ET date)."""
    now = now or datetime.now(UTC)
    entry = await session.scalar(
        select(Entry)
        .where(
            Entry.user_id == user_id,
            Entry.is_practice.is_(True),
            Entry.mode.in_(CHECK_MODES),
            Entry.status == SUBMITTED,
        )
        .order_by(Entry.submitted_at.desc())
        .limit(1)
    )
    if entry is None or entry.submitted_at is None:
        return None, False
    # "Today" follows the app's ET wall-clock convention (the Daily Royale's day boundary).
    completed_today = entry.submitted_at.astimezone(ET).date() == now.astimezone(ET).date()
    return entry, completed_today
