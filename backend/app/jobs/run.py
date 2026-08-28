"""One-shot cron entrypoint — the Render-cron alternative to the in-process daemon.

Usage:  python -m app.jobs.run [transition|create|settle|both|seed]   (default: both)
        python -m app.jobs.run ingest <file.json | dir> [--retire-missing]
        python -m app.jobs.run ingest-change <manifest.json> [--retire-missing]
        python -m app.jobs.run ingest-video <manifest.json> [--retire-missing]
        python -m app.jobs.run ingest-estimate <file.json> [--retire-missing]
        python -m app.jobs.run export-estimate-verdicts <out.json>
        python -m app.jobs.run classify [--limit N] [--force] [--dry-run] [--id <uuid>]
                                        [--category NAME] [--sleep-ms N] [--max-errors N]
                                        [--coverage]
        python -m app.jobs.run recover-content
        python -m app.jobs.run content-check
        python -m app.jobs.run push-status
        python -m app.jobs.run push-test --username <name>
        python -m app.jobs.run play-times
        python -m app.jobs.run reset-stranded [--apply]
        python -m app.jobs.run goodwill --key <incident> [--gems N] [--coins N] [--notify] [--apply]

  transition  flip SCHEDULED→OPEN→CLOSED by current time
  create      provision today's + tomorrow's SCHEDULED windows (idempotent)
  settle      settle CLOSED windows (exactly-once)
  both        create, transition, then settle
  seed        load the content banks (trivia) into the questions table (idempotent). Run on deploy —
              without it the bank is empty and round generation 500s on enter/practice.
  build_campaign  rebuild content/campaign/campaign_levels.json from the authored plan + bank files
              (a local dev/content step; the committed manifest is what prod loads — no DB needed).
  backfill_starter_gems  grant the one-time +5 starter Gem retroactively to every player with a
              completed Daily Royale who predates the Gems launch (idempotent; re-running grants 0).
  rot-converge  converge the FLOATING Rot Rating difficulty pools on the just-completed ET day, then
              re-centre to seed means (the anchor). NOT idempotent — schedule ONCE per ET day.
  ingest      load a reviewed JSON question bank as status='approved'. The argument is a single
              <file.json> OR a directory (every *.json in it is ingested in one pass — used on
              deploy to load the whole content/bank/ folder). Validates each row, dedupes on
              (question, category) across files, reports added/skipped/rejected. Exits non-zero if
              any row was malformed (so a bad bank is loud, not silently partial).
  ingest-change  load a change-detection asset manifest (content/change_manifest.py documents the
              contract; bounding boxes in normalized 0-1 image coordinates). Upserts by key,
              rejects malformed items loudly (non-zero exit).
              --retire-missing makes the manifest the ACTIVE SET, as for ingest-estimate. UNLIKE
              that one it is refused when any item was rejected: this ingest continues past a bad
              item, so an absent key cannot be told apart from a broken one.
  ingest-video   load the video round's content package. Merges the MECHANICAL manifest (assets,
              dimensions, duration) with the AUTHORED questions.json, so regenerating the former
              cannot silently drop the latter. Upserts by key; rejects malformed items loudly
              (non-zero exit) — a half-formed clip would surface as an unanswerable round.
              --retire-missing behaves exactly as it does for ingest-change, same caveat.
              The manifest path is OPTIONAL, and the two cases differ deliberately: a path you TYPE
              must exist (a typo must not pass silently), while the RESOLVED default may be absent —
              a content package with no video/ is a legitimate state, and this command runs inside
              the web service's `&&` startCommand where a non-zero exit kills the deploy.
  ingest-estimate  load the Fermi estimate content set (a JSON array keyed by string `id`).
              All-or-nothing: any invalid item rejects the WHOLE file and writes nothing (non-zero
              exit, per-item reasons). Upserts by id; never touches admin playtest verdicts.
              --retire-missing makes the file the ACTIVE SET: tracked rows it no longer carries are
              deactivated (kept, never deleted) and returning rows are reactivated. That is what
              makes it safe to run on every deploy (see render.yaml) — without it a content change
              needs a manual retire step against the target DB.
  export-estimate-verdicts  write every estimate item's id/prompt/answer/difficulty/flags/verdict/
              note to <out.json> — the correlation input for a playtest analysis pass.
  classify    LLM-classify trivia questions into question_ai_metadata (batch — the LLM is never
              called during gameplay). Skips already-classified questions unless --force. Requires
              ROT_AI_ENABLED=true + ROT_AI_API_KEY/ROT_AI_BASE_URL/ROT_AI_MODEL in backend/.env;
              otherwise exits non-zero with a clear message. --dry-run lists candidates without
              calling the LLM or writing. Exits non-zero if any question failed.
              --coverage prints coverage stats without any LLM calls (no credentials needed).
              --category limits the run to one canonical category. --sleep-ms adds a per-question
              delay (rate-limit friendliness). --max-errors aborts early after N failures.
  recover-content  recover DB-only questions into tracked repo bank files
              (content/bank/recovered_<slug>.json). Groups untracked DB questions by category and
              writes ingest-format files; skips legacy-seed rows with no explanation. Run once
              after a content import that bypassed the ingest pipeline.
  reset-stranded  free the runs the §5f protocol break wedged (an unanswerable second-chance offer
              on an OPEN royale window), so those players can enter today again. The entry is
              deleted, which clears uq_entry_window_user; the replay serves the IDENTICAL questions
              because the seed comes from the window. DRY RUN unless --apply.
  goodwill    pay a one-time apology (default 5 gems + 50 coins) to every account, exactly once per
              --key. The key names the incident, so a later apology can pay the same players again
              and an interrupted run is resumed by re-running. --notify also sends a push and prints
              which transports are live (APNs needs four secrets; without them every iOS device is
              silently skipped). DRY RUN unless --apply.
  content-check  drift guard: verify every DB question is fingerprint-covered by a tracked repo
              bank file. Exits non-zero if missing_from_repo is non-empty (drift detected). Run
              on CI or after any direct DB content import.

On Render, schedule `python -m app.jobs.run both` frequently (and optionally `create` daily), and
set scheduler_enabled=false on the web service so the jobs run exactly once (no in-process daemon
competing). Runs once and exits.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from content.ingest import ingest_bank, read_bank_rows
from content.loader import load_trivia

from app.core.db import SessionLocal, engine
from app.jobs.tasks import (
    backfill_starter_gems,
    converge_rot_difficulties,
    ensure_upcoming_windows,
    purge_expired_share_links,
    run_season_reset,
    run_transitions,
    send_reengagement_pushes,
    settle_due_windows,
)
from app.services.duel import cleanup_expired_duels
from app.services.friend_duel import expire_stale_friend_duels
from app.services.google_oauth import purge_expired as purge_expired_oauth_transactions

_COMMANDS = (
    "transition",
    "create",
    "settle",
    "both",
    "seed",
    "ingest",
    "ingest-change",
    "ingest-video",
    "ingest-estimate",
    "export-estimate-verdicts",
    "classify",
    "translate",
    "export-translations",
    "import-translations",
    "approve-translations",
    "review-flagged",
    "build_campaign",
    "backfill_starter_gems",
    "rot-converge",
    "recover-content",
    "content-check",
    "reset-stranded",
    "goodwill",
    "push-status",
    "play-times",
    "push-test",
)


# The content root (settings.content_root): the synthetic sample corpus in development, the private
# production bank when ROT_CONTENT_DIR names one. Never a repo-relative production path — that
# assumption is exactly what kept the answer corpus wired into the source tree.
def _content_dir() -> Path:
    from app.core.config import settings

    return settings.content_root


async def _approve_translations(argv: list[str]) -> int:
    """Publish draft translations that carry no risk flag. Status only."""
    from app.services.translator import TranslationError, approve_clean_translations

    if "--locale" not in argv:
        raise SystemExit("approve-translations: --locale is required (es|fr|tr)")
    try:
        locale = argv[argv.index("--locale") + 1]
    except IndexError:
        raise SystemExit("approve-translations: --locale needs a value") from None
    dry_run = "--dry-run" in argv
    include_flagged = "--include-flagged" in argv

    def _list(flag: str) -> list[str] | None:
        if flag not in argv:
            return None
        try:
            raw = argv[argv.index(flag) + 1]
        except IndexError:
            raise SystemExit(f"approve-translations: {flag} needs a value") from None
        return [c.strip() for c in raw.split(",") if c.strip()] or None

    categories = _list("--category")
    exclude = _list("--exclude")

    async with SessionLocal() as session:
        try:
            report = await approve_clean_translations(
                session,
                locale,
                dry_run=dry_run,
                include_flagged=include_flagged,
                categories=categories,
                exclude=exclude,
            )
        except TranslationError as exc:
            print(f"approve-translations: {exc}", file=sys.stderr)
            await engine.dispose()
            return 2
        if not dry_run:
            await session.commit()
    await engine.dispose()
    prefix = "DRY RUN would approve" if dry_run else "approve-translations:"
    print(f"{prefix} {report.summary()}")
    return 0


async def _review_flagged(argv: list[str]) -> int:
    """Write the risk-flagged translations for a locale to a readable Markdown review file."""
    from pathlib import Path as _Path

    from app.services.translation_io import export_flagged_review

    if "--locale" not in argv:
        raise SystemExit("review-flagged: --locale is required (es|fr|tr)")
    try:
        locale = argv[argv.index("--locale") + 1]
    except IndexError:
        raise SystemExit("review-flagged: --locale needs a value") from None
    out = (
        _Path(argv[argv.index("--out") + 1])
        if "--out" in argv
        else _content_dir() / "translate_export" / f"{locale}-flagged-review.md"
    )

    async with SessionLocal() as session:
        stats = await export_flagged_review(session, locale, out)
    await engine.dispose()
    print(f"review-flagged: {stats['flagged']} flagged of {stats['total']} -> {out}")
    for flag in ("ambiguous_after_translation", "english_spelling", "us_centric"):
        print(f"  {flag}: {stats[flag]}")
    return 0


async def _export_translations(argv: list[str]) -> int:
    """Write paste-ready translation documents (one or more per category)."""
    from pathlib import Path as _Path

    from app.services.translation_io import DEFAULT_CHUNK, export_documents
    from app.services.translator import TranslationError

    if "--locale" not in argv:
        raise SystemExit("export-translations: --locale is required (es|fr|tr)")
    try:
        locale = argv[argv.index("--locale") + 1]
    except IndexError:
        raise SystemExit("export-translations: --locale needs a value") from None

    def _val(flag: str) -> str | None:
        if flag not in argv:
            return None
        try:
            return argv[argv.index(flag) + 1]
        except IndexError:
            raise SystemExit(f"export-translations: {flag} needs a value") from None

    out = _Path(_val("--out") or (_content_dir() / "translate_export"))
    chunk = int(_val("--chunk") or DEFAULT_CHUNK)
    cats = [c.strip() for c in (_val("--category") or "").split(",") if c.strip()] or None
    excl = [c.strip() for c in (_val("--exclude") or "").split(",") if c.strip()] or None

    async with SessionLocal() as session:
        try:
            res = await export_documents(
                session,
                locale,
                out,
                categories=cats,
                exclude=excl,
                chunk=chunk,
                include_translated="--include-translated" in argv,
            )
        except TranslationError as exc:
            print(f"export-translations: {exc}", file=sys.stderr)
            await engine.dispose()
            return 2
    await engine.dispose()

    if not res.files:
        print("export-translations: nothing to export (all questions already translated?)")
        return 0
    print(f"export-translations: {res.questions} questions -> {len(res.files)} file(s) in {out}")
    for f in res.files:
        print(f"  {f.name}")
    return 0


async def _import_translations(argv: list[str]) -> int:
    """Ingest an assistant's reply produced from an exported document."""
    from pathlib import Path as _Path

    from app.services.translation_io import import_documents
    from app.services.translator import TranslationError

    if not argv or argv[0].startswith("--"):
        raise SystemExit("usage: import-translations <file> --locale <es|fr|tr> [--approve]")
    path = _Path(argv[0])
    if not path.exists():
        raise SystemExit(f"import-translations: no such file {path}")
    if "--locale" not in argv:
        raise SystemExit("import-translations: --locale is required (es|fr|tr)")
    try:
        locale = argv[argv.index("--locale") + 1]
    except IndexError:
        raise SystemExit("import-translations: --locale needs a value") from None

    text = path.read_text(encoding="utf-8")
    async with SessionLocal() as session:
        try:
            report = await import_documents(
                session,
                locale,
                text,
                approve="--approve" in argv,
                source="human" if "--human" in argv else "machine",
            )
        except TranslationError as exc:
            print(f"import-translations: {exc}", file=sys.stderr)
            await engine.dispose()
            return 2
        await session.commit()
    await engine.dispose()

    print(f"import-translations: {report.summary()}")
    return 1 if report.failed else 0


