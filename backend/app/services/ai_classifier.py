"""LLM question classification (batch/CLI only — NEVER called during gameplay).

"LLM categorizes the questions. Gameplay categorizes the user. The recommendation engine matches
both." This module is the first leg: it sends one bank question at a time to an OpenAI-compatible
chat-completions endpoint and stores the validated result in `question_ai_metadata`.

Operational rules:
- Gated on `settings.ai_classification_ready` (ROT_AI_ENABLED + key + base URL + model). When not
  ready, the default path raises `AIClassifierUnavailable` with a clear message — the app itself
  never depends on this module at runtime.
- Idempotent: a question with existing metadata is skipped unless force=True.
- `CLASSIFICATION_VERSION` is stored per row so a future prompt change can re-run selectively.
- Strict JSON only: output is parsed and validated through `AIMetadataPayload`; anything malformed
  is reported as a failure, never stored.

Entry points: `python -m app.jobs.run classify [--limit N] [--force] [--dry-run] [--id UUID]
              [--category NAME] [--sleep-ms N] [--max-errors N] [--coverage]`.
"""

from __future__ import annotations

import asyncio
import collections.abc
import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Protocol

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Question, QuestionAIMetadata
from app.schemas.ai_metadata import MIN_CONFIDENCE, AIMetadataPayload

logger = logging.getLogger(__name__)

CLASSIFICATION_VERSION = "v1"

SYSTEM_PROMPT = (
    "You classify trivia questions for a personalization engine. Return strict JSON only. "
    "No markdown. No commentary. Do not invent facts. If the question is ambiguous, outdated, "
    "poorly written, or could have multiple correct answers, increase ambiguity_risk and set "
    "needs_review accordingly."
)

_USER_PROMPT_TEMPLATE = """Classify this trivia question for a mobile trivia game.

Question:
{question_text}

Choices:
{choices}

Correct answer:
{correct_answer}

Explanation:
{explanation}

Return this exact JSON shape:
{{
  "category": string,
  "subcategory": string | null,
  "topic_tags": string[],
  "audience_tags": string[],
  "related_topics": string[],
  "difficulty_score": number,
  "knowledge_type": "common_knowledge" | "specific_fact" | "niche_fact" | "logic" | "visual" |
    "current_event" | "wordplay" | "other",
  "freshness_type": "evergreen" | "recent" | "time_sensitive" | "outdated_risk",
  "humor_score": number,
  "brainrot_score": number,
  "educational_score": number,
  "controversy_risk": number,
  "ambiguity_risk": number,
  "quality_score": number,
  "llm_confidence": number,
  "needs_review": boolean
}}

Scoring:
- difficulty_score: 0 very easy, 1 extremely hard
- humor_score: 0 not funny, 1 highly comedic
- brainrot_score: 0 serious/classic trivia, 1 very internet/meme/brainrot
- educational_score: 0 pure fluff, 1 teaches meaningful knowledge
- controversy_risk: risk of sensitive/disputed content
- ambiguity_risk: risk of multiple answers or unclear wording
- quality_score: clarity, fairness, and trivia value
- llm_confidence: your confidence in the classification

Rules:
- Return JSON only.
- Use concise, canonical tags.
- Do not include more than 8 topic_tags.
- Avoid overly broad topic tags when specific ones are obvious.
- Set needs_review=true for ambiguous, outdated, too niche, poor-quality, or risky questions.

Existing category (for reference, you may refine the subcategory): {existing_category}
"""


class AIClassifierUnavailable(RuntimeError):
    """Classification cannot run (flag off / credentials missing). The app still works."""


class ClassificationError(RuntimeError):
    """One question failed to classify (bad LLM output or provider error)."""


class ChatClient(Protocol):
    """Minimal chat interface so tests can inject a fake and hit no network."""

    async def complete(self, system: str, user: str) -> str: ...


