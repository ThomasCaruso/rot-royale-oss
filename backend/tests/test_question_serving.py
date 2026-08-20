"""Serving gate + category filter for the question bank (categories milestone).

The contract: ONLY status='approved'/'live' questions are ever served, and fetch_bank can scope to a
single category. Draft content is staged and must never reach a player.
"""

from __future__ import annotations

from typing import Any

from app.models import Question
from content.loader import fetch_bank
from sqlalchemy.ext.asyncio import AsyncSession


def _q(
    prompt: str, *, category: str = "Science", status: str = "approved", difficulty: str = "easy"
):
    return Question(
        module_type="trivia",
        category=category,
        icon="🔬",
        difficulty=difficulty,
        status=status,
        explanation=f"because {prompt}",
        payload={"prompt": prompt, "options": ["a", "b", "c", "d"], "correctIndex": 0},
    )


async def _prompts(rows: list[dict[str, Any]]) -> set[str]:
    return {r["payload"]["prompt"] for r in rows}


async def test_fetch_bank_serves_only_approved_or_live(db_session: AsyncSession):
    db_session.add_all(
        [
            _q("approved-q", status="approved"),
            _q("live-q", status="live"),
            _q("draft-q", status="draft"),
        ]
    )
    await db_session.flush()
    served = await _prompts(await fetch_bank(db_session, "trivia"))
    assert "approved-q" in served
    assert "live-q" in served
    assert "draft-q" not in served  # draft content never serves


async def test_fetch_bank_filters_by_category(db_session: AsyncSession):
    db_session.add_all(
        [
            _q("sci-1", category="Science"),
            _q("sci-2", category="Science"),
            _q("geo-1", category="Geography"),
        ]
    )
    await db_session.flush()
    sci = await fetch_bank(db_session, "trivia", category="Science")
    assert await _prompts(sci) == {"sci-1", "sci-2"}
    assert all(r["category"] == "Science" for r in sci)


async def test_fetch_bank_carries_difficulty_and_explanation(db_session: AsyncSession):
    db_session.add(_q("explained", difficulty="hard"))
    await db_session.flush()
    [row] = await fetch_bank(db_session, "trivia", category="Science")
    assert row["difficulty"] == "hard"
    assert row["explanation"] == "because explained"