async def _translate(argv: list[str]) -> int:
    """Batch-translate the trivia bank into a locale.

    Non-zero exit on unavailability or any failed question.
    """
    import json as _json
    import logging as _logging
    import uuid as _uuid

    from app.services.translator import (
        AIClassifierUnavailable,
        TranslationError,
        chat_client,
        coverage_report,
        translate_batch,
    )

    # --coverage: no LLM, no credentials needed — handle before the client path.
    if "--coverage" in argv:
        async with SessionLocal() as session:
            coverage = await coverage_report(session)
        await engine.dispose()
        print(_json.dumps(coverage, indent=2))
        return 0

    if "--locale" not in argv:
        raise SystemExit("translate: --locale is required (es|fr|tr)")
    try:
        locale = argv[argv.index("--locale") + 1]
    except IndexError:
        raise SystemExit("translate: --locale needs a value (es|fr|tr)") from None

    limit: int | None = None
    force = "--force" in argv
    dry_run = "--dry-run" in argv
    approve = "--approve" in argv
    question_id: _uuid.UUID | None = None
    category: str | None = None
    sleep_ms = 0
    max_errors: int | None = None
    timeout_ms: int | None = None
    max_retries: int | None = None

    def _int(flag: str) -> int:
        try:
            return int(argv[argv.index(flag) + 1])
        except (IndexError, ValueError):
            raise SystemExit(f"translate: {flag} needs an integer") from None

    if "--limit" in argv:
        limit = _int("--limit")
    if "--sleep-ms" in argv:
        sleep_ms = _int("--sleep-ms")
    if "--max-errors" in argv:
        max_errors = _int("--max-errors")
    if "--timeout-ms" in argv:
        timeout_ms = _int("--timeout-ms")
    if "--max-retries" in argv:
        max_retries = _int("--max-retries")
    if "--id" in argv:
        try:
            question_id = _uuid.UUID(argv[argv.index("--id") + 1])
        except (IndexError, ValueError):
            raise SystemExit("translate: --id needs a question UUID") from None
    if "--category" in argv:
        try:
            category = argv[argv.index("--category") + 1]
        except IndexError:
            raise SystemExit("translate: --category needs a category name") from None

    # Per-checkpoint progress goes to the log; a long run must be observable, not silent.
    _logging.basicConfig(level=_logging.INFO, format="%(asctime)s %(message)s")

    async with SessionLocal() as session:
        try:
            client = chat_client(timeout_ms=timeout_ms, max_retries=max_retries)
            report = await translate_batch(
                session,
                locale,
                client=client,
                limit=limit,
                force=force,
                dry_run=dry_run,
                approve=approve,
                category=category,
                question_id=question_id,
                sleep_ms=sleep_ms,
                max_errors=max_errors,
                on_checkpoint=session.commit if not dry_run else None,
            )
        except AIClassifierUnavailable as exc:
            print(f"translate: {exc}", file=sys.stderr)
            await engine.dispose()
            return 2
        except TranslationError as exc:
            print(f"translate: {exc}", file=sys.stderr)
            await engine.dispose()
            return 2
        if not dry_run:
            await session.commit()
    await engine.dispose()

    print(f"translate: {report.summary()}")
    return 1 if report.failed else 0


