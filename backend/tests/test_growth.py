"""Growth trajectory: daily-stats upsert, rolling Brain Score, per-category, /me/growth."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from app.models import Question, RoundAnswer, User, UserDailyStats
from app.services.growth import get_growth, resolve_category, update_daily_stats
from app.services.practice import answer_practice_round, start_practice
from content.loader import load_trivia
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


async def _user(session: AsyncSession) -> User:
    user = User(email=f"{uuid.uuid4().hex[:12]}@example.com", password_hash="x")
    session.add(user)
    await session.flush()
    return user


async def test_user_daily_stats_row_persists(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    db_session.add(
        UserDailyStats(user_id=user.id, stat_date=date(2026, 7, 4), answers=3, correct=2)
    )
    await db_session.flush()
    row = (
        await db_session.execute(select(UserDailyStats).where(UserDailyStats.user_id == user.id))
    ).scalar_one()
    assert row.answers == 3 and row.correct == 2 and row.per_category == {}


async def _question(session: AsyncSession, *, category: str = "Science & Nature") -> Question:
    q = Question(
        module_type="trivia",
        category=category,
        icon="🔬",
        payload={"prompt": "q?", "options": ["a", "b", "c", "d"], "correctIndex": 0},
        difficulty="hard",
        status="approved",
        explanation="x",
    )
    session.add(q)
    await session.flush()
    return q


async def test_update_daily_stats_accumulates_same_day(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    await _question(db_session)
    d = date(2026, 7, 4)
    for correct in (True, True, False):
        await update_daily_stats(
            db_session,
            user.id,
            stat_date=d,
            is_correct=correct,
            time_frac=0.5,
            streak_after=2 if correct else 0,
            difficulty="hard",
            category="Science & Nature",
        )
    row = (
        await db_session.execute(select(UserDailyStats).where(UserDailyStats.user_id == user.id))
    ).scalar_one()
    assert row.answers == 3
    assert row.correct == 2
    assert row.best_streak == 2
    assert row.hard_correct == 2
    assert row.per_category["Science & Nature"] == {"a": 3, "c": 2}


async def test_resolve_category_from_question(db_session: AsyncSession) -> None:
    q = await _question(db_session, category="Geography")
    assert await resolve_category(db_session, q.id) == "Geography"
    assert await resolve_category(db_session, None) is None


async def _first_result(session, entry_id):
    a0 = (
        (
            await session.execute(
                select(RoundAnswer)
                .where(RoundAnswer.entry_id == entry_id)
                .order_by(RoundAnswer.idx)
            )
        )
        .scalars()
        .first()
    )
    if a0.module_type == "memory_flash":
        return a0, {"taps": a0.server_answer["sequence"], "tap_times": [0], "elapsed_ms": 0}
    return a0, {"choice": a0.server_answer["correctIndex"], "elapsed_ms": 0}


async def test_practice_answer_upserts_daily_stats(db_session: AsyncSession) -> None:
    await load_trivia(db_session)
    user = await _user(db_session)
    entry = await start_practice(db_session, user.id, category=None, mode=None)
    _a0, result = await _first_result(db_session, entry.id)
    await answer_practice_round(db_session, entry.id, user.id, 0, result)

    rows = (
        (await db_session.execute(select(UserDailyStats).where(UserDailyStats.user_id == user.id)))
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].answers == 1


async def test_growth_capture_gated_off(db_session: AsyncSession, monkeypatch) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "growth_tracking_enabled", False)
    await load_trivia(db_session)
    user = await _user(db_session)
    entry = await start_practice(db_session, user.id, category=None, mode=None)
    _a0, result = await _first_result(db_session, entry.id)
    await answer_practice_round(db_session, entry.id, user.id, 0, result)
    rows = (
        (await db_session.execute(select(UserDailyStats).where(UserDailyStats.user_id == user.id)))
        .scalars()
        .all()
    )
    assert rows == []


async def _seed_day(session, user_id, d, *, answers, correct, cat="Science & Nature"):
    await session.merge(
        UserDailyStats(
            user_id=user_id,
            stat_date=d,
            answers=answers,
            correct=correct,
            sum_time_frac=answers * 0.5,
            best_streak=correct,
            hard_correct=0,
            per_category={cat: {"a": answers, "c": correct}},
        )
    )
    await session.flush()


async def test_get_growth_rolls_and_shapes(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    today = date(2026, 7, 4)
    for i in range(10):
        await _seed_day(db_session, user.id, today - timedelta(days=i), answers=4, correct=i % 4)

    out = await get_growth(db_session, user.id, days=7, today=today)
    assert out["brain_score"]["current"] >= 300
    assert len(out["trend"]) == 7
    assert out["trend"][-1]["date"] == today.isoformat()
    assert any(c["category"] == "Science & Nature" for c in out["categories"])
    assert out["consistency"]["days_played"] >= 1


async def test_get_growth_cold_start(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    today = date(2026, 7, 4)
    await _seed_day(db_session, user.id, today, answers=2, correct=1)
    out = await get_growth(db_session, user.id, days=30, today=today)
    assert out["consistency"]["days_played"] == 1
    assert out["trend"][-1]["date"] == today.isoformat()


async def _register(client: AsyncClient, email: str) -> str:
    r = await client.post(
        "/auth/register",
        json={"email": email, "username": email.split("@")[0][:16], "password": "super-secret-pw"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def test_me_growth_endpoint_shape(client: AsyncClient) -> None:
    token = await _register(client, f"{uuid.uuid4().hex[:10]}@example.com")
    r = await client.get("/me/growth?days=30", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"brain_score", "trend", "categories", "consistency"}
    assert set(body["brain_score"]) == {"current", "delta"}
    assert set(body["consistency"]) == {"days_played", "streak"}


async def test_me_mastery_endpoint_cold_user(client: AsyncClient) -> None:
    from content.categories import CANONICAL_CATEGORIES

    token = await _register(client, f"{uuid.uuid4().hex[:10]}@example.com")
    r = await client.get("/me/mastery", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    cats = body["categories"]
    # one entry per canonical category, in order
    assert [c["category"] for c in cats] == list(CANONICAL_CATEGORIES)
    # cold user → all warming up
    assert all(c["level"] == 0 and c["mastered"] is False for c in cats)
