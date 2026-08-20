"""Re-seed one trivia category: delete its questions, then ingest a bank file.

The ingester dedupes on (question, category) and NEVER updates existing rows, so pushing edited
question content (reworded options, tightened stems) needs the old rows removed first. This is safe:
nothing FK-references questions.id — round history stores answer snapshots, not references.

Run (from backend/):
    uv run python scripts/reseed_category.py "Street Smarts" content/bank/street_smarts.json
"""

from __future__ import annotations

import asyncio
import sys

from app.core.db import SessionLocal, engine
from app.models import Question
from content.ingest import ingest_bank, read_bank_rows
from sqlalchemy import delete


async def reseed(category: str, bank: str) -> None:
    rows = read_bank_rows(bank)
    async with SessionLocal() as session:
        result = await session.execute(
            delete(Question).where(Question.category == category, Question.module_type == "trivia")
        )
        report = await ingest_bank(session, rows)
        await session.commit()
        print(
            f"[{category}] deleted {result.rowcount} old rows; "
            f"added {report.added}, skipped {report.skipped}, rejected {len(report.rejected)}"
        )
        for idx, why in report.rejected:
            print(f"  rejected row {idx}: {why}")
    await engine.dispose()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit('usage: python scripts/reseed_category.py "<Category>" <bank.json|dir>')
    asyncio.run(reseed(sys.argv[1], sys.argv[2]))