async def _classify(argv: list[str]) -> int:
    """LLM-classify trivia questions. Non-zero exit on unavailability or any failed question."""
    import uuid as _uuid

    from app.services.ai_classifier import AIClassifierUnavailable, classify_batch, coverage_report

    # --coverage: no LLM, no credentials needed — handle before the classify/client path.
    if "--coverage" in argv:
        async with SessionLocal() as session:
            coverage = await coverage_report(session)
        await engine.dispose()
        print(coverage.summary())
        return 0

    limit: int | None = None
    force = "--force" in argv
    dry_run = "--dry-run" in argv
    question_id: _uuid.UUID | None = None
    category: str | None = None
    sleep_ms: int = 0
    max_errors: int | None = None

    if "--limit" in argv:
        try:
            limit = int(argv[argv.index("--limit") + 1])
        except (IndexError, ValueError):
            raise SystemExit("classify: --limit needs an integer") from None
    if "--id" in argv:
        try:
            question_id = _uuid.UUID(argv[argv.index("--id") + 1])
        except (IndexError, ValueError):
            raise SystemExit("classify: --id needs a question UUID") from None
    if "--category" in argv:
        try:
            category = argv[argv.index("--category") + 1]
        except IndexError:
            raise SystemExit("classify: --category needs a category name") from None
    if "--sleep-ms" in argv:
        try:
            sleep_ms = int(argv[argv.index("--sleep-ms") + 1])
        except (IndexError, ValueError):
            raise SystemExit("classify: --sleep-ms needs an integer") from None
    if "--max-errors" in argv:
        try:
            max_errors = int(argv[argv.index("--max-errors") + 1])
        except (IndexError, ValueError):
            raise SystemExit("classify: --max-errors needs an integer") from None

    async with SessionLocal() as session:
        try:
            report = await classify_batch(
                session,
                limit=limit,
                force=force,
                dry_run=dry_run,
                question_id=question_id,
                category=category,
                sleep_ms=sleep_ms,
                max_errors=max_errors,
                on_checkpoint=session.commit if not dry_run else None,
            )
        except AIClassifierUnavailable as exc:
            print(f"classify: {exc}", file=sys.stderr)
            await engine.dispose()
            return 2
        if not dry_run:
            await session.commit()
    await engine.dispose()

    print(f"classify: {report.summary()}")
    for qid, reason in report.failed:
        print(f"  FAILED {qid}: {reason}", file=sys.stderr)
    return 1 if report.failed else 0


