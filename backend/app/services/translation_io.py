"""Hand-off translation: export questions as paste-ready documents, import the results back.

The automated `translate` job is one way to fill `question_translations`; this is the other. It
produces a self-contained Markdown document per category that can be pasted into ChatGPT (or any
assistant), and ingests the JSON that comes back.

The round trip is the point — an export you cannot re-import is just a text file. Both halves share
`validate_translation`, so hand-driven output is held to exactly the same safety bar as the batch
job: same option count, same order, no duplicate options, and rows land as `status='draft'` until a
human approves them.

WHY THE DOCUMENT LOOKS THE WAY IT DOES:
- Every question carries its full `id`. That is what maps the reply back to a row; without it the
  import can only trust ordering, and a model that silently drops one question would shift every
  subsequent answer onto the wrong question.
- The option-order rule is stated first and repeated per question, because `correctIndex` is
  positional on our side. A reordered options array is the one failure mode that produces a
  plausible-looking translation that scores the wrong answer.
- Documents are CHUNKED. A whole category is 100+ questions, which routinely exceeds an assistant's
  output budget — and a truncated reply is worse than a refused one, because it looks complete.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Question, QuestionTranslation
from app.models.question import SERVABLE_STATUSES
from app.models.question_translation import TRANSLATION_LOCALES
from app.services.translator import (
    LANGUAGE_NAMES,
    RISK_FLAGS,
    TranslationError,
    validate_translation,
)

# How many questions per document. Sized so the JSON reply comfortably fits a single assistant
# response — a truncated reply is the main practical failure of this workflow.
DEFAULT_CHUNK = 40


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")


DOC_TEMPLATE = """# Translate to {language} — {category} ({part} of {parts})

Paste this whole file into ChatGPT. It will return one JSON array; save that reply as
`{outfile}` and import it with:

```
python -m app.jobs.run import-translations {outfile} --locale {locale}
```

---

## Instructions

Translate these {count} multiple-choice trivia questions into **{language}**.

**Rules, in priority order:**

1. **PRESERVE OPTION ORDER AND COUNT EXACTLY.** Each `options` array must come back with the same
   number of items, and item *i* must be the translation of item *i*. The correct answer is tracked
   by POSITION, so reordering silently makes the wrong answer correct. Never sort, merge, drop or
   add an option.
2. **Return every `id` unchanged.** It maps your reply back to the question.
3. **Do not change the answer.** Translate meaning faithfully; never make a wrong option right.
   Keep numbers, dates and units identical.
4. Leave proper nouns (people, places, brands, work titles) in their conventional {language} form —
   translate a title only where {language} has a standard translated title.
5. Casual, punchy quiz register. Keep options short.
6. **Never use gambling or money framing** (betting, casino, lottery, prizes, cash). This is a
   cosmetic-currency game and that language is prohibited in every language we ship.

Add a `flags` array to any question that did not survive translation cleanly. Valid values:
`wordplay`, `english_spelling`, `us_centric`, `ambiguous_after_translation`, `proper_nouns_only`.
Use `[]` when nothing is wrong.

**Reply with ONLY a JSON array, no commentary**, shaped exactly like this:

```json
[
  {{
    "id": "<unchanged>",
    "prompt": "...",
    "options": ["...", "..."],
    "explanation": "...",
    "flags": []
  }}
]
```

---

## Questions ({count})

