"""How the Daily Royale plan DRAWS its interactive content.

The plan pins one item per interactive slot. Two properties matter and neither was covered:

1. **No item repeats inside a run.** Slots used to draw independently from the whole bank, so the
   same item could land twice in one day — worth free points, because a replayed change pair means
   the player already knows where to tap, and a replayed estimate item means they already know the
   answer. With three change slots and a 20-pair bank that is a ~15% chance per day.
2. **The run opens easy and closes hard.** royale_sequencing places the TYPES that way; the item
   drawn for those slots should follow the same shape.

Both are pure functions of the window seed, so a plan must also be identical when recomputed.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from app.models import CognitionChangeItem, CognitionEstimateItem, ContestWindow
from app.models.contest import OPEN
from app.services.royale_rounds import provision_royale_plan
from content.loader import load_trivia
from sqlalchemy.ext.asyncio import AsyncSession


async def _base_content(session: AsyncSession, estimates: int = 6) -> None:
    """Trivia plus enough estimate items that a repeat would be a choice, not a necessity."""
    await load_trivia(session)
    for i in range(estimates):
        session.add(
            CognitionEstimateItem(
                prompt=f"How many? {i}",
                answer=Decimal("100"),
                unit="things",
                components=[],
                reveal_explanation="e",
                difficulty="direct",
                acceptable_pct=Decimal("20"),
                source_id=f"fer_draw_{i}",
            )
        )
    await session.flush()


async def _window(session: AsyncSession, day_offset: int = 0) -> ContestWindow:
    now = datetime.now(UTC)
    w = ContestWindow(
        slot="royale",
        contest_date=date(2026, 9, 1) + timedelta(days=day_offset),
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=23),
        state=OPEN,
        template_id="dr_8_trivia",
    )
    session.add(w)
    await session.flush()
    return w


async def _change_bank(session: AsyncSession, tiers: list[str]) -> None:
    """A change bank with an explicit difficulty per item."""
    for i, tier in enumerate(tiers):
        session.add(
            CognitionChangeItem(
                key=f"chg_{i:02d}",
                base_asset=f"chg_{i:02d}_base.png",
                altered_asset=f"chg_{i:02d}_altered.png",
                width=1024,
                height=683,
                bbox_x=0.4,
                bbox_y=0.4,
                bbox_w=0.1,
                bbox_h=0.1,
                difficulty=tier,
            )
        )
    await session.flush()


def _refs(plan: list[dict], key: str) -> list[str]:
    return [p["content_ref"][key] for p in plan if key in p["content_ref"]]


@pytest.mark.asyncio
async def test_no_item_repeats_within_a_run(db_session: AsyncSession):
    """The defect this pins: independent per-slot draws could hand out the same item twice.

    Swept across 40 window dates rather than one, because a single date proves nothing — the old
    code only collided *sometimes*. With a 9-item change bank and ~3 change slots the per-day
    collision chance was ~30%, so 40 days makes a surviving bug essentially certain to show
    (P(miss) ≈ 4e-7) instead of the test passing by luck.
    """
    await _base_content(db_session)
    await _change_bank(db_session, ["easy", "medium", "hard"] * 3)

    for day in range(1, 41):
        window = await _window(db_session, day)
        plan = await provision_royale_plan(db_session, window)
        assert plan is not None
        for key in ("change_item_id", "estimate_item_id"):
            drawn = _refs(plan, key)
            assert len(drawn) == len(set(drawn)), (
                f"{key} repeated within one run on day {day}: {drawn}"
            )


@pytest.mark.asyncio
async def test_plan_is_deterministic_for_a_window(db_session: AsyncSession):
    await _base_content(db_session)
    await _change_bank(db_session, ["easy", "medium", "hard"] * 3)
    window = await _window(db_session)

    first = await provision_royale_plan(db_session, window)
    # Recomputing from scratch (as a concurrent first-enter would) must converge on the same plan.
    window.round_plan = None
    second = await provision_royale_plan(db_session, window)
    assert first == second


@pytest.mark.asyncio
async def test_a_thin_bank_still_fills_every_slot(db_session: AsyncSession):
    """Fewer items than slots must degrade to repeats rather than failing to provision — the
    no-repeat rule is a preference, not a constraint that can starve the plan."""
    await _base_content(db_session)
    await _change_bank(db_session, ["medium"])
    plan = await provision_royale_plan(db_session, await _window(db_session))
    assert plan is not None
    assert len(plan) == 8
    assert all(p["type"] != "change_detection" or p["content_ref"]["change_item_id"] for p in plan)