async def _ingest(path: str, *, retire_missing: bool = False) -> int:
    """Load a reviewed bank file or directory. Non-zero exit code if any row was rejected."""
    if not Path(path).exists():
        raise SystemExit(f"ingest: {path} does not exist")

    # THE GUARD THAT MATTERS. `path` may be a single bank file, and --retire-missing treats whatever
    # was loaded as the complete active set. Pointed at one category that would retire every OTHER
    # category — around 800 questions, i.e. the whole Daily Royale — from one plausible-looking
    # command. Retiring is only meaningful against the entire bank, so require a directory.
    if retire_missing and not Path(path).is_dir():
        raise SystemExit(
            "ingest --retire-missing needs the WHOLE bank directory, not a single file: "
            "retiring against one file would deactivate every question in every other category."
        )

    rows = read_bank_rows(path)
    async with SessionLocal() as session:
        report = await ingest_bank(session, rows, retire_missing=retire_missing)
        await session.commit()
    await engine.dispose()

    sync = f", retired {report.retired}, restored {report.restored}" if retire_missing else ""
    print(
        f"ingest {path}: {len(rows)} rows -> added {report.added}, updated {report.updated}, "
        f"skipped {report.skipped} (unchanged/dupe), rejected {len(report.rejected)}{sync}"
    )
    for index, reason in report.rejected:
        print(f"  REJECTED row {index}: {reason}", file=sys.stderr)
    if retire_missing and report.rejected:
        print(
            "  NOT RETIRING: rows were rejected, so a question missing from the files cannot be "
            "told apart from one that failed validation.",
            file=sys.stderr,
        )
    if report.retire_aborted:
        print(f"  RETIRE ABORTED: {report.retire_aborted}", file=sys.stderr)
    for blocked in report.retire_blocked:
        print(
            f"  KEPT (a campaign level still serves it): {blocked}. Remove it from the campaign "
            f"plan and rebuild the manifest first, or that level stops being playable.",
            file=sys.stderr,
        )
    return 1 if report.rejected else 0


async def _ingest_change(path: str, *, retire_missing: bool = False) -> int:
    """Load a change-detection asset manifest. Non-zero exit if any item was rejected."""
    import json as _json

    from content.change_manifest import ingest_change_manifest, read_manifest

    if not Path(path).exists():
        raise SystemExit(f"ingest-change: {path} does not exist")
    manifest = read_manifest(path)

    # Difficulty is authored here, not in the manifest. It is an ATTENTION property (is the change
    # on the subject or in the background?) that no pixel measurement can derive, so the QC pipeline
    # that builds manifests deliberately does not emit it — leaving one source of truth instead of
    # two that can disagree. Stamp it on the way in; an item whose key is unlisted stays NULL.
    tiers_path = _content_dir() / "change" / "difficulty.json"
    if tiers_path.exists() and isinstance(manifest.get("items"), list):
        tiers = {
            k: v
            for k, v in _json.loads(tiers_path.read_text(encoding="utf-8")).items()
            if not k.startswith("_")
        }
        stamped = 0
        for item in manifest["items"]:
            if isinstance(item, dict) and not item.get("difficulty"):
                tier = tiers.get(item.get("key"))
                if tier:
                    item["difficulty"] = tier
                    stamped += 1
        if stamped:
            print(f"ingest-change: stamped difficulty on {stamped} item(s) from {tiers_path.name}")
    async with SessionLocal() as session:
        report = await ingest_change_manifest(
            session, manifest, _content_dir(), retire_missing=retire_missing
        )
        await session.commit()
    await engine.dispose()

    sync = f", retired {report.retired}, reactivated {report.reactivated}" if retire_missing else ""
    print(
        f"ingest-change {path}: added {report.added}, updated {report.updated}, "
        f"skipped {report.skipped} (unchanged), rejected {len(report.rejected)}{sync}"
    )
    if retire_missing and report.rejected:
        print(
            "  NOT RETIRING: the manifest had rejected items, so an absent key cannot be told "
            "apart from a broken one.",
            file=sys.stderr,
        )
    for index, reason in report.rejected:
        print(f"  REJECTED item {index}: {reason}", file=sys.stderr)
    return 1 if report.rejected else 0


