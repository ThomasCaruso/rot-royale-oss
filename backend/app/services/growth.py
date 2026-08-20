"""Growth trajectory: incremental daily-stats upsert + the rolling read model.

Personalization/product-analytics only — never touches scores/coins/rating. JSONB is REASSIGNED,
never mutated in place. All writes are best-effort and flush-only (the caller owns the commit).

Implementation note: UserDailyStats integer columns carry server_default=text("0") but NO
Python-side default, so a freshly constructed row has None for those fields before the first DB
round-trip. The constructor call below passes explicit zeros to guarantee in-session arithmetic
works correctly without needing a flush first.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Profile, Question, QuestionAIMetadata, UserDailyStats
from app.services.brain_score import brain_score

logger = logging.getLogger(__name__)


async def resolve_category(session: AsyncSession, question_id: uuid.UUID | None) -> str | None:
    """Return the question's category — AI metadata first (canonical), else the bank row.

    Returns None when the round has no bank question (generated modules like rapid_math).
    """
    if question_id is None:
        return None
    meta_cat = await session.scalar(
        select(QuestionAIMetadata.category).where(QuestionAIMetadata.question_id == question_id)
    )
    if meta_cat:
        return meta_cat
    cat: str | None = await session.scalar(
        select(Question.category).where(Question.id == question_id)
    )
    return cat


async def update_daily_stats(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    stat_date: date,
    is_correct: bool,
    time_frac: float,
    streak_after: int | None,
    difficulty: str | None,
    category: str | None,
) -> None:
    """Upsert today's rollup with one answer. Does not commit (flush only)."""
    row = await session.get(UserDailyStats, (user_id, stat_date))
    if row is None:
        # Pass explicit zeros/empties: server_default and column-level default only apply on DB
        # insert, not at Python object construction time. Initialise every field here so in-session
        # arithmetic works correctly before the first flush.
        row = UserDailyStats(
            user_id=user_id,
            stat_date=stat_date,
            answers=0,
            correct=0,
            sum_time_frac=0.0,
            best_streak=0,
            hard_correct=0,
            per_category={},
        )
        session.add(row)

    row.answers += 1
    if is_correct:
        row.correct += 1
        if difficulty == "hard":
            row.hard_correct += 1
    row.sum_time_frac += float(time_frac)
    row.best_streak = max(row.best_streak, streak_after or 0)

    if category:
        per = dict(row.per_category)  # REASSIGN, never mutate in place
        cur = dict(per.get(category, {"a": 0, "c": 0}))
        cur["a"] = cur.get("a", 0) + 1
        cur["c"] = cur.get("c", 0) + (1 if is_correct else 0)
        per[category] = cur
        row.per_category = per

    await session.flush()


WINDOW = 7  # trailing days for the rolling Brain Score
MIN_DAYS, MAX_DAYS, DEFAULT_DAYS = 7, 90, 30
_DIRECTION_DEADBAND = 0.03


def _clamp_days(days: int) -> int:
    return max(MIN_DAYS, min(MAX_DAYS, days))


def _rolling_score(rows_by_date: dict[date, UserDailyStats], day: date) -> int | None:
    """Brain Score over the trailing WINDOW ending at `day` (None if no answers in that window)."""
    answers = correct = hard = 0
    stf = 0.0
    best = 0
    for i in range(WINDOW):
        r = rows_by_date.get(day - timedelta(days=i))
        if r is None:
            continue
        answers += r.answers
        correct += r.correct
        hard += r.hard_correct
        stf += r.sum_time_frac
        best = max(best, r.best_streak)
    if answers == 0:
        return None
    return brain_score(
        accuracy=correct / answers,
        avg_time_frac=stf / answers,
        best_streak=best,
        hard_correct=hard,
    )


async def get_growth(
    session: AsyncSession, user_id: uuid.UUID, days: int, today: date
) -> dict[str, Any]:
    days = _clamp_days(days)
    window_start = today - timedelta(days=days - 1)
    load_start = window_start - timedelta(days=WINDOW - 1)
    rows = (
        (
            await session.execute(
                select(UserDailyStats).where(
                    UserDailyStats.user_id == user_id,
                    UserDailyStats.stat_date >= load_start,
                    UserDailyStats.stat_date <= today,
                )
            )
        )
        .scalars()
        .all()
    )
    by_date = {r.stat_date: r for r in rows}

    trend: list[dict[str, Any]] = []
    last: int | None = None
    for offset in range(days):
        d = window_start + timedelta(days=offset)
        score = _rolling_score(by_date, d)
        if score is None:
            score = last
        else:
            last = score
        if score is not None:
            trend.append({"date": d.isoformat(), "score": score})

    current = trend[-1]["score"] if trend else None
    prior = _rolling_score(by_date, today - timedelta(days=WINDOW))
    delta = (current - prior) if (current is not None and prior is not None) else 0

    window_rows = [r for r in rows if r.stat_date >= window_start]
    cats: dict[str, dict[str, Any]] = {}
    for r in window_rows:
        for cat, v in r.per_category.items():
            c = cats.setdefault(cat, {"a": 0, "c": 0, "days": {}})
            c["a"] += v.get("a", 0)
            c["c"] += v.get("c", 0)
            c["days"][r.stat_date] = v

    categories: list[dict[str, Any]] = []
    mid = window_start + timedelta(days=days // 2)
    for cat, c in cats.items():
        acc = c["c"] / c["a"] if c["a"] else 0.0
        spark = [
            round(
                c["days"][window_start + timedelta(days=o)]["c"]
                / c["days"][window_start + timedelta(days=o)]["a"],
                3,
            )
            for o in range(days)
            if (window_start + timedelta(days=o)) in c["days"]
            and c["days"][window_start + timedelta(days=o)]["a"] > 0
        ]
        early = [v for dt, v in c["days"].items() if dt < mid]
        late = [v for dt, v in c["days"].items() if dt >= mid]
        early_a = sum(v["a"] for v in early)
        late_a = sum(v["a"] for v in late)
        ea = sum(v["c"] for v in early) / early_a if early_a else None
        la = sum(v["c"] for v in late) / late_a if late_a else None
        if ea is None or la is None:
            direction = "flat"
        elif la - ea > _DIRECTION_DEADBAND:
            direction = "up"
        elif ea - la > _DIRECTION_DEADBAND:
            direction = "down"
        else:
            direction = "flat"
        categories.append(
            {"category": cat, "accuracy": round(acc, 3), "spark": spark, "direction": direction}
        )
    categories.sort(key=lambda x: -x["accuracy"])

    profile = await session.get(Profile, user_id)
    days_played = sum(1 for r in window_rows if r.answers > 0)

    return {
        "brain_score": {"current": current or 300, "delta": delta},
        "trend": trend,
        "categories": categories,
        "consistency": {
            "days_played": days_played,
            "streak": profile.streak_count if profile else 0,
        },
    }