```json
{payload}
```
"""


@dataclass
class ExportResult:
    files: list[Path]
    questions: int
    categories: list[str]


async def export_documents(
    session: AsyncSession,
    locale: str,
    out_dir: Path,
    *,
    categories: list[str] | None = None,
    exclude: list[str] | None = None,
    chunk: int = DEFAULT_CHUNK,
    include_translated: bool = False,
) -> ExportResult:
    """Write one or more paste-ready documents per category. Skips already-translated questions."""
    if locale not in TRANSLATION_LOCALES:
        raise TranslationError(
            f"unsupported locale {locale!r} (expected one of {', '.join(TRANSLATION_LOCALES)})"
        )
    language = LANGUAGE_NAMES.get(locale, locale)

    stmt = select(Question).where(
        Question.module_type == "trivia",
        Question.status.in_(SERVABLE_STATUSES),
    )
    if categories:
        stmt = stmt.where(Question.category.in_(categories))
    if exclude:
        stmt = stmt.where(Question.category.not_in(exclude))
    if not include_translated:
        done = select(QuestionTranslation.question_id).where(QuestionTranslation.locale == locale)
        stmt = stmt.where(Question.id.not_in(done))
    rows = list((await session.execute(stmt.order_by(Question.category, Question.id))).scalars())

    by_category: dict[str, list[Question]] = {}
    for q in rows:
        by_category.setdefault(q.category, []).append(q)

    out_dir.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []
    for category, questions in sorted(by_category.items()):
        slug = slugify(category)
        parts = (len(questions) + chunk - 1) // chunk
        for idx in range(parts):
            batch = questions[idx * chunk : (idx + 1) * chunk]
            payload = [
                {
                    "id": str(q.id),
                    "prompt": q.payload["prompt"],
                    "options": list(q.payload["options"]),
                    "explanation": q.explanation or "",
                }
                for q in batch
            ]
            suffix = f"-part{idx + 1}" if parts > 1 else ""
            outfile = f"{locale}-{slug}{suffix}.json"
            doc = DOC_TEMPLATE.format(
                language=language,
                category=category,
                part=idx + 1,
                parts=parts,
                count=len(batch),
                locale=locale,
                outfile=outfile,
                payload=json.dumps(payload, ensure_ascii=False, indent=2),
            )
            path = out_dir / f"{locale}-{slug}{suffix}.md"
            path.write_text(doc, encoding="utf-8")
            files.append(path)

    return ExportResult(files=files, questions=len(rows), categories=sorted(by_category.keys()))


@dataclass
class ImportReport:
    locale: str
    imported: int = 0
    skipped: int = 0
    failed: int = 0
    flagged: int = 0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        base = (
            f"locale={self.locale} imported={self.imported} skipped={self.skipped} "
            f"flagged={self.flagged} failed={self.failed}"
        )
        if not self.errors:
            return base
        return f"{base}\n  " + "\n  ".join(self.errors[:20])


def _extract_json_array(text: str) -> list[Any]:
    """Pull the JSON array out of a reply, tolerating ```json fences and surrounding prose.

    Assistants routinely wrap the answer in a fenced block or add a sentence before it; refusing
    those would make the workflow needlessly brittle. Anything we cannot find an array in is a hard
    error, never a silent empty import.
    """
    stripped = text.strip()
    fence = re.search(r"```(?:json)?\s*(.+?)```", stripped, re.DOTALL)
    if fence:
        stripped = fence.group(1).strip()
    start, end = stripped.find("["), stripped.rfind("]")
    if start == -1 or end == -1 or end < start:
        raise TranslationError("no JSON array found in the file")
    try:
        data = json.loads(stripped[start : end + 1])
    except json.JSONDecodeError as exc:
        raise TranslationError(f"reply was not valid JSON: {exc}") from exc
    if not isinstance(data, list):
        raise TranslationError("expected a JSON array of translated questions")
    return data


async def import_documents(
    session: AsyncSession,
    locale: str,
    text: str,
    *,
    approve: bool = False,
    source: str = "machine",
) -> ImportReport:
    """Ingest an assistant's reply. Same validation as the batch job; does not commit."""
    if locale not in TRANSLATION_LOCALES:
        raise TranslationError(
            f"unsupported locale {locale!r} (expected one of {', '.join(TRANSLATION_LOCALES)})"
        )
    entries = _extract_json_array(text)
    report = ImportReport(locale=locale)

    for i, entry in enumerate(entries):
        if not isinstance(entry, dict):
            report.failed += 1
            report.errors.append(f"[{i}] not a JSON object")
            continue
        raw_id = str(entry.get("id", "")).strip()
        try:
            qid = uuid.UUID(raw_id)
        except ValueError:
            report.failed += 1
            report.errors.append(f"[{i}] missing/invalid id {raw_id!r}")
            continue

        question = await session.get(Question, qid)
        if question is None:
            report.failed += 1
            report.errors.append(f"{qid}: no such question")
            continue

        try:
            result = validate_translation(json.dumps(entry), list(question.payload["options"]))
        except TranslationError as exc:
            report.failed += 1
            report.errors.append(f"{qid}: {exc}")
            continue

        existing = (
            await session.execute(
                select(QuestionTranslation).where(
                    QuestionTranslation.question_id == qid,
                    QuestionTranslation.locale == locale,
                )
            )
        ).scalar_one_or_none()
        if existing is not None and existing.source == "human" and source != "human":
            report.skipped += 1
            continue

        risky = bool(set(result["flags"]) & RISK_FLAGS)
        if risky:
            report.flagged += 1
        status = "approved" if (approve and not risky) else "draft"

        if existing is None:
            session.add(
                QuestionTranslation(
                    question_id=qid,
                    locale=locale,
                    prompt=result["prompt"],
                    options=result["options"],
                    explanation=result["explanation"],
                    status=status,
                    source=source,
                    flags=result["flags"],
                    model="hand-off",
                )
            )
        else:
            existing.prompt = result["prompt"]
            existing.options = result["options"]
            existing.explanation = result["explanation"]
            existing.status = status
            existing.flags = result["flags"]
            existing.source = source
            existing.model = "hand-off"
        report.imported += 1

    return report


__all__ = [
    "DEFAULT_CHUNK",
    "export_flagged_review",
    "ExportResult",
    "ImportReport",
    "export_documents",
    "import_documents",
    "slugify",
]


# --- flagged-row review export --------------------------------------------------------------

# Review order: most likely to be BROKEN first. An ambiguous translation can make a question
# unanswerable; an english_spelling question may not survive into the target language at all; a
# us_centric one is usually still answerable, just unfair to some of the field.
REVIEW_ORDER = ("ambiguous_after_translation", "english_spelling", "us_centric")

FLAG_NOTES = {
    "ambiguous_after_translation": (
        "Two or more options may collapse to the same meaning, or the phrasing lost the "
        "distinction that made the question answerable. Highest risk — check the options are "
        "still distinct."
    ),
    "english_spelling": (
        "The question turns on English letters, spelling or wordplay. Confirm it still makes sense "
        "for a reader in the target language, or retire it for this locale."
    ),
    "us_centric": (
        "Assumes US schooling, geography or culture. Usually still answerable, but unfair to "
        "part of the field — decide whether to keep, reword, or drop it for this locale."
    ),
}


async def export_flagged_review(
    session: AsyncSession, locale: str, out_file: Path
) -> dict[str, int]:
    """Write every risk-flagged translation to one readable Markdown file for human review.

    Read-only: this never changes a row. Rows carrying more than one flag are listed once, under
    their highest-priority flag, with the full flag set shown.
    """
    from app.services.translator import RISK_FLAGS  # local: avoid a cycle at import time

    rows = list(
        (
            await session.execute(
                select(QuestionTranslation, Question)
                .join(Question, Question.id == QuestionTranslation.question_id)
                .where(QuestionTranslation.locale == locale)
                .order_by(Question.category, Question.id)
            )
        ).all()
    )
    flagged = [(t, q) for t, q in rows if set(t.flags or []) & RISK_FLAGS]

    groups: dict[str, list[tuple[Any, Any]]] = {f: [] for f in REVIEW_ORDER}
    for t, q in flagged:
        present = [f for f in REVIEW_ORDER if f in (t.flags or [])]
        groups[present[0] if present else REVIEW_ORDER[-1]].append((t, q))

    language = LANGUAGE_NAMES.get(locale, locale)
    lines: list[str] = [
        f"# Flagged {language} translations — review queue",
        "",
        f"{len(flagged)} of {len(rows)} {language} translations carry a risk flag and remain "
        "in `draft`. Nothing here is being served: a draft translation never reaches a player, "
        "so the English original is shown instead until you approve it.",
        "",
        "**Option order is significant.** `correctIndex` is positional and indexes the English "
        "options, so option *i* in each list must stay the translation of option *i*. If you "
        "edit a translation, do not reorder.",
        "",
        "## Contents",
        "",
    ]
    for flag in REVIEW_ORDER:
        lines.append(f"- **{flag}** — {len(groups[flag])}")
    lines.append("")

    for flag in REVIEW_ORDER:
        entries = groups[flag]
        lines += ["---", "", f"## {flag} ({len(entries)})", "", FLAG_NOTES[flag], ""]
        if not entries:
            lines += ["_None._", ""]
            continue
        for t, q in entries:
            ci = int(q.payload["correctIndex"])
            en_opts = list(q.payload["options"])
            es_opts = list(t.options or [])
            lines += [
                f"### `{q.id}`",
                "",
                f"- **Category:** {q.category}",
                f"- **Flags:** {', '.join(t.flags or []) or '—'}",
                f"- **Correct-answer index:** {ci} (`{en_opts[ci]}`)",
                "",
                f"**English:** {q.payload['prompt']}",
                "",
                f"**{language}:** {t.prompt}",
                "",
                "| # | English option | " + language + " option | |",
                "|---|---|---|---|",
            ]
            for i, en in enumerate(en_opts):
                es = es_opts[i] if i < len(es_opts) else "—"
                mark = "**← correct**" if i == ci else ""
                lines.append(f"| {i} | {en} | {es} | {mark} |")
            note = (t.explanation or "").strip()
            lines += ["", f"**Translator note:** {note or '_none_'}", ""]

    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text("\n".join(lines), encoding="utf-8")
    return {
        "flagged": len(flagged),
        "total": len(rows),
        **{f: len(groups[f]) for f in REVIEW_ORDER},
    }