async def _ingest_video(path: str, *, retire_missing: bool = False, required: bool = True) -> None:
    """Ingest the video round's content package.

    Two files, merged here: the MECHANICAL manifest (assets, dimensions, duration — probed from the
    clips) and the AUTHORED questions (prompts, options, answers — written by a person who watched
    them). Same split as ingest-change's difficulty file, and for the same reason: regenerating the
    mechanical half must not be able to silently drop the human half.

    `required=False` — set when the path was RESOLVED rather than typed — makes an absent manifest a
    no-op instead of a failure. A content package with no `video/` at all is a legitimate state:
    `royale_content_availability` adds "video" to the Royale pool only when active rows exist, so a
    deployment with no video content simply runs the other four types. This command sits in the web
    service's `&&` startCommand, where exiting non-zero means uvicorn never starts and the deploy
    dies on its health check — the same trap `ingest-change` was deliberately kept out of the chain
    to avoid until a manifest existed for it.

    An explicitly NAMED path is still required to exist. Someone who typed a path meant that path,
    and silently doing nothing about a typo is how a content release goes missing unnoticed.
    """
    from content.video_manifest import (
        ingest_video_manifest,
        merge_questions,
        read_manifest,
        read_questions,
    )

    if not Path(path).exists():
        if required:
            raise SystemExit(f"ingest-video: {path} does not exist")
        # Returning BEFORE the retire pass is the load-bearing part. `--retire-missing` treats the
        # manifest as the active set, so running it against a manifest that is not there would read
        # as "every item was deleted" and deactivate the entire video corpus at once.
        print(f"ingest-video: no manifest at {path} — skipping (this package has no video content)")
        return
    manifest = read_manifest(path)

    questions_path = _content_dir() / "video" / "questions.json"
    if questions_path.exists():
        stamped = merge_questions(manifest, read_questions(questions_path))
        if stamped:
            print(
                f"ingest-video: merged questions for {stamped} item(s) from {questions_path.name}"
            )

    async with SessionLocal() as session:
        report = await ingest_video_manifest(
            session, manifest, _content_dir(), retire_missing=retire_missing
        )
        await session.commit()
    await engine.dispose()

    for idx, reason in report.rejected:
        where = "manifest" if idx == -1 else f"item {idx}"
        print(f"ingest-video REJECTED {where}: {reason}")
    sync = f", retired {report.retired}, reactivated {report.reactivated}" if retire_missing else ""
    print(
        f"ingest-video {path}: added {report.added}, updated {report.updated}, "
        f"skipped {report.skipped} (unchanged), rejected {len(report.rejected)}{sync}"
    )
    if report.rejected:
        # Loudly, with a non-zero exit — a malformed clip must never ingest half-formed and
        # surface later as a round nobody can answer.
        raise SystemExit(1)


async def _ingest_estimate(path: str, *, retire_missing: bool = False) -> int:
    """Load the Fermi estimate content set. All-or-nothing: non-zero exit if the file rejects."""
    from content.estimate_ingest import ingest_estimate_items, read_estimate_items

    if not Path(path).exists():
        raise SystemExit(f"ingest-estimate: {path} does not exist")
    items = read_estimate_items(path)
    async with SessionLocal() as session:
        report = await ingest_estimate_items(session, items, retire_missing=retire_missing)
        if report.rejected:
            await session.rollback()  # all-or-nothing: nothing was staged, but be explicit
        else:
            await session.commit()
    await engine.dispose()

    count = len(items) if isinstance(items, list) else 0
    sync = f", retired {report.retired}, reactivated {report.reactivated}" if retire_missing else ""
    print(
        f"ingest-estimate {path}: {count} items -> added {report.added}, "
        f"updated {report.updated}, skipped {report.skipped} (unchanged), "
        f"rejected {len(report.rejected)}{sync}"
    )
    for index, reason in report.rejected:
        print(f"  REJECTED item {index}: {reason}", file=sys.stderr)
    return 1 if report.rejected else 0


