"""Question-bank content linter CLI — enforces docs/content/question-content-standard.md.

Loads questions from the live DB, the committed source banks, or a single generated import file
(JSON or CSV), runs `content.question_lint`, prints a summary, and optionally writes report
artifacts. The core principle (see the module): the EXISTING bank runs in `report` mode (never
fails); NEW import files run in `strict`/`ci` mode (fail on errors) and, for the two flagship
categories, must carry practical metadata.

READ-ONLY. It never writes to the DB and never mutates any source/import file — the only writes are
the optional report files under docs/content/. The serve-time option shuffle in
`app/modules/trivia.py` is not touched.

Run (from backend/):
    uv run python scripts/lint_question_bank.py --source db --mode report
    uv run python scripts/lint_question_bank.py --source files --mode report
    uv run python scripts/lint_question_bank.py --file path/to/generated.json --mode strict
    uv run python scripts/lint_question_bank.py --file path/to/generated.csv --mode strict
    uv run python scripts/lint_question_bank.py --source files --mode ci

Exit codes: 0 in report mode (always) and in strict/ci with no errors; non-zero in strict/ci when
any error-severity finding exists.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
from pathlib import Path
from typing import Any

from content.question_lint import (
    ERROR,
    MODE_CI,
    MODE_REPORT,
    MODES,
    RULES,
    LintConfig,
    LintQuestion,
    LintResult,
    from_bank_row,
    from_csv_record,
    from_db_payload,
    lint_questions,
)

_SCRIPTS_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _SCRIPTS_DIR.parent
_REPO_ROOT = _BACKEND_DIR.parent
_BANK_DIR = _BACKEND_DIR / "content" / "bank"
_DOCS_DIR = _REPO_ROOT / "docs" / "content"
_REPORT_MD = _DOCS_DIR / "question-bank-lint-report.md"
_REPORT_JSON = _DOCS_DIR / "question-bank-lint-report.json"

_BAR = "=" * 64
WARNING_BANNER = f"{_BAR}\n  QUESTION-BANK LINT - read-only, no data is modified\n{_BAR}"


# ── Loaders ─────────────────────────────────────────────────────────────────────────────────────
def load_file_questions() -> tuple[list[LintQuestion], list[str]]:
    """Load every content/bank/*.json (ingest format)."""
    questions: list[LintQuestion] = []
    warnings: list[str] = []
    if not _BANK_DIR.is_dir():
        return questions, [f"bank dir not found: {_BANK_DIR}"]
    for path in sorted(_BANK_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            warnings.append(f"{path.name}: {exc}")
            continue
        if not isinstance(data, list):
            warnings.append(f"{path.name}: not a JSON array — skipped")
            continue
        for i, row in enumerate(data):
            if isinstance(row, dict):
                questions.append(from_bank_row(row, f"{path.name}#{i}"))
            else:
                warnings.append(f"{path.name}#{i}: not an object — skipped")
    return questions, warnings


def load_import_file(path: Path) -> tuple[list[LintQuestion], list[str]]:
    """Load a single generated import file (JSON array or CSV) for strict linting."""
    warnings: list[str] = []
    if not path.exists():
        raise SystemExit(f"--file {path} does not exist")
    if path.suffix.lower() == ".csv":
        questions: list[LintQuestion] = []
        with path.open(encoding="utf-8-sig", newline="") as fh:
            for i, record in enumerate(csv.DictReader(fh)):
                questions.append(from_csv_record(record, f"{path.name}#{i}"))
        return questions, warnings
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise SystemExit(f"--file {path} must contain a JSON array of question objects")
    out: list[LintQuestion] = []
    for i, row in enumerate(data):
        if isinstance(row, dict):
            out.append(from_bank_row(row, f"{path.name}#{i}"))
        else:
            warnings.append(f"{path.name}#{i}: not an object — skipped")
    return out, warnings


async def load_db_questions() -> tuple[list[LintQuestion], list[str]]:
    """SELECT every trivia question from the live DB (read-only)."""
    questions: list[LintQuestion] = []
    warnings: list[str] = []
    try:
        from app.core.db import SessionLocal, engine
        from app.models import Question
        from sqlalchemy import select
    except Exception as exc:  # pragma: no cover - env-dependent
        return questions, [f"DB layer unavailable ({type(exc).__name__}: {exc})"]
    try:
        async with SessionLocal() as session:
            rows = (
                await session.execute(
                    select(
                        Question.id,
                        Question.category,
                        Question.difficulty,
                        Question.explanation,
                        Question.payload,
                    )
                    .where(Question.module_type == "trivia")
                    .order_by(Question.id)
                )
            ).all()
        for qid, category, difficulty, explanation, payload in rows:
            questions.append(from_db_payload(str(qid), category, difficulty, explanation, payload))
    except Exception as exc:  # pragma: no cover - env-dependent
        warnings.append(f"DB not reachable ({type(exc).__name__}: {str(exc)[:160]})")
    finally:
        try:
            await engine.dispose()
        except Exception:  # pragma: no cover
            pass
    return questions, warnings


# ── Reporting ───────────────────────────────────────────────────────────────────────────────────
def _worst_questions(result: LintResult, limit: int = 50) -> list[dict[str, Any]]:
    """Rank questions by (errors, warnings) desc; return the worst `limit`."""
    sev_weight = {ERROR: 100}
    scored: dict[str, dict[str, Any]] = {}
    for f in result.findings:
        if f.ident.startswith("batch:"):
            continue
        entry = scored.setdefault(
            f.ident,
            {"ident": f.ident, "category": f.category, "stem": f.stem, "score": 0, "rules": []},
        )
        entry["score"] += sev_weight.get(f.severity, 1)
        entry["rules"].append(f"{f.rule_id}:{f.severity}")
    ranked = sorted(scored.values(), key=lambda e: (-e["score"], e["category"], e["ident"]))
    for e in ranked:
        e["rules"] = sorted(set(e["rules"]))
    return ranked[:limit]


def build_report(result: LintResult, source: str, warnings: list[str]) -> dict[str, Any]:
    practical_rules = {f"Q0{n}" for n in range(40, 47)}
    practical_failures = [f.as_dict() for f in result.findings if f.rule_id in practical_rules]
    return {
        "meta": {
            "source": source,
            "mode": result.mode,
            "is_new_import": result.is_new_import,
            "total_questions": result.total_questions,
            "warnings": warnings,
        },
        "counts": {
            "by_severity": result.counts_by_severity(),
            "by_rule": result.counts_by_rule(),
            "by_category": result.counts_by_category(),
        },
        "worst_questions": _worst_questions(result),
        "duplicate_clusters": result.duplicate_clusters,
        "position_balance": result.position_balance,
        "practical_failures": practical_failures,
        "failed": result.failed(),
    }


def _rule_line(rule_id: str, count: int) -> str:
    rule = RULES.get(rule_id)
    summary = rule.summary if rule else "(unknown rule)"
    sev = rule.severity if rule else "?"
    return f"| {rule_id} | {sev} | {count} | {summary} |"


def render_markdown(report: dict[str, Any]) -> str:
    m = report["meta"]
    c = report["counts"]
    out: list[str] = []
    p = out.append
    p("# Rot Royale — Question Bank Lint Report")
    p("")
    p(
        "> Generated by `backend/scripts/lint_question_bank.py` (READ-ONLY). Enforces "
        "`question-content-standard.md`. Deterministic given a fixed input."
    )
    p("")
    p(
        f"**Source:** `{m['source']}` · **mode:** `{m['mode']}` · "
        f"**new import:** {m['is_new_import']} · **linted:** {m['total_questions']} questions"
    )
    p("")
    p("## Summary")
    p("")
    p(
        f"- **Errors:** {c['by_severity']['error']} · "
        f"**Warnings:** {c['by_severity']['warning']} · "
        f"**Info:** {c['by_severity']['info']}"
    )
    p(f"- **Process result:** {'FAIL' if report['failed'] else 'pass'} (mode `{m['mode']}`)")
    if m["warnings"]:
        for w in m["warnings"]:
            p(f"- note: {w}")
    p("")
    p("## Counts by rule")
    p("")
    p("| Rule | Severity | Count | Description |")
    p("| --- | --- | --- | --- |")
    for rule_id, count in sorted(c["by_rule"].items()):
        p(_rule_line(rule_id, count))
    p("")
    p("## Counts by category")
    p("")
    p("| Category | Findings |")
    p("| --- | --- |")
    for cat, count in sorted(c["by_category"].items()):
        p(f"| {cat} | {count} |")
    p("")
    p("## Source answer-position balance (authoring hygiene only — gameplay shuffles at serve)")
    p("")
    p("| Category | Total | A | B | C | D |")
    p("| --- | --- | --- | --- | --- | --- |")
    for cat in sorted(report["position_balance"]):
        b = report["position_balance"][cat]
        cts = b["counts"]
        shr = b["shares"]
        p(
            f"| {cat} | {b['total']} | {cts['A']} ({shr['A']:.0%}) | {cts['B']} ({shr['B']:.0%}) "
            f"| {cts['C']} ({shr['C']:.0%}) | {cts['D']} ({shr['D']:.0%}) |"
        )
    p("")
    p("## Duplicate clusters")
    p("")
    if report["duplicate_clusters"]:
        for g in report["duplicate_clusters"][:40]:
            p(
                f"- **[{g['kind']}, ×{g['size']}, {g['rule_id']}]** "
                f"categories: {', '.join(g['categories'])} · "
                f"difficulties: {', '.join(g['difficulties'])}"
            )
            for stem in g["stems"][:4]:
                p(f"    - {stem}")
        if len(report["duplicate_clusters"]) > 40:
            p(f"- …and {len(report['duplicate_clusters']) - 40} more (see JSON).")
    else:
        p("None detected.")
    p("")
    p("## Practical-category failures (Money & Business, Street Smarts)")
    p("")
    if report["practical_failures"]:
        for f in report["practical_failures"][:50]:
            p(f"- `{f['ident']}` [{f['category']}] {f['rule_id']}: {f['message']}")
    else:
        p("_None (practical metadata rules only apply to new flagship imports)._")
    p("")
    p("## Worst 50 questions")
    p("")
    for w in report["worst_questions"]:
        stem = (w["stem"] or "")[:90]
        p(f"- `{w['ident']}` [{w['category']}] {', '.join(w['rules'])} — {stem}")
    p("")
    p("## Recommended cleanup order")
    p("")
    p("1. **Structural errors first** (Q001–Q011): missing stems/explanations, bad option sets.")
    p("2. **Exact duplicates** (Q027): delete the redundant copy.")
    p("3. **Restated / thin explanations** (Q020, Q009): rewrite to answer+why+takeaway.")
    p("4. **Near-duplicates** (Q028) and **length tells** (Q024): rewrite or diversify.")
    p("5. **Scenario conversion** for pure-recall stems; **rebalance source positions** (Q029).")
    p("6. **Flagship metadata** (Q040–Q046) as Money & Business / Street Smarts is authored.")
    p("")
    return "\n".join(out) + "\n"


def print_summary(result: LintResult, source: str, concise: bool) -> None:
    sev = result.counts_by_severity()
    print(
        f"Linted {result.total_questions} questions from `{source}` "
        f"(mode={result.mode}, new_import={result.is_new_import})."
    )
    print(f"  errors={sev['error']}  warnings={sev['warning']}  info={sev['info']}")
    if not concise:
        by_rule = result.counts_by_rule()
        if by_rule:
            print("  by rule:")
            for rule_id, count in sorted(by_rule.items()):
                rule = RULES.get(rule_id)
                sev_label = rule.severity if rule else "?"
                print(f"    {rule_id} [{sev_label}] x{count}")
    if result.failed():
        top = [f for f in result.findings if f.severity == ERROR][:10]
        print("  first errors:")
        for f in top:
            print(f"    {f.rule_id} {f.ident}: {f.message}")


# ── Entry point ─────────────────────────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only Rot Royale question-bank linter.")
    src = parser.add_mutually_exclusive_group()
    src.add_argument("--source", choices=("db", "files"), help="lint the existing bank")
    src.add_argument("--file", type=Path, help="lint a single generated import file (.json/.csv)")
    parser.add_argument("--mode", choices=MODES, default=MODE_REPORT)
    parser.add_argument(
        "--write-report",
        action="store_true",
        help="write docs/content/question-bank-lint-report.{md,json}",
    )
    parser.add_argument(
        "--no-report",
        action="store_true",
        help="skip writing report files (default for --file runs)",
    )
    args = parser.parse_args()

    if not args.source and not args.file:
        args.source = "db"  # sensible default

    print(WARNING_BANNER)

    # --file is a NEW import; --source is the EXISTING bank.
    is_new_import = args.file is not None
    if args.file is not None:
        source = str(args.file)
        questions, warnings = load_import_file(args.file)
    elif args.source == "db":
        source = "db"
        questions, warnings = asyncio.run(load_db_questions())
        if not questions:
            warnings.append("DB returned no questions — falling back to source files.")
            files_q, files_w = load_file_questions()
            questions, source = files_q, "files"
            warnings.extend(files_w)
    else:
        source = "files"
        questions, warnings = load_file_questions()

    result = lint_questions(
        questions, config=LintConfig(), mode=args.mode, is_new_import=is_new_import
    )
    report = build_report(result, source, warnings)

    print_summary(result, source, concise=(args.mode == MODE_CI))
    for w in warnings:
        print(f"  note: {w}")

    # Write reports: default ON for --source runs, OFF for --file (unless --write-report).
    write = args.write_report or (args.source is not None and not args.no_report)
    if write:
        _DOCS_DIR.mkdir(parents=True, exist_ok=True)
        _REPORT_MD.write_text(render_markdown(report), encoding="utf-8")
        _REPORT_JSON.write_text(
            json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"Wrote report:  {_REPORT_MD}")
        print(f"Wrote json:    {_REPORT_JSON}")

    print("READ-ONLY: no DB writes, no source/import files mutated.")

    if result.failed():
        print(f"LINT FAILED: {result.error_count} error(s) in {args.mode} mode.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
