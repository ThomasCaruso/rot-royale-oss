"""Batch translation of the trivia bank (CLI only — NEVER called during gameplay).

English is canonical. This produces `question_translations` rows that the serving path overlays on
top of the bank (see `content.loader.fetch_bank`). Nothing here runs on a request path: a Daily
Royale must be byte-identical for every entrant, so translations are precomputed, reviewed, and
served deterministically.

Operational rules (mirrors ai_classifier):
- Gated on `settings.ai_classification_ready` — same provider credentials.
- Idempotent: a question already translated into a locale is skipped unless `force=True`. A row
  written by a HUMAN is never overwritten by a machine re-run.
- Rows land as `status='draft'` by default, so machine output cannot reach a player until reviewed.
- Strict JSON only; every response is structurally validated before it is stored.

THE INVARIANT THAT MATTERS: `payload["correctIndex"]` is positional, and `trivia_spec` shuffles the
options and remaps the answer by original index. A translation is therefore only usable if it has
EXACTLY the same number of options in EXACTLY the same order. The model is told to preserve order,
and `validate_translation` enforces it — a response with a different option count is a hard failure,
never a stored row. Reordering cannot be detected mechanically, which is precisely why machine rows
are staged as drafts rather than published.

Entry point: `python -m app.jobs.run translate --locale fr [--limit N] [--force] [--dry-run]
             [--category NAME] [--id UUID] [--approve] [--sleep-ms N] [--max-errors N] [--coverage]`
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Question, QuestionTranslation
from app.models.question import SERVABLE_STATUSES
from app.models.question_translation import TRANSLATION_LOCALES
from app.services.ai_classifier import (
    AIClassifierUnavailable,
    ChatClient,
    OpenAICompatChat,
    default_chat_client,
)

logger = logging.getLogger(__name__)

TRANSLATION_VERSION = "v1"

LANGUAGE_NAMES = {"es": "Spanish", "fr": "French", "tr": "Turkish"}

# Flags the model may report. We never silently drop a question that resists translation, because a
# broken trivia question is worse than an English one.
#
# RISK flags mean the question may no longer be ANSWERABLE in the target language — a human must
# look before it is served. INFO flags are observations that carry no correctness risk:
# `proper_nouns_only` just means the question was mostly names, so there was little to translate.
# The split matters because the benign flag dominates in practice (it was 9 of 9 on the first
# Science batch); treating it as blocking would send a third of a clean bank to manual review for
# nothing.
RISK_FLAGS = frozenset(
    {
        "wordplay",  # pun / rhyme / anagram that does not survive translation
        "english_spelling",  # asks about English letters/spelling specifically
        "us_centric",  # assumes US schooling/geography/culture knowledge
        "ambiguous_after_translation",  # two options collapse to the same meaning
    }
)
INFO_FLAGS = frozenset({"proper_nouns_only"})
KNOWN_FLAGS = RISK_FLAGS | INFO_FLAGS

SYSTEM_PROMPT = """You translate multiple-choice trivia questions. You output JSON only.

Rules, in priority order:
1. PRESERVE OPTION ORDER AND COUNT EXACTLY. The options array you return must have the same number
   of items as the input, and item i must be the translation of input item i. The correct answer is
   tracked by POSITION on our side; reordering silently breaks scoring. Never sort, merge, drop, or
   add an option.
2. Keep every option DISTINCT. If two options would translate to the same string, keep them
   distinguishable and add the flag "ambiguous_after_translation".
3. Do not change the ANSWER. Translate meaning faithfully; never make a wrong option correct or a
   correct option wrong. Keep numbers, dates and units identical.
4. Leave proper nouns (people, places, brands, titles of works) in their conventional form for the
   target language — translate a title only if that language has a standard translated title.
5. Match the register: casual, punchy quiz language, not formal prose. Keep options short.
6. NEVER use gambling or money framing (betting, casino, lottery, prizes, cash). This is a
   cosmetic-currency game and that language is prohibited in every language we ship.

Report anything that did not survive translation cleanly using the `flags` array. Valid flags:
wordplay, english_spelling, us_centric, ambiguous_after_translation, proper_nouns_only.