async def _export_estimate_verdicts(path: str) -> int:
    """Write every estimate item's id/prompt/answer/difficulty/flags/verdict/note to <out.json>."""
    import json as _json

    from content.estimate_ingest import export_estimate_verdicts

    async with SessionLocal() as session:
        rows = await export_estimate_verdicts(session)
    await engine.dispose()

    Path(path).write_text(_json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    rated = sum(1 for r in rows if r["playtest_verdict"] is not None)
    print(f"export-estimate-verdicts: wrote {len(rows)} item(s) ({rated} rated) to {path}")
    return 0


async def _recover_content() -> int:
    """Recover DB-only questions into content/bank/recovered_<slug>.json files."""
    from content.governance import recover_db_only

    async with SessionLocal() as session:
        report = await recover_db_only(session, _content_dir())
    await engine.dispose()

    files_str = ", ".join(str(f) for f in report["files"]) if report["files"] else "none"
    print(
        f"recover-content: recovered {report['recovered']} to {files_str}, "
        f"skipped {report['skipped_no_explanation']} with no explanation"
    )
    return 0


async def _play_times() -> int:
    """When do players ACTUALLY finish a Daily Royale, in their own local time?

    The reminder hour should follow the evidence, not a hunch. This prints the hour-by-hour
    distribution of completed runs (each stamped in that player's own zone, ET when unknown) so
    push_reminder_hour_local can be set from data.

    Reading it: a reminder wants to sit ahead of the natural peak, with enough of the day left that
    acting on it is easy. A flat distribution means the sample is too small to tune on yet; leave
    the setting alone rather than over-fitting a handful of runs.
    """
    from collections import Counter

    from sqlalchemy import select

    from app.core.config import settings
    from app.models import ContestWindow, Entry, Profile
    from app.models.contest import SUBMITTED
    from app.services.localtime import resolve_zone

    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(Entry.submitted_at, Profile.timezone)
                .join(ContestWindow, ContestWindow.id == Entry.window_id)
                .join(Profile, Profile.user_id == Entry.user_id)
                .where(
                    Entry.status == SUBMITTED,
                    Entry.submitted_at.isnot(None),
                    ContestWindow.slot == "royale",
                )
            )
        ).all()
    await engine.dispose()

    if not rows:
        print("play-times: no completed Daily Royale runs yet — nothing to tune on")
        return 0

    hours: Counter[int] = Counter()
    known_tz = 0
    for submitted_at, tz_name in rows:
        if tz_name:
            known_tz += 1
        hours[submitted_at.astimezone(resolve_zone(tz_name)).hour] += 1

    total = sum(hours.values())
    peak = max(hours.items(), key=lambda kv: kv[1])[0]
    print(f"play-times: {total} completed run(s); {known_tz} had a real timezone, rest assumed ET")
    print()
    print("  local hour   runs")
    for hour in range(24):
        n = hours.get(hour, 0)
        bar = "#" * min(40, n)
        marker = "  <- peak" if hour == peak and n else ""
        print(f"  {hour:02d}:00     {n:>5}  {bar}{marker}")
    print()
    print(f"  busiest local hour: {peak:02d}:00")
    print(f"  current push_reminder_hour_local = {settings.push_reminder_hour_local}")
    print("  a reminder works best AHEAD of the peak; with a small sample, leave the setting alone")
    return 0


async def _push_test(argv: list[str]) -> int:
    """Send ONE test push to ONE account — the only honest end-to-end check of a transport.

    `push-status` proves the keys are present in THIS service's environment. It cannot prove Apple
    accepts them: a wrong Team ID, a key not enabled for push, or a bundle-id mismatch all look
    identical to a correct setup until a real send is attempted. This does that send, to a single
    named account, and reports the per-device outcome.

    Bypasses the frequency governor on purpose — it is a manual diagnostic, not a campaign, and a
    quiet-hours block would look exactly like a broken transport.
    """
    from sqlalchemy import select

    from app.core.config import settings
    from app.models import Profile
    from app.services.push import PushExpired, _subs_for_users, build_sender

    if "--username" not in argv:
        raise SystemExit("usage: python -m app.jobs.run push-test --username <name>")
    username = argv[argv.index("--username") + 1]

    sender = build_sender(settings)
    if sender is None:
        print("push-test: NO transport configured in this service — nothing could be sent")
        return 1

    async with SessionLocal() as session:
        # username lives on the PROFILE, not the user row.
        user_id = (
            await session.execute(select(Profile.user_id).where(Profile.username == username))
        ).scalar_one_or_none()
        if user_id is None:
            print(f"push-test: no user named {username!r}", file=sys.stderr)
            await engine.dispose()
            return 1
        subs = (await _subs_for_users(session, {user_id})).get(user_id, [])
    payload = {
        "title": "Rot Royale test 🔧",
        "body": "If you can read this, push is working.",
        "url": "/",
    }

    if not subs:
        print(f"push-test: {username} has NO registered devices — nothing to send to.")
        print("  the app must be opened once, on a build that registers a token, before this works")
        await engine.dispose()
        return 1

    ok = 0
    for sub in subs:
        platform = sub.get("platform", "web")
        try:
            await sender(sub, payload)
        except PushExpired:
            print(f"  {platform:<8} DEAD  — the device token is no longer valid")
            continue
        except Exception as exc:  # noqa: BLE001 - the message IS the diagnostic
            print(f"  {platform:<8} FAIL  — {type(exc).__name__}: {exc}")
            continue
        # A transport that isn't configured is SKIPPED silently by build_sender, so "sent" here
        # means "handed to a live transport", not merely "no exception".
        live = {
            "web": settings.push_enabled,
            "ios": settings.apns_enabled,
            "android": settings.fcm_enabled,
        }
        if not live.get(str(platform), False):
            print(f"  {platform:<8} SKIPPED — no {platform} transport in this service's env")
            continue
        print(f"  {platform:<8} sent")
        ok += 1
    await engine.dispose()
    print(f"push-test: {ok}/{len(subs)} device(s) accepted the send")
    return 0 if ok else 1


