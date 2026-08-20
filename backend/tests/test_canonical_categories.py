"""The locked canonical category taxonomy (categories milestone).

The picker must show ONLY canonical categories — no legacy/near-duplicate leftovers — and ingest
must reject any non-canonical category so the set stays locked when real content arrives.
"Money & Business" is the locked seventh (Brain Boost self-improvement layer); its content arrives
via content/bank/money_business.json, not the legacy seed.
"""

from __future__ import annotations

from conftest import requires_production_content
from content.categories import CANONICAL_CATEGORIES
from content.ingest import ingest_bank
from content.loader import list_categories, load_trivia
from sqlalchemy.ext.asyncio import AsyncSession

# Whole module depends on the PRODUCTION content corpus — see conftest for why.
pytestmark = requires_production_content


def test_there_are_exactly_eight_locked_categories():
    assert len(CANONICAL_CATEGORIES) == 8
    assert set(CANONICAL_CATEGORIES) == {
        "Science & Nature",
        "History",
        "Geography",
        "Arts & Literature",
        "Sports",
        "Pop Culture & Entertainment",
        "Money & Business",
        "Street Smarts",
    }


async def test_seed_serves_only_canonical_categories(db_session: AsyncSession):
    # After reconciliation the legacy 9-category seed folds into the original canonical 6 — the
    # picker shows those and nothing else (no "Science", "Music", "Numbers", etc. leftovers).
    # Money & Business and Street Smarts are not in the legacy seed; they ship via reviewed bank
    # files (money_business.json / street_smarts.json), not load_trivia.
    await load_trivia(db_session)
    names = {c["name"] for c in await list_categories(db_session)}
    assert names == set(CANONICAL_CATEGORIES) - {"Money & Business", "Street Smarts"}
    assert names <= set(CANONICAL_CATEGORIES)


async def test_money_business_seed_bank_ingests_cleanly(db_session: AsyncSession):
    # The reviewed finance/business bank must validate row-for-row (loud ingest contract) and land
    # servable under the canonical seventh category with its icon.

    from app.core.config import settings
    from content.ingest import read_bank_rows

    bank_path = settings.content_root / "bank" / "money_business.json"
    rows = read_bank_rows(bank_path)
    assert len(rows) >= 20
    report = await ingest_bank(db_session, rows)
    assert report.rejected == []
    assert report.added == len(rows)

    names = {c["name"]: c["count"] for c in await list_categories(db_session)}
    assert names.get("Money & Business", 0) == len(rows)


async def test_ingest_rejects_a_non_canonical_category(db_session: AsyncSession):
    row = {
        "category": "Sciense & Nature",  # typo / near-duplicate — must not create a 7th category
        "question": "Q?",
        "options": ["a", "b", "c", "d"],
        "correct_index": 0,
        "difficulty": "easy",
        "explanation": "ok",
    }
    report = await ingest_bank(db_session, [row])
    assert report.added == 0
    assert report.rejected
    assert "category" in report.rejected[0][1].lower()