Respond with EXACTLY this JSON shape and nothing else:
{"prompt": "...", "options": ["...", "..."], "explanation": "...", "flags": ["..."]}"""


class TranslationError(Exception):
    """One question failed to translate (bad model output or provider error)."""


def chat_client(*, timeout_ms: int | None = None, max_retries: int | None = None) -> ChatClient:
    """Provider client with per-run timeout/retry overrides.

    Tuning these matters more than it looks. The provider's failure mode is a STALL, not an error:
    a healthy translation returns in ~2-5s, but under sustained load some calls hang until the
    socket times out. With the default 60s timeout, every stall costs a full minute before the retry
    — which is why a 122-question category took an hour. A shorter timeout with more retries is
    strictly better against that behaviour: it abandons a call that was never going to answer and
    tries again, while still covering the genuine slow tail (measured up to ~22s).

    Overriding here rather than in `.env` keeps the change scoped to one run — the `classify` job
    shares those settings and does not want them.
    """
    if not settings.ai_classification_ready:
        raise AIClassifierUnavailable(
            "AI translation is not configured. Set ROT_AI_ENABLED=true and provide "
            "ROT_AI_API_KEY, ROT_AI_BASE_URL, and ROT_AI_MODEL in backend/.env."
        )
    if timeout_ms is None and max_retries is None:
        return default_chat_client()
    return OpenAICompatChat(
        base_url=settings.rot_ai_base_url,
        api_key=settings.rot_ai_api_key,
        model=settings.rot_ai_model,
        temperature=settings.rot_ai_classification_temperature,
        timeout_ms=(
            timeout_ms if timeout_ms is not None else settings.rot_ai_classification_timeout_ms
        ),
        max_retries=max_retries if max_retries is not None else settings.rot_ai_max_retries,
    )


@dataclass
class TranslationReport:
    locale: str
    translated: int = 0
    skipped: int = 0
    failed: int = 0
    flagged: int = 0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        base = (
            f"locale={self.locale} translated={self.translated} skipped={self.skipped} "
            f"flagged={self.flagged} failed={self.failed}"
        )
        return base if not self.errors else f"{base}\n  " + "\n  ".join(self.errors[:20])


def build_user_prompt(question: Question, locale: str) -> str:
    payload = question.payload
    target = LANGUAGE_NAMES.get(locale, locale)
    body: dict[str, Any] = {
        "target_language": target,
        "category": question.category,
        "prompt": payload["prompt"],
        "options": list(payload["options"]),
        "explanation": question.explanation or "",
    }
    return (
        f"Translate this trivia question into {target}.\n"
        f"Return {len(body['options'])} options, in the same order.\n\n"
        f"{json.dumps(body, ensure_ascii=False, indent=2)}"
    )


def validate_translation(raw: str, source_options: list[Any]) -> dict[str, Any]:
    """Parse + structurally validate a model response. Raises TranslationError on anything unusable.

    The option-count check is the load-bearing one: `correctIndex` is positional, so a translation
    with a different number of options can never be served safely.
    """
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise TranslationError(f"response was not JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise TranslationError("response was not a JSON object")

    prompt = data.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise TranslationError("missing/empty prompt")

    options = data.get("options")
    if not isinstance(options, list):
        raise TranslationError("options was not a list")
    if len(options) != len(source_options):
        raise TranslationError(
            f"option count changed ({len(source_options)} -> {len(options)}); "
            "correctIndex is positional so this can never be served"
        )
    cleaned: list[str] = []
    for i, opt in enumerate(options):
        if not isinstance(opt, str) or not opt.strip():
            raise TranslationError(f"option {i} was empty or not a string")
        cleaned.append(opt.strip())
    if len({o.casefold() for o in cleaned}) != len(cleaned):
        raise TranslationError("options collapsed to duplicates after translation")

    explanation = data.get("explanation")
    if explanation is not None and not isinstance(explanation, str):
        raise TranslationError("explanation was not a string")

    flags_raw = data.get("flags") or []
    if not isinstance(flags_raw, list):
        raise TranslationError("flags was not a list")
    flags = sorted({str(f) for f in flags_raw if str(f) in KNOWN_FLAGS})

    return {
        "prompt": prompt.strip(),
        "options": cleaned,
        "explanation": (explanation or "").strip() or None,
        "flags": flags,
    }


async def _pending_questions(
    session: AsyncSession,
    locale: str,
    *,
    limit: int | None,
    force: bool,
    category: str | None,
    question_id: uuid.UUID | None,
) -> list[Question]:
    stmt = select(Question).where(
        Question.module_type == "trivia",
        Question.status.in_(SERVABLE_STATUSES),
    )
    if category is not None:
        stmt = stmt.where(Question.category == category)
    if question_id is not None:
        stmt = stmt.where(Question.id == question_id)
    if not force:
        # Skip questions that already have ANY row for this locale (draft or approved) — a re-run
        # should not silently duplicate work or overwrite a review in progress.
        done = select(QuestionTranslation.question_id).where(QuestionTranslation.locale == locale)
        stmt = stmt.where(Question.id.not_in(done))
    stmt = stmt.order_by(Question.id)
    if limit is not None:
        stmt = stmt.limit(limit)
    return list((await session.execute(stmt)).scalars().all())


async def translate_batch(
    session: AsyncSession,
    locale: str,
    *,
    client: ChatClient | None = None,
    limit: int | None = None,
    force: bool = False,
    dry_run: bool = False,
    approve: bool = False,
    category: str | None = None,
    question_id: uuid.UUID | None = None,
    sleep_ms: int = 0,
    max_errors: int | None = None,
    on_checkpoint: Callable[[], Awaitable[None]] | None = None,
    checkpoint_every: int = 20,
) -> TranslationReport:
    """Translate servable trivia questions into `locale`.

    Commits only via `on_checkpoint` (the CLI passes `session.commit`). A full-bank run is hundreds
    of paid API calls over many minutes, so progress is flushed every `checkpoint_every` questions.
    Without it, a provider outage at question 300 would discard 299 good translations. A re-run then
    resumes where it stopped: already-translated questions are skipped by default.
    """
    if locale not in TRANSLATION_LOCALES:
        raise TranslationError(
            f"unsupported locale {locale!r} (expected one of {', '.join(TRANSLATION_LOCALES)})"
        )
    chat = client or default_chat_client()
    report = TranslationReport(locale=locale)

    questions = await _pending_questions(
        session, locale, limit=limit, force=force, category=category, question_id=question_id
    )
    for q in questions:
        source_options = list(q.payload.get("options", []))
        try:
            raw = await chat.complete(SYSTEM_PROMPT, build_user_prompt(q, locale))
            result = validate_translation(raw, source_options)
        except Exception as exc:  # provider error or unusable output — reported, never stored
            report.failed += 1
            report.errors.append(f"{q.id}: {exc}")
            if max_errors is not None and report.failed >= max_errors:
                report.errors.append(f"aborted after {report.failed} errors")
                break
            continue

        if set(result["flags"]) & RISK_FLAGS:
            report.flagged += 1  # counts REVIEW-worthy rows only, not informational notes
        if dry_run:
            report.translated += 1
            continue

        existing = (
            await session.execute(
                select(QuestionTranslation).where(
                    QuestionTranslation.question_id == q.id,
                    QuestionTranslation.locale == locale,
                )
            )
        ).scalar_one_or_none()

        # Never let a machine re-run clobber a human translation.
        if existing is not None and existing.source == "human":
            report.skipped += 1
            continue

        # A RISK-flagged row always stays draft: it is exactly the case a human must look at. An
        # info-only flag (proper_nouns_only) is recorded but does not block --approve.
        risky = bool(set(result["flags"]) & RISK_FLAGS)
        status = "approved" if (approve and not risky) else "draft"
        if existing is None:
            session.add(
                QuestionTranslation(
                    question_id=q.id,
                    locale=locale,
                    prompt=result["prompt"],
                    options=result["options"],
                    explanation=result["explanation"],
                    status=status,
                    source="machine",
                    flags=result["flags"],
                    model=settings.rot_ai_model,
                )
            )
        else:
            existing.prompt = result["prompt"]
            existing.options = result["options"]
            existing.explanation = result["explanation"]
            existing.status = status
            existing.flags = result["flags"]
            existing.model = settings.rot_ai_model
        report.translated += 1

        if on_checkpoint is not None and report.translated % checkpoint_every == 0:
            await on_checkpoint()
            logger.info(
                "translate[%s]: %d/%d committed (flagged=%d failed=%d)",
                locale,
                report.translated,
                len(questions),
                report.flagged,
                report.failed,
            )

        if sleep_ms:
            await asyncio.sleep(sleep_ms / 1000)

    if on_checkpoint is not None:
        await on_checkpoint()
    return report


@dataclass
class ApprovalReport:
    locale: str
    approved: int = 0
    left_draft: int = 0

    def summary(self) -> str:
        return (
            f"locale={self.locale} approved={self.approved} left_draft={self.left_draft} "
            "(risk-flagged rows are never auto-approved)"
        )


async def approve_clean_translations(
    session: AsyncSession,
    locale: str,
    *,
    dry_run: bool = False,
    include_flagged: bool = False,
    categories: list[str] | None = None,
    exclude: list[str] | None = None,
) -> ApprovalReport:
    """Publish draft translations that carry NO risk flag. Status only — nothing else is touched.

    This is deliberately the narrowest possible write: it assigns `status` and never reads or
    reassigns `prompt`, `options`, `explanation`, `flags`, `question_id`, `source` or `model`,
    and it does not touch the `questions` table at all. So option ORDER is preserved by
    construction, and `payload["correctIndex"]` — which lives on the English row — cannot move.

    A row is publishable only if it is currently `draft` and carries no flag in RISK_FLAGS.
    Informational flags (`proper_nouns_only`) do not block. Rows already `approved` or
    `rejected` are left alone.

    `include_flagged` publishes risk-flagged rows too. It exists for the case where a human has
    ALREADY read them and judged the translations sound — a risk flag marks "a person should look",
    not "this is broken", and once someone has looked, holding the row back has a cost of its own:
    a draft is not skipped, it is served in ENGLISH mid-run (see `content.loader.fetch_bank`). So an
    unreviewed flag and a reviewed-and-accepted flag need different outcomes. It is deliberately
    opt-in and never the default; the flags stay on the row as metadata either way.
    """
    if locale not in TRANSLATION_LOCALES:
        raise TranslationError(
            f"unsupported locale {locale!r} (expected one of {', '.join(TRANSLATION_LOCALES)})"
        )
    stmt = select(QuestionTranslation).where(
        QuestionTranslation.locale == locale,
        QuestionTranslation.status == "draft",
    )
    # Category scoping matters because a locale's drafts can come from different sources with
    # different provenance — a reviewed hand-off drop and a machine batch can sit side by side in
    # one locale. Publishing "everything drafted" would silently promote content the reviewer never
    # looked at, so the caller can name exactly which slice they are vouching for.
    if categories or exclude:
        scoped = select(Question.id).where(Question.module_type == "trivia")
        if categories:
            scoped = scoped.where(Question.category.in_(categories))
        if exclude:
            scoped = scoped.where(Question.category.not_in(exclude))
        stmt = stmt.where(QuestionTranslation.question_id.in_(scoped))
    rows = list((await session.execute(stmt)).scalars())
    report = ApprovalReport(locale=locale)
    for row in rows:
        if not include_flagged and set(row.flags or []) & RISK_FLAGS:
            report.left_draft += 1
            continue
        report.approved += 1
        if not dry_run:
            row.status = "approved"  # the ONLY field this function assigns
    return report


async def coverage_report(session: AsyncSession) -> dict[str, Any]:
    """How much of the servable bank is translated, per locale — no LLM, no credentials needed."""
    total = (
        await session.execute(
            select(func.count())
            .select_from(Question)
            .where(Question.module_type == "trivia", Question.status.in_(SERVABLE_STATUSES))
        )
    ).scalar_one()
    rows = (
        await session.execute(
            select(
                QuestionTranslation.locale,
                QuestionTranslation.status,
                func.count(),
            ).group_by(QuestionTranslation.locale, QuestionTranslation.status)
        )
    ).all()
    by_locale: dict[str, dict[str, int]] = {
        loc: {"draft": 0, "approved": 0, "rejected": 0} for loc in TRANSLATION_LOCALES
    }
    for loc, status, count in rows:
        by_locale.setdefault(loc, {"draft": 0, "approved": 0, "rejected": 0})[status] = count
    flagged = (
        await session.execute(
            select(QuestionTranslation.locale, func.count())
            .where(func.jsonb_array_length(QuestionTranslation.flags) > 0)
            .group_by(QuestionTranslation.locale)
        )
    ).all()
    return {
        "servable_questions": total,
        "locales": by_locale,
        "flagged": {loc: n for loc, n in flagged},
    }


__all__ = [
    "AIClassifierUnavailable",
    "TranslationError",
    "TranslationReport",
    "coverage_report",
    "translate_batch",
    "validate_translation",
]