async def _push_status() -> int:
    """Read-only: which push transports are configured, and how many devices await each.

    Two independent things have to be true for a notification to land, and a missing either one
    looks identical from the outside — silence. Config without devices means the app never asked
    for permission; devices without config means the server drops them on the floor. Printing both
    side by side turns "it didn't work" into a specific next step.
    """
    from sqlalchemy import func, select

    from app.core.config import settings
    from app.models.push import PushSubscription

    live = {
        "web": settings.push_enabled,
        "ios": settings.apns_enabled,
        "android": settings.fcm_enabled,
    }
    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(PushSubscription.platform, func.count()).group_by(PushSubscription.platform)
            )
        ).all()
    await engine.dispose()

    counts = {platform: n for platform, n in rows}
    print("push-status (this service's environment):")
    for platform in ("web", "ios", "android"):
        n = counts.get(platform, 0)
        state = "CONFIGURED" if live[platform] else "not configured"
        verdict = (
            "would send"
            if live[platform] and n
            else ("no devices" if live[platform] else "SKIPPED")
        )
        print(f"  {platform:<8} {state:<15} {n:>4} device(s)  -> {verdict}")
    unknown = set(counts) - {"web", "ios", "android"}
    for platform in sorted(unknown):
        print(f"  {platform:<8} {'unknown platform':<15} {counts[platform]:>4} device(s)")
    if live["ios"] and not counts.get("ios"):
        print(
            "\n  APNs is configured but NO iOS device has registered. The app asks for permission "
            "on the device; keys alone deliver nothing."
        )
    return 0


async def _reset_stranded(argv: list[str]) -> int:
    """Free the runs the §5f protocol break wedged, so those players can enter today again.

    Default is a DRY RUN. Deleting entries is irreversible and this job exists precisely because a
    hasty change hurt players, so it makes you ask for the write explicitly with --apply.
    """
    from app.services.goodwill import reset_stranded_entries

    apply = "--apply" in argv
    async with SessionLocal() as session:
        report = await reset_stranded_entries(session, dry_run=not apply)
        if apply:
            await session.commit()
    await engine.dispose()

    verb = "deleted" if apply else "would delete (dry run — pass --apply to commit)"
    print(f"reset-stranded: {verb} {report.deleted} wedged entr(ies)")
    for eid in report.entry_ids:
        print(f"  - {eid}")
    return 0


async def _goodwill(argv: list[str]) -> int:
    """Pay the outage apology to every account, exactly once per --key.

    usage: goodwill --key outage-aug14 [--gems 5] [--coins 50] [--apply]

    The key names the INCIDENT. Re-running with the same key pays nobody twice, so a run
    interrupted by a deploy or a timeout is resumed by simply running it again.
    """
    from app.services.goodwill import GOODWILL_COINS, GOODWILL_GEMS, grant_goodwill

    def _opt(name: str, default: int) -> int:
        return int(argv[argv.index(name) + 1]) if name in argv else default

    if "--key" not in argv:
        raise SystemExit("usage: python -m app.jobs.run goodwill --key <incident-id> [--apply]")
    key = argv[argv.index("--key") + 1]
    apply = "--apply" in argv
    gems, coins = _opt("--gems", GOODWILL_GEMS), _opt("--coins", GOODWILL_COINS)

    async with SessionLocal() as session:
        report = await grant_goodwill(session, key=key, gems=gems, coins=coins, dry_run=not apply)
        if apply:
            await session.commit()
    await engine.dispose()

    verb = "granted" if apply else "would grant (dry run — pass --apply to commit)"
    print(
        f"goodwill[{key}]: {verb} {gems} gems + {coins} coins to {report.granted} account(s); "
        f"{report.already_paid} already paid, {report.skipped} skipped (no profile)"
    )

    if "--notify" in argv:
        from app.core.config import settings
        from app.services.push import build_sender, notify_goodwill

        sender = build_sender(settings)
        if sender is None:
            print("  push: NO transport configured — nobody was notified")
            return 0
        # Say which transports are live BEFORE sending. APNs needs four secrets; without them
        # `build_sender` silently skips every iOS device, which is the audience this apology is for.
        live = [
            name
            for name, on in (
                ("web", settings.push_enabled),
                ("ios", settings.apns_enabled),
                ("android", settings.fcm_enabled),
            )
            if on
        ]
        print(f"  push transports live: {', '.join(live) or 'none'}")
        if not apply:
            print("  push: dry run — pass --apply to actually send")
            return 0
        async with SessionLocal() as session:
            counts = await notify_goodwill(session, sender, gems, coins)
        print(f"  push: {counts}")
        if not settings.apns_enabled and counts.get("ios"):
            print(
                f"  !! {counts['ios']} iOS device(s) were SKIPPED — APNs is not configured, "
                f"so the players hit by the outage got the currency but no explanation"
            )
    return 0


async def _content_check() -> int:
    """Drift guard — exits non-zero if any DB question is missing from the repo bank files."""
    from content.governance import drift_report

    async with SessionLocal() as session:
        report = await drift_report(session, _content_dir())
    await engine.dispose()

    missing_repo = report["missing_from_repo"]
    missing_db = report["missing_from_db"]
    print(
        f"content-check: db_total={report['db_total']} "
        f"tracked_total={report['tracked_total']} "
        f"missing_from_repo={len(missing_repo)} "
        f"missing_from_db={len(missing_db)}"
    )
    for q in missing_repo[:10]:
        print(
            f"  MISSING {q['id']} [{q['category']}] {q['prompt'][:60]!r}",
            file=sys.stderr,
        )
    return 1 if missing_repo else 0