class OpenAICompatChat:
    """OpenAI-compatible /chat/completions client (base URL + key + model from settings)."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        temperature: float,
        timeout_ms: int,
        max_retries: int,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.temperature = temperature
        self.timeout_s = timeout_ms / 1000
        self.max_retries = max_retries

    async def complete(self, system: str, user: str) -> str:
        body = {
            "model": self.model,
            "temperature": self.temperature,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                    resp = await client.post(
                        f"{self.base_url}/chat/completions",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        json=body,
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    return str(data["choices"][0]["message"]["content"])
            except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
                last_error = exc
                logger.warning(
                    "LLM call failed (attempt %d/%d): %s", attempt + 1, self.max_retries + 1, exc
                )
                if attempt < self.max_retries:
                    await asyncio.sleep(1.0 * (attempt + 1))
        raise ClassificationError(f"LLM request failed after retries: {last_error}")


def default_chat_client() -> OpenAICompatChat:
    if not settings.ai_classification_ready:
        raise AIClassifierUnavailable(
            "AI classification is not configured. Set ROT_AI_ENABLED=true and provide "
            "ROT_AI_API_KEY, ROT_AI_BASE_URL, and ROT_AI_MODEL in backend/.env "
            "(see backend/.env.example). The app runs fine without them."
        )
    return OpenAICompatChat(
        base_url=settings.rot_ai_base_url,
        api_key=settings.rot_ai_api_key,
        model=settings.rot_ai_model,
        temperature=settings.rot_ai_classification_temperature,
        timeout_ms=settings.rot_ai_classification_timeout_ms,
        max_retries=settings.rot_ai_max_retries,
    )


def build_user_prompt(question: Question) -> str:
    payload = question.payload
    options: list[str] = list(payload.get("options", []))
    correct_index = int(payload.get("correctIndex", 0))
    choices = "\n".join(f"{chr(65 + i)}. {opt}" for i, opt in enumerate(options))
    correct = options[correct_index] if 0 <= correct_index < len(options) else ""
    return _USER_PROMPT_TEMPLATE.format(
        question_text=payload.get("prompt", ""),
        choices=choices,
        correct_answer=correct,
        explanation=question.explanation or "(none)",
        existing_category=question.category,
    )


def _parse_llm_json(content: str) -> AIMetadataPayload:
    """Strict-JSON parse with a defensive fence strip (some providers wrap despite instructions)."""
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ClassificationError(f"LLM did not return valid JSON: {exc}") from exc
    try:
        return AIMetadataPayload.model_validate(raw)
    except Exception as exc:
        raise ClassificationError(f"LLM JSON failed validation: {exc}") from exc


def _apply_payload(row: QuestionAIMetadata, payload: AIMetadataPayload, raw: str) -> None:
    row.category = payload.category
    row.subcategory = payload.subcategory
    row.topic_tags = list(payload.topic_tags)  # reassign, never mutate (JSONB tracking)
    row.audience_tags = list(payload.audience_tags)
    row.related_topics = list(payload.related_topics)
    row.difficulty_score = payload.difficulty_score
    row.knowledge_type = payload.knowledge_type
    row.freshness_type = payload.freshness_type
    row.humor_score = payload.humor_score
    row.brainrot_score = payload.brainrot_score
    row.educational_score = payload.educational_score
    row.controversy_risk = payload.controversy_risk
    row.ambiguity_risk = payload.ambiguity_risk
    row.quality_score = payload.quality_score
    row.llm_confidence = payload.llm_confidence
    row.needs_review = payload.needs_review
    row.model_name = settings.rot_ai_model or None
    row.provider_name = settings.rot_ai_provider
    row.raw_llm_json = json.loads(json.dumps(payload.model_dump())) | {"_raw": raw[:4000]}
    row.classification_version = CLASSIFICATION_VERSION


async def classify_question(
    session: AsyncSession,
    question: Question,
    *,
    force: bool = False,
    chat: ChatClient | None = None,
) -> str:
    """Classify ONE question. Returns "classified" | "updated" | "skipped". Does not commit."""
    existing = await session.scalar(
        select(QuestionAIMetadata).where(QuestionAIMetadata.question_id == question.id)
    )
    if existing is not None and not force:
        return "skipped"

    client = chat if chat is not None else default_chat_client()
    content = await client.complete(SYSTEM_PROMPT, build_user_prompt(question))
    payload = _parse_llm_json(content)

    if existing is None:
        row = QuestionAIMetadata(question_id=question.id)
        _apply_payload(row, payload, content)
        session.add(row)
        await session.flush()
        return "classified"
    _apply_payload(existing, payload, content)
    await session.flush()
    return "updated"


@dataclass
class ClassifyReport:
    candidates: int = 0
    classified: int = 0
    updated: int = 0
    skipped: int = 0
    dry_run: bool = False
    failed: list[tuple[str, str]] = field(default_factory=list)  # (question_id, reason)

    def summary(self) -> str:
        head = "DRY RUN — " if self.dry_run else ""
        return (
            f"{head}candidates={self.candidates} classified={self.classified} "
            f"updated={self.updated} skipped={self.skipped} failed={len(self.failed)}"
        )


async def classify_batch(
    session: AsyncSession,
    *,
    limit: int | None = None,
    force: bool = False,
    dry_run: bool = False,
    question_id: uuid.UUID | None = None,
    chat: ChatClient | None = None,
    category: str | None = None,
    sleep_ms: int = 0,
    max_errors: int | None = None,
    on_checkpoint: collections.abc.Callable[[], collections.abc.Awaitable[None]] | None = None,
) -> ClassifyReport:
    """Classify unclassified trivia questions (or one by id / all with force). Does not commit.

    dry_run lists what WOULD be classified — no LLM calls, no writes, no credentials needed.
    on_checkpoint (if set) is awaited after each flush — the CLI passes session.commit so progress
    is durable across interrupts. Tests omit it → no commit → transaction isolation preserved.
    category restricts classification to one canonical category.
    sleep_ms inserts a delay after each question (rate-limit friendliness).
    max_errors aborts early when the failure count reaches the limit.
    """
    report = ClassifyReport(dry_run=dry_run)

    stmt = select(Question).where(Question.module_type == "trivia").order_by(Question.id)
    if question_id is not None:
        stmt = stmt.where(Question.id == question_id)
    elif not force:
        classified_ids = select(QuestionAIMetadata.question_id)
        stmt = stmt.where(Question.id.not_in(classified_ids))
    if category is not None:
        stmt = stmt.where(Question.category == category)
    if limit is not None:
        stmt = stmt.limit(limit)
    questions = (await session.execute(stmt)).scalars().all()
    report.candidates = len(questions)

    if dry_run:
        return report

    # Fail fast (before any LLM spend) when the default client would be needed but isn't ready.
    client = chat if chat is not None else default_chat_client()

    for i, q in enumerate(questions):
        try:
            outcome = await classify_question(session, q, force=force, chat=client)
        except ClassificationError as exc:
            logger.error("classification failed for question %s: %s", q.id, exc)
            report.failed.append((str(q.id), str(exc)))
        else:
            if outcome == "classified":
                report.classified += 1
            elif outcome == "updated":
                report.updated += 1
            else:
                report.skipped += 1

        if sleep_ms > 0:
            await asyncio.sleep(sleep_ms / 1000)

        if max_errors is not None and len(report.failed) >= max_errors:
            logger.error("classify aborting: reached max_errors=%d", max_errors)
            break

        if (i + 1) % max(1, settings.rot_ai_batch_size) == 0:
            await session.flush()
            if on_checkpoint is not None:
                await on_checkpoint()
            logger.info(
                "classify progress: %d/%d (classified=%d failed=%d)",
                i + 1,
                len(questions),
                report.classified + report.updated,
                len(report.failed),
            )

    await session.flush()
    if on_checkpoint is not None:
        await on_checkpoint()
    return report


async def ai_metadata_coverage(session: AsyncSession) -> float:
    """Fraction (0..1) of trivia questions that have an AI-metadata row. 0.0 when there are none."""
    total = await session.scalar(
        select(func.count(Question.id)).where(Question.module_type == "trivia")
    )
    if not total:
        return 0.0
    classified = await session.scalar(
        select(func.count(QuestionAIMetadata.id)).where(
            QuestionAIMetadata.question_id.in_(
                select(Question.id).where(Question.module_type == "trivia")
            )
        )
    )
    return (classified or 0) / total


@dataclass
class CoverageReport:
    total: int
    classified: int
    unclassified: int
    coverage: float  # 0..1
    by_category: dict[str, tuple[int, int]]  # category -> (classified, total)
    needs_review: int
    low_confidence: int  # llm_confidence < MIN_CONFIDENCE

    def summary(self) -> str:
        lines = [
            f"AI Metadata Coverage: {self.classified}/{self.total} ({self.coverage:.1%})",
            f"  unclassified: {self.unclassified}",
            f"  needs_review: {self.needs_review}  low_confidence: {self.low_confidence}",
            "",
            "  By category:",
        ]
        for cat, (cls, tot) in sorted(self.by_category.items()):
            pct = cls / tot if tot else 0.0
            lines.append(f"    {cat}: {cls}/{tot} ({pct:.1%})")
        return "\n".join(lines)


async def coverage_report(session: AsyncSession) -> CoverageReport:
    """Aggregate coverage stats: total trivia, classified, per-category, review flags."""
    # Total trivia questions
    total: int = (
        await session.scalar(
            select(func.count(Question.id)).where(Question.module_type == "trivia")
        )
        or 0
    )

    classified_subq = select(QuestionAIMetadata.question_id)

    # Questions with a metadata row
    classified: int = (
        await session.scalar(
            select(func.count(Question.id))
            .where(Question.module_type == "trivia")
            .where(Question.id.in_(classified_subq))
        )
        or 0
    )

    # Per-category totals
    cat_total_rows = (
        await session.execute(
            select(Question.category, func.count(Question.id))
            .where(Question.module_type == "trivia")
            .group_by(Question.category)
        )
    ).all()

    # Per-category classified counts
    cat_classified_rows = (
        await session.execute(
            select(Question.category, func.count(Question.id))
            .where(Question.module_type == "trivia")
            .where(Question.id.in_(classified_subq))
            .group_by(Question.category)
        )
    ).all()

    cat_total_map = {cat: cnt for cat, cnt in cat_total_rows}
    cat_cls_map = {cat: cnt for cat, cnt in cat_classified_rows}
    by_category: dict[str, tuple[int, int]] = {
        cat: (cat_cls_map.get(cat, 0), tot) for cat, tot in cat_total_map.items()
    }

    # Metadata quality flags (trivia questions only)
    trivia_meta_subq = QuestionAIMetadata.question_id.in_(
        select(Question.id).where(Question.module_type == "trivia")
    )

    needs_review: int = (
        await session.scalar(
            select(func.count(QuestionAIMetadata.id))
            .where(QuestionAIMetadata.needs_review.is_(True))
            .where(trivia_meta_subq)
        )
        or 0
    )

    low_confidence: int = (
        await session.scalar(
            select(func.count(QuestionAIMetadata.id))
            .where(QuestionAIMetadata.llm_confidence < MIN_CONFIDENCE)
            .where(trivia_meta_subq)
        )
        or 0
    )

    return CoverageReport(
        total=total,
        classified=classified,
        unclassified=total - classified,
        coverage=classified / total if total else 0.0,
        by_category=by_category,
        needs_review=needs_review,
        low_confidence=low_confidence,
    )
