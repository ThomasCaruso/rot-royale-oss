"""Seed content banks into the questions table + read them back for generation.

`load_trivia` is idempotent (keyed on prompt text), so re-running it is safe. `fetch_bank` returns
the bank ordered by id — a STABLE order is required for seeded generation to be reproducible.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from app.models import Question, QuestionTranslation
from app.models.question import SERVABLE_STATUSES
from app.models.question_translation import SERVABLE_TRANSLATION_STATUSES
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from content.difficulties import QUESTION_DIFFICULTIES


def _content_root() -> Path:
    """Where challenge content lives — settings.content_root, never a repo-relative guess.

    Read at call time rather than import time so a test (or a job) can point at a different root
    without re-importing the module.
    """
    from app.core.config import settings

    return settings.content_root


# Legacy trivia.json carried an integer difficulty; map it onto the difficulty enum.
_LEGACY_DIFFICULTY = {1: "easy", 2: "medium", 3: "hard"}


def _norm_difficulty(value: Any) -> str:
    if isinstance(value, int):
        return _LEGACY_DIFFICULTY.get(value, "medium")
    return value if value in QUESTION_DIFFICULTIES else "medium"


async def load_trivia(session: AsyncSession) -> int:
    """Insert any trivia questions from trivia.json not already present. Returns count added.

    Seed content is inserted as status='approved' (it predates the review gate), so it serves.
    """
    data = json.loads((_content_root() / "trivia.json").read_text(encoding="utf-8"))
    existing = set(
        (
            await session.execute(
                select(Question.payload["prompt"].astext).where(Question.module_type == "trivia")
            )
        ).scalars()
    )
    added = 0
    for item in data:
        if item["prompt"] in existing:
            continue
        session.add(
            Question(
                module_type="trivia",
                category=item["category"],
                icon=item["icon"],
                difficulty=_norm_difficulty(item["difficulty"]),
                status="approved",
                explanation=item.get("explanation"),
                active=True,
                payload={
                    "prompt": item["prompt"],
                    "options": item["options"],
                    "correctIndex": item["correctIndex"],
                },
            )
        )
        added += 1
    await session.flush()
    return added


async def list_categories(
    session: AsyncSession, module_type: str = "trivia"
) -> list[dict[str, Any]]:
    """Servable categories with their question counts, sorted by name. Uses the SAME serving gate as
    fetch_bank, so a category that only has draft content is never offered (and won't 500 on start).
    """
    rows = (
        await session.execute(
            select(Question.category, func.count())
            .where(
                Question.module_type == module_type,
                Question.status.in_(SERVABLE_STATUSES),
            )
            .group_by(Question.category)
            .order_by(Question.category)
        )
    ).all()
    return [{"name": name, "count": count} for name, count in rows]


# Imported by fetch_bank consumers that need the serving gate without importing the model directly.
__all__ = ["load_trivia", "fetch_bank", "list_categories", "SERVABLE_STATUSES"]


async def fetch_bank(
    session: AsyncSession,
    module_type: str,
    category: str | None = None,
    locale: str = "en",
) -> list[dict[str, Any]]:
    """Servable questions for a module, ordered by id (stable order → reproducible generation).

    The serving gate is `status in (approved, live)` — draft content never reaches a player. When
    `category` is given, the bank is scoped to that one category (the category-session path); ranked
    windows pass no category and draw across all of them.

    `locale` selects the DISPLAY language. Each row carries a `display` dict — the localized
    {prompt, options, explanation} when an approved translation exists, otherwise the English
    original. `payload` is left EXACTLY as stored, because two things key off the canonical English:

    - `question_key(category, payload["prompt"])` resolves authored campaign levels. Translating the
      stem in place would orphan every level.
    - `payload["correctIndex"]` is positional. `display["options"]` is validated to be the same
      options in the same order, so the existing shuffle + remap in `trivia_spec` stays correct.

    Fallback is per question, so a partially translated bank always serves a complete round set.
    """
    stmt = (
        select(Question)
        .where(
            Question.module_type == module_type,
            Question.status.in_(SERVABLE_STATUSES),
        )
        .order_by(Question.id)
    )
    if category is not None:
        stmt = stmt.where(Question.category == category)
    rows = (await session.execute(stmt)).scalars().all()

    translations: dict[uuid.UUID, QuestionTranslation] = {}
    if locale != "en" and rows:
        tr_rows = (
            (
                await session.execute(
                    select(QuestionTranslation).where(
                        QuestionTranslation.locale == locale,
                        QuestionTranslation.status.in_(SERVABLE_TRANSLATION_STATUSES),
                        QuestionTranslation.question_id.in_([q.id for q in rows]),
                    )
                )
            )
            .scalars()
            .all()
        )
        translations = {t.question_id: t for t in tr_rows}

    bank: list[dict[str, Any]] = []
    for q in rows:
        tr = translations.get(q.id)
        # A translation whose option count drifted from the source can never be served: the shuffle
        # would remap correctIndex onto a different-length list. Fall back to English instead.
        #
        # Bound to the ROW rather than to a bool: the three uses below are then provably non-None.
        # A separate `usable` flag reads the same to a human and not at all to a type checker, and
        # the property being relied on — tr is not None whenever usable is True — is exactly the
        # kind a later edit can break silently.
        usable_tr = (
            tr
            if tr is not None and len(tr.options or []) == len(q.payload.get("options", []))
            else None
        )
        bank.append(
            {
                "id": str(q.id),
                "category": q.category,
                "icon": q.icon,
                "difficulty": q.difficulty,
                "explanation": q.explanation,
                "payload": q.payload,
                "display": {
                    "prompt": usable_tr.prompt if usable_tr else q.payload["prompt"],
                    "options": (
                        list(usable_tr.options) if usable_tr else list(q.payload["options"])
                    ),
                    "explanation": (
                        (usable_tr.explanation or q.explanation) if usable_tr else q.explanation
                    ),
                },
            }
        )
    return bank
