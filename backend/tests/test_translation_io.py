"""Hand-off translation round trip: export documents, import an assistant's reply.

The export exists to be re-imported, so these tests cover the loop rather than the file text: a
document is generated, a reply is fed back, and the stored row must satisfy the same correctIndex
safety property the batch job guarantees.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from app.models import Question, QuestionTranslation
from app.modules.trivia import trivia_spec
from app.services.translation_io import export_documents, import_documents, slugify
from app.services.translator import TranslationError
from content.loader import fetch_bank
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _question(prompt: str = "Which sport uses a puck?", **over: Any) -> Question:
    base: dict[str, Any] = {
        "module_type": "trivia",
        "category": "Sports",
        "icon": "🏒",
        "difficulty": "easy",
        "status": "approved",
        "explanation": "Ice hockey uses a puck.",
        "payload": {
            "prompt": prompt,
            "options": ["Lacrosse", "Rugby", "Ice hockey", "Polo"],
            "correctIndex": 2,
        },
    }
    base.update(over)
    return Question(**base)


def _reply(qid: str, options: list[str] | None = None, flags: list[str] | None = None) -> str:
    """A realistic assistant reply: prose wrapped around a fenced JSON block."""
    body = [
        {
            "id": qid,
            "prompt": "¿Qué deporte usa un disco?",
            "options": options or ["Lacrosse", "Rugby", "Hockey sobre hielo", "Polo"],
            "explanation": "El hockey sobre hielo usa un disco.",
            "flags": flags or [],
        }
    ]
    return (
        "Sure! Here's the translation:\n\n```json\n"
        + json.dumps(body, ensure_ascii=False)
        + "\n```"
    )


def test_slugify_makes_filesystem_safe_names() -> None:
    assert slugify("Science & Nature") == "science-nature"
    assert slugify("Pop Culture & Entertainment") == "pop-culture-entertainment"


@pytest.mark.asyncio
class TestExport:
    async def test_writes_one_document_per_category_with_embedded_ids(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        db_session.add(_question())
        await db_session.flush()

        res = await export_documents(db_session, "es", tmp_path)
        assert res.files, "expected a document"
        doc = res.files[0].read_text(encoding="utf-8")

        payload = json.loads(re.findall(r"## Questions.*?```json\s*(.+?)```", doc, re.S)[0])
        assert payload[0]["options"] == ["Lacrosse", "Rugby", "Ice hockey", "Polo"]
        # The id is what maps the reply back; without it the import can only trust ordering.
        assert "id" in payload[0]
        assert "PRESERVE OPTION ORDER" in doc

    async def test_chunks_large_categories(self, db_session: AsyncSession, tmp_path: Path) -> None:
        """A whole category overflows an assistant's output budget, and a truncated reply looks
        complete — so documents are split."""
        for i in range(7):
            db_session.add(_question(prompt=f"Q{i}?"))
        await db_session.flush()

        res = await export_documents(db_session, "es", tmp_path, chunk=3)
        assert len(res.files) == 3
        assert all("part" in f.name for f in res.files)

    async def test_skips_questions_already_translated(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        q = _question()
        db_session.add(q)
        await db_session.flush()
        db_session.add(
            QuestionTranslation(
                question_id=q.id, locale="es", prompt="ya", options=["a", "b", "c", "d"]
            )
        )
        await db_session.flush()

        res = await export_documents(db_session, "es", tmp_path)
        assert res.questions == 0 and not res.files

    async def test_rejects_an_unsupported_locale(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        with pytest.raises(TranslationError, match="unsupported locale"):
            await export_documents(db_session, "de", tmp_path)


@pytest.mark.asyncio
class TestImport:
    async def test_accepts_a_fenced_reply_with_surrounding_prose(
        self, db_session: AsyncSession
    ) -> None:
        q = _question()
        db_session.add(q)
        await db_session.flush()

        report = await import_documents(db_session, "es", _reply(str(q.id)))
        assert (report.imported, report.failed) == (1, 0)
        row = (await db_session.execute(select(QuestionTranslation))).scalar_one()
        assert row.status == "draft", "hand-off output is still review-gated"
        assert row.prompt == "¿Qué deporte usa un disco?"

    async def test_rejects_a_reply_that_drops_an_option(self, db_session: AsyncSession) -> None:
        """The failure that would silently rescore a question: fewer options shifts correctIndex."""
        q = _question()
        db_session.add(q)
        await db_session.flush()

        report = await import_documents(
            db_session, "es", _reply(str(q.id), options=["Lacrosse", "Rugby", "Hockey"])
        )
        assert report.failed == 1 and report.imported == 0
        assert (await db_session.execute(select(QuestionTranslation))).first() is None

    async def test_reports_an_unknown_id_instead_of_guessing(
        self, db_session: AsyncSession
    ) -> None:
        report = await import_documents(
            db_session, "es", _reply("11111111-1111-1111-1111-111111111111")
        )
        assert report.failed == 1
        assert "no such question" in report.errors[0]

    async def test_reports_a_malformed_id(self, db_session: AsyncSession) -> None:
        report = await import_documents(db_session, "es", _reply("not-a-uuid"))
        assert report.failed == 1
        assert "invalid id" in report.errors[0]

    async def test_raises_when_no_array_is_present(self, db_session: AsyncSession) -> None:
        with pytest.raises(TranslationError, match="no JSON array"):
            await import_documents(db_session, "es", "I'm sorry, I can't help with that.")

    async def test_a_human_row_is_not_clobbered_by_a_machine_import(
        self, db_session: AsyncSession
    ) -> None:
        q = _question()
        db_session.add(q)
        await db_session.flush()
        db_session.add(
            QuestionTranslation(
                question_id=q.id,
                locale="es",
                prompt="Traducción humana",
                options=["a", "b", "c", "d"],
                status="approved",
                source="human",
            )
        )
        await db_session.flush()

        report = await import_documents(db_session, "es", _reply(str(q.id)))
        assert report.skipped == 1 and report.imported == 0
        row = (await db_session.execute(select(QuestionTranslation))).scalar_one()
        assert row.prompt == "Traducción humana"

    async def test_round_trip_keeps_the_answer_correct_after_shuffling(
        self, db_session: AsyncSession
    ) -> None:
        """The whole point: export → reply → import → serve, with the right answer still right."""
        q = _question()
        db_session.add(q)
        await db_session.flush()

        await import_documents(db_session, "es", _reply(str(q.id)), approve=True)
        bank = await fetch_bank(db_session, "trivia", locale="es")
        row = next(r for r in bank if r["id"] == str(q.id))
        assert row["display"]["prompt"] == "¿Qué deporte usa un disco?"

        for seed in range(25):
            spec, answer = trivia_spec(row, shuffle_seed=seed)
            assert spec["options"][answer["correctIndex"]] == "Hockey sobre hielo"