async def _run(command: str) -> None:
    async with SessionLocal() as session:
        if command == "seed":
            added = await load_trivia(session)
            await session.commit()
            print(f"seed: {added} trivia question(s) added")
            await engine.dispose()
            return
        if command == "backfill_starter_gems":
            granted = await backfill_starter_gems(session)
            await session.commit()
            print(f"backfill_starter_gems: granted starter gems to {granted} user(s)")
            await engine.dispose()
            return
        if command == "rot-converge":
            # Daily Rot Rating difficulty convergence (guarded exactly-once per ET day; safe to
            # run redundantly). Converges the just-completed ET day's floating pools.
            ran = await converge_rot_difficulties(session)
            await session.commit()
            print(
                "rot-converge: converged floating difficulty pools for the completed ET day"
                if ran
                else "rot-converge: already converged for the completed ET day (no-op)"
            )
            await engine.dispose()
            return
        if command in ("create", "both"):
            await ensure_upcoming_windows(session)
        if command in ("transition", "both"):
            await run_transitions(session)
        if command in ("settle", "both"):
            await settle_due_windows(session)
        if command == "both":
            # Expired (unfinished past their expiry) duels are abandoned/forfeited.
            await cleanup_expired_duels(session)
            await expire_stale_friend_duels(session)
            # Share snapshots whose window has closed: the link already 404s, but the row (a
            # username, score and placement) survived forever because this purge was never
            # scheduled. Render runs the cron entrypoint rather than the daemon, so it has to be
            # wired HERE as well or production keeps retaining data it promised to drop.
            removed = await purge_expired_share_links(session)
            if removed:
                print(f"purge_expired_share_links: removed {removed} expired share link(s)")
            # In-flight Google sign-in handshakes. Same reasoning as the share links: unusable
            # after ten minutes, but nothing deletes them, so they accumulate forever. Wired here
            # AND in the daemon because Render runs this entrypoint rather than the daemon.
            stale_oauth = await purge_expired_oauth_transactions(session)
            if stale_oauth:
                print(f"purge_expired_oauth_transactions: removed {stale_oauth} stale row(s)")
        await session.commit()
        if command in ("transition", "both"):
            await run_season_reset(session)  # monthly ladder soft-reset (exactly-once per season)
            # Evening daily-reminder + streak-saved re-engagement nudges (once per user/day).
            # The midnight window-open broadcast was retired; the daily reminder replaces it.
            await send_reengagement_pushes(session)
    await engine.dispose()


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "both"
    if command not in _COMMANDS:
        raise SystemExit(f"unknown command {command!r}; use {'|'.join(_COMMANDS)}")
    # The path argument is now OPTIONAL: omitted, each ingest resolves under the content root
    # (settings.content_root). That is what lets render.yaml stop naming repo-relative production
    # paths — deployment points ROT_CONTENT_DIR at the private bank and the commands are unchanged.
    if command == "ingest":
        args = sys.argv[2:]
        target = args[0] if args and not args[0].startswith("--") else str(_content_dir() / "bank")
        raise SystemExit(asyncio.run(_ingest(target, retire_missing="--retire-missing" in args)))
    if command == "ingest-video":
        args = sys.argv[2:]
        # The path is optional and the flag may be given alone, so a leading `--` is NOT a path.
        explicit = bool(args) and not args[0].startswith("--")
        target = args[0] if explicit else str(_content_dir() / "video" / "manifest.json")
        # A TYPED path must exist; a RESOLVED one need not (see _ingest_video).
        raise SystemExit(
            asyncio.run(
                _ingest_video(target, retire_missing="--retire-missing" in args, required=explicit)
            )
        )
    if command == "ingest-change":
        args = sys.argv[2:]
        target = (
            args[0]
            if args and not args[0].startswith("--")
            else str(_content_dir() / "change" / "manifest.json")
        )
        raise SystemExit(
            asyncio.run(_ingest_change(target, retire_missing="--retire-missing" in args))
        )
    if command == "ingest-estimate":
        args = sys.argv[2:]
        target = (
            args[0]
            if args and not args[0].startswith("--")
            else str(_content_dir() / "estimate" / "fermi.json")
        )
        retire = "--retire-missing" in args
        raise SystemExit(asyncio.run(_ingest_estimate(target, retire_missing=retire)))
    if command == "export-estimate-verdicts":
        if len(sys.argv) < 3:
            raise SystemExit("usage: python -m app.jobs.run export-estimate-verdicts <out.json>")
        raise SystemExit(asyncio.run(_export_estimate_verdicts(sys.argv[2])))
    if command == "classify":
        raise SystemExit(asyncio.run(_classify(sys.argv[2:])))
    if command == "translate":
        raise SystemExit(asyncio.run(_translate(sys.argv[2:])))
    if command == "export-translations":
        raise SystemExit(asyncio.run(_export_translations(sys.argv[2:])))
    if command == "import-translations":
        raise SystemExit(asyncio.run(_import_translations(sys.argv[2:])))
    if command == "approve-translations":
        raise SystemExit(asyncio.run(_approve_translations(sys.argv[2:])))
    if command == "review-flagged":
        raise SystemExit(asyncio.run(_review_flagged(sys.argv[2:])))
    if command == "build_campaign":
        from content.campaign.build_manifest import main as build_campaign_main

        raise SystemExit(build_campaign_main())
    if command == "recover-content":
        raise SystemExit(asyncio.run(_recover_content()))
    if command == "content-check":
        raise SystemExit(asyncio.run(_content_check()))
    if command == "play-times":
        raise SystemExit(asyncio.run(_play_times()))
    if command == "push-test":
        raise SystemExit(asyncio.run(_push_test(sys.argv[2:])))
    if command == "push-status":
        raise SystemExit(asyncio.run(_push_status()))
    if command == "reset-stranded":
        raise SystemExit(asyncio.run(_reset_stranded(sys.argv[2:])))
    if command == "goodwill":
        raise SystemExit(asyncio.run(_goodwill(sys.argv[2:])))
    asyncio.run(_run(command))


if __name__ == "__main__":
    main()
