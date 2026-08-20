"""Bank translation — the correctIndex-safety invariant, staging, and serving overlay.

Fake chat client, no network. The property under test throughout: `payload["correctIndex"]` is
POSITIONAL, so a translation may only ever be served when it carries the same number of options in
the same order. Anything else must fall back to English rather than silently rescore a question.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from app.models import Question, QuestionTranslation
from app.modules.trivia import trivia_spec
from app.services.translator import (
    TranslationError,
    approve_clean_translations,
    coverage_report,
    translate_batch,
    validate_translation,
)
from content.loader import fetch_bank
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

FR_JSON = json.dumps(
    {
        "prompt": "Quel gaz les plantes absorbent-elles principalement dans l'air ?",
        "options": ["Oxygène", "Azote", "Dioxyde de carbone", "Hydrogène"],
        "explanation": "Les plantes absorbent le dioxyde de carbone.",
        "flags": [],
    },
    ensure_ascii=False,
)


class FakeChat:
    def __init__(self, content: str = FR_JSON) -> None:
        self.content = content
        self.calls = 0

    async def complete(self, system: str, user: str) -> str:
        self.calls += 1
        return self.content


def _question(**over: Any) -> Question:
    base: dict[str, Any] = {
        "module_type": "trivia",
        "category": "Science & Nature",
        "icon": "🔬",
        "difficulty": "easy",
        "status": "approved",
        "explanation": "Plants absorb carbon dioxide.",
        "payload": {
            "prompt": "What gas do plants primarily absorb from the air?",
            "options": ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"],
            "correctIndex": 2,
        },
    }
    base.update(over)
    return Question(**base)


# ---------------------------------------------------------------- validation (the safety net)


class TestValidateTranslation:
    SOURCE = ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"]

    def test_accepts_a_well_formed_translation(self) -> None:
        out = validate_translation(FR_JSON, self.SOURCE)
        assert out["options"] == ["Oxygène", "Azote", "Dioxyde de carbone", "Hydrogène"]
        assert out["flags"] == []

    def test_rejects_a_changed_option_COUNT(self) -> None:
        """The load-bearing check: a dropped option would shift correctIndex onto another answer."""
        raw = json.dumps({"prompt": "P", "options": ["a", "b", "c"], "flags": []})
        with pytest.raises(TranslationError, match="option count changed"):
            validate_translation(raw, self.SOURCE)

    def test_rejects_extra_options(self) -> None:
        raw = json.dumps({"prompt": "P", "options": ["a", "b", "c", "d", "e"], "flags": []})
        with pytest.raises(TranslationError, match="option count changed"):
            validate_translation(raw, self.SOURCE)

    def test_rejects_options_that_collapse_to_duplicates(self) -> None:
        """Two identical options make the question unanswerable — never store it."""
        raw = json.dumps({"prompt": "P", "options": ["a", "b", "B", "d"], "flags": []})
        with pytest.raises(TranslationError, match="duplicates"):
            validate_translation(raw, self.SOURCE)

    def test_rejects_empty_prompt_and_empty_option(self) -> None:
        with pytest.raises(TranslationError, match="prompt"):
            validate_translation(json.dumps({"prompt": "  ", "options": self.SOURCE}), self.SOURCE)
        raw = json.dumps({"prompt": "P", "options": ["a", "", "c", "d"]})
        with pytest.raises(TranslationError, match="option 1"):
            validate_translation(raw, self.SOURCE)

    def test_rejects_non_json_and_non_object(self) -> None:
        with pytest.raises(TranslationError, match="not JSON"):
            validate_translation("sorry, I can't do that", self.SOURCE)
        with pytest.raises(TranslationError, match="not a JSON object"):
            validate_translation("[1, 2]", self.SOURCE)

    def test_keeps_only_known_flags(self) -> None:
        raw = json.dumps(
            {"prompt": "P", "options": self.SOURCE, "flags": ["wordplay", "invented_flag"]}
        )
        assert validate_translation(raw, self.SOURCE)["flags"] == ["wordplay"]


# ---------------------------------------------------------------- batch behaviour


@pytest.mark.asyncio
class TestTranslateBatch:
    async def test_stages_as_draft_so_machine_output_never_reaches_a_player(
        self, db_session: AsyncSession
    ) -> None:
        db_session.add(_question())
        await db_session.flush()

        report = await translate_batch(db_session, "fr", client=FakeChat())
        assert (report.translated, report.failed) == (1, 0)

        row = (await db_session.execute(select(QuestionTranslation))).scalar_one()
        assert row.status == "draft"
        assert row.source == "machine"

    async def test_approve_never_publishes_a_RISK_flagged_row(
        self, db_session: AsyncSession
    ) -> None:
        db_session.add(_question())
        await db_session.flush()

        flagged = json.dumps(
            {
                "prompt": "P",
                "options": ["Oxygène", "Azote", "Dioxyde de carbone", "Hydrogène"],
                "flags": ["wordplay"],
            },
            ensure_ascii=False,
        )
        report = await translate_batch(db_session, "fr", client=FakeChat(flagged), approve=True)
        row = (await db_session.execute(select(QuestionTranslation))).scalar_one()
        # A risk flag is exactly the case a human must see — --approve must not publish it.
        assert row.status == "draft"
        assert report.flagged == 1

    async def test_approve_DOES_publish_a_row_with_only_an_informational_flag(
        self, db_session: AsyncSession
    ) -> None:
        """`proper_nouns_only` means "little to translate", not "possibly broken". Blocking on it
        would send a third of a clean bank to manual review for no correctness reason."""
        db_session.add(_question())
        await db_session.flush()

        info = json.dumps(
            {
                "prompt": "P",
                "options": ["Oxygène", "Azote", "Dioxyde de carbone", "Hydrogène"],
                "flags": ["proper_nouns_only"],
            },
            ensure_ascii=False,
        )
        report = await translate_batch(db_session, "fr", client=FakeChat(info), approve=True)
        row = (await db_session.execute(select(QuestionTranslation))).scalar_one()
        assert row.status == "approved"
        assert row.flags == ["proper_nouns_only"], "the note is still recorded"
        assert report.flagged == 0, "informational notes are not review burden"

    async def test_without_approve_everything_stays_draft(self, db_session: AsyncSession) -> None:
        db_session.add(_question())
        await db_session.flush()
        await translate_batch(db_session, "fr", client=FakeChat())
        row = (await db_session.execute(select(QuestionTranslation))).scalar_one()
        assert row.status == "draft"

    async def test_is_idempotent_and_never_clobbers_a_human_row(
        self, db_session: AsyncSession
    ) -> None:
        q = _question()
        db_session.add(q)
        await db_session.flush()
        db_session.add(
            QuestionTranslation(
                question_id=q.id,
                locale="fr",
                prompt="Traduction humaine",
                options=["a", "b", "c", "d"],
                status="approved",
                source="human",
            )
        )
        await db_session.flush()

        # Default run skips anything already translated…
        chat = FakeChat()
        report = await translate_batch(db_session, "fr", client=chat)
        assert (report.translated, chat.calls) == (0, 0)

        # …and even a forced re-run refuses to overwrite human-authored text.
        await translate_batch(db_session, "fr", client=FakeChat(), force=True)
        row = (await db_session.execute(select(QuestionTranslation))).scalar_one()
        assert row.prompt == "Traduction humaine"
        assert row.source == "human"

    async def test_a_bad_response_is_reported_not_stored(self, db_session: AsyncSession) -> None:
        db_session.add(_question())
        await db_session.flush()

        bad = json.dumps({"prompt": "P", "options": ["only", "three", "here"]})
        report = await translate_batch(db_session, "fr", client=FakeChat(bad))
        assert report.failed == 1 and report.translated == 0
        assert (await db_session.execute(select(QuestionTranslation))).first() is None

    async def test_rejects_an_unsupported_locale(self, db_session: AsyncSession) -> None:
        with pytest.raises(TranslationError, match="unsupported locale"):
            await translate_batch(db_session, "de", client=FakeChat())

    async def test_coverage_counts_the_servable_bank(self, db_session: AsyncSession) -> None:
        db_session.add(_question())
        await db_session.flush()
        await translate_batch(db_session, "fr", client=FakeChat())
        cov = await coverage_report(db_session)
        assert cov["servable_questions"] >= 1
        assert cov["locales"]["fr"]["draft"] >= 1


# ---------------------------------------------------------------- serving overlay


@pytest.mark.asyncio
class TestServingOverlay:
    async def _seed(self, session: AsyncSession, **tr: Any) -> Question:
        q = _question()
        session.add(q)
        await session.flush()
        if tr:
            session.add(QuestionTranslation(question_id=q.id, locale="fr", **tr))
            await session.flush()
        return q

    async def test_english_is_served_when_no_translation_exists(
        self, db_session: AsyncSession
    ) -> None:
        q = await self._seed(db_session)
        bank = await fetch_bank(db_session, "trivia", locale="fr")
        row = next(r for r in bank if r["id"] == str(q.id))
        assert row["display"]["prompt"] == q.payload["prompt"]

    async def test_a_draft_translation_is_NOT_served(self, db_session: AsyncSession) -> None:
        q = await self._seed(
            db_session,
            prompt="FR prompt",
            options=["Oxygène", "Azote", "Dioxyde de carbone", "Hydrogène"],
            status="draft",
        )
        bank = await fetch_bank(db_session, "trivia", locale="fr")
        row = next(r for r in bank if r["id"] == str(q.id))
        assert row["display"]["prompt"] == q.payload["prompt"], "draft content must not be served"

    async def test_an_approved_translation_is_served(self, db_session: AsyncSession) -> None:
        q = await self._seed(
            db_session,
            prompt="Quel gaz ?",
            options=["Oxygène", "Azote", "Dioxyde de carbone", "Hydrogène"],
            status="approved",
        )
        bank = await fetch_bank(db_session, "trivia", locale="fr")
        row = next(r for r in bank if r["id"] == str(q.id))
        assert row["display"]["prompt"] == "Quel gaz ?"
        # English payload is untouched — campaign question_key hashing depends on it.
        assert row["payload"]["prompt"] == q.payload["prompt"]

    async def test_english_locale_never_loads_translations(self, db_session: AsyncSession) -> None:
        q = await self._seed(
            db_session,
            prompt="Quel gaz ?",
            options=["Oxygène", "Azote", "Dioxyde de carbone", "Hydrogène"],
            status="approved",
        )
        bank = await fetch_bank(db_session, "trivia", locale="en")
        row = next(r for r in bank if r["id"] == str(q.id))
        assert row["display"]["prompt"] == q.payload["prompt"]

    async def test_mismatched_option_count_falls_back_to_english(
        self, db_session: AsyncSession
    ) -> None:
        """Belt-and-braces: even an APPROVED row with the wrong option count must not be served."""
        q = await self._seed(db_session, prompt="FR", options=["un", "deux"], status="approved")
        bank = await fetch_bank(db_session, "trivia", locale="fr")
        row = next(r for r in bank if r["id"] == str(q.id))
        assert row["display"]["options"] == q.payload["options"]

    async def test_the_translated_answer_still_scores_correctly(
        self, db_session: AsyncSession
    ) -> None:
        """End-to-end of the invariant: the shuffled French option at the served correctIndex is the
        translation of the English correct answer."""
        q = await self._seed(
            db_session,
            prompt="Quel gaz ?",
            options=["Oxygène", "Azote", "Dioxyde de carbone", "Hydrogène"],
            status="approved",
        )
        bank = await fetch_bank(db_session, "trivia", locale="fr")
        row = next(r for r in bank if r["id"] == str(q.id))

        for seed in range(25):  # every shuffle permutation must hold, not just a lucky one
            spec, answer = trivia_spec(row, shuffle_seed=seed)
            assert spec["options"][answer["correctIndex"]] == "Dioxyde de carbone"
            assert set(spec["options"]) == set(row["display"]["options"])


# ---------------------------------------------------------------- publishing (status only)


@pytest.mark.asyncio
class TestApproveCleanTranslations:
    async def _row(self, session: AsyncSession, flags: list[str], status: str = "draft") -> Any:
        q = _question()
        session.add(q)
        await session.flush()
        tr = QuestionTranslation(
            question_id=q.id,
            locale="es",
            prompt="¿Qué gas?",
            options=["Oxígeno", "Nitrógeno", "Dióxido de carbono", "Hidrógeno"],
            explanation="nota",
            status=status,
            source="machine",
            flags=flags,
            model="hand-off",
        )
        session.add(tr)
        await session.flush()
        return q, tr

    async def test_publishes_clean_rows_and_leaves_risk_flagged_in_draft(
        self, db_session: AsyncSession
    ) -> None:
        _, clean = await self._row(db_session, [])
        _, info = await self._row(db_session, ["proper_nouns_only"])
        _, risky = await self._row(db_session, ["us_centric"])

        report = await approve_clean_translations(db_session, "es")
        assert (report.approved, report.left_draft) == (2, 1)
        assert clean.status == "approved"
        assert info.status == "approved", "an informational flag does not block publishing"
        assert risky.status == "draft", "a risk flag must never be auto-approved"

    async def test_changes_NOTHING_except_status(self, db_session: AsyncSession) -> None:
        """The guarantee this operation is asked to make: no content is rewritten."""
        q, tr = await self._row(db_session, [])
        before = {
            "question_id": tr.question_id,
            "prompt": tr.prompt,
            "options": list(tr.options),
            "explanation": tr.explanation,
            "flags": list(tr.flags),
            "source": tr.source,
            "model": tr.model,
            "locale": tr.locale,
            # the English source row
            "en_payload": json.loads(json.dumps(q.payload)),
        }

        await approve_clean_translations(db_session, "es")

        assert tr.status == "approved"
        assert tr.question_id == before["question_id"]
        assert tr.prompt == before["prompt"]
        assert list(tr.options) == before["options"], "option ORDER must be untouched"
        assert tr.explanation == before["explanation"]
        assert list(tr.flags) == before["flags"]
        assert tr.source == before["source"] and tr.model == before["model"]
        assert tr.locale == before["locale"]
        # English source, including correctIndex, is never written by this path.
        assert q.payload == before["en_payload"]
        assert q.payload["correctIndex"] == 2

    async def test_dry_run_writes_nothing(self, db_session: AsyncSession) -> None:
        _, clean = await self._row(db_session, [])
        report = await approve_clean_translations(db_session, "es", dry_run=True)
        assert report.approved == 1
        assert clean.status == "draft", "dry run must not mutate"

    async def test_leaves_already_approved_and_rejected_rows_alone(
        self, db_session: AsyncSession
    ) -> None:
        _, done = await self._row(db_session, [], status="approved")
        report = await approve_clean_translations(db_session, "es")
        assert report.approved == 0 and report.left_draft == 0
        assert done.status == "approved"

    async def test_scopes_to_one_locale(self, db_session: AsyncSession) -> None:
        _, es_row = await self._row(db_session, [])
        q2 = _question()
        db_session.add(q2)
        await db_session.flush()
        fr_row = QuestionTranslation(
            question_id=q2.id, locale="fr", prompt="p", options=["a", "b", "c", "d"]
        )
        db_session.add(fr_row)
        await db_session.flush()

        await approve_clean_translations(db_session, "es")
        assert es_row.status == "approved"
        assert fr_row.status == "draft", "another locale must not be touched"

    async def test_include_flagged_publishes_reviewed_risk_rows(
        self, db_session: AsyncSession
    ) -> None:
        """Opt-in override for rows a human has already read and accepted.

        Holding a reviewed row back is not neutral: a draft is not skipped, it is served in ENGLISH
        mid-run. So once someone has read it, publishing the sound translation beats shipping the
        English original.
        """
        _, risky = await self._row(db_session, ["us_centric"])
        report = await approve_clean_translations(db_session, "es", include_flagged=True)
        assert (report.approved, report.left_draft) == (1, 0)
        assert risky.status == "approved"
        assert risky.flags == ["us_centric"], "the flag is kept as metadata, not erased"

    async def test_include_flagged_is_NOT_the_default(self, db_session: AsyncSession) -> None:
        _, risky = await self._row(db_session, ["us_centric"])
        await approve_clean_translations(db_session, "es")
        assert risky.status == "draft"

    async def test_category_scoping_publishes_only_the_named_slice(
        self, db_session: AsyncSession
    ) -> None:
        """A locale can hold drafts from different sources; publishing must be scopeable to the
        slice the reviewer actually vouched for."""
        sci_q, sci_tr = await self._row(db_session, [])
        sci_q.category = "Science & Nature"
        other_q, other_tr = await self._row(db_session, [])
        other_q.category = "Sports"
        await db_session.flush()

        report = await approve_clean_translations(db_session, "es", exclude=["Science & Nature"])
        assert report.approved == 1
        assert other_tr.status == "approved"
        assert sci_tr.status == "draft", "the excluded category must be untouched"

    async def test_category_include_is_the_inverse(self, db_session: AsyncSession) -> None:
        sci_q, sci_tr = await self._row(db_session, [])
        sci_q.category = "Science & Nature"
        other_q, other_tr = await self._row(db_session, [])
        other_q.category = "Sports"
        await db_session.flush()

        await approve_clean_translations(db_session, "es", categories=["Science & Nature"])
        assert sci_tr.status == "approved"
        assert other_tr.status == "draft"
