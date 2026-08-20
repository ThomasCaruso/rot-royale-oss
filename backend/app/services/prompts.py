"""Which one-time prompt, if any, this player should see next.

The SERVER decides. The client asks "anything to show?" and renders the answer, so the timing rules
below can change on a deploy instead of an App Store release — the §5f outage is the standing
argument for keeping decisions off the shipped binary.

Two rules shape everything here:

  * NEVER on first open. A player who has not finished a run has no reason to say yes, and on iOS a
    denied notification permission is effectively permanent — the OS will not ask twice. The ask is
    worth exactly one shot, so it is spent after the player has actually enjoyed something.
  * ONE at a time. Both prompts can come due together; stacking them is how an app gets muted. The
    queue drains one per moment, in priority order.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ContestWindow, Entry, PushSubscription
from app.models.contest import SUBMITTED
from app.models.gem_ledger import GemLedger
from app.models.prompt import (
    ACCEPTED,
    DISMISSED,
    PROMPT_GOODWILL,
    PROMPT_NOTIFICATIONS,
    PROMPT_RATE,
    UserPromptAck,
)

# How many COMPLETED Daily Royale runs before each ask. The notification opt-in rides the first
# finish (the earliest honest moment); the rating ask waits until the player has come back twice
# more, which is the difference between "I tried this" and "I like this".
NOTIFICATIONS_AFTER_RUNS = 1
RATE_AFTER_RUNS = 3


async def royales_completed(session: AsyncSession, user_id: uuid.UUID) -> int:
    """Lifetime FINISHED Daily Royale runs. An abandoned run is not an accomplishment."""
    return int(
        await session.scalar(
            select(func.count())
            .select_from(Entry)
            .join(ContestWindow, ContestWindow.id == Entry.window_id)
            .where(
                Entry.user_id == user_id,
                Entry.status == SUBMITTED,
                ContestWindow.slot == "royale",
            )
        )
        or 0
    )


async def _answered(session: AsyncSession, user_id: uuid.UUID) -> set[str]:
    rows = await session.execute(
        select(UserPromptAck.prompt_id).where(UserPromptAck.user_id == user_id)
    )
    return set(rows.scalars().all())


async def _has_push(session: AsyncSession, user_id: uuid.UUID) -> bool:
    """Real, player-granted push. A PROVISIONAL row is deliberately not counted: that permission was
    taken silently, the player never agreed to anything, and delivery is quiet. Treating it as
    consent would suppress the very ask that upgrades them to prominent delivery."""
    return (
        await session.scalar(
            select(PushSubscription.id)
            .where(
                PushSubscription.user_id == user_id,
                PushSubscription.provisional.is_(False),
            )
            .limit(1)
        )
    ) is not None


async def _was_paid_goodwill(session: AsyncSession, user_id: uuid.UUID) -> bool:
    from app.services.goodwill import GOODWILL_REASON

    return (
        await session.scalar(
            select(GemLedger.id)
            .where(GemLedger.user_id == user_id, GemLedger.reason == GOODWILL_REASON)
            .limit(1)
        )
    ) is not None


async def next_prompt(session: AsyncSession, user_id: uuid.UUID) -> str | None:
    """The single prompt to show now, or None. Priority order is deliberate."""
    answered = await _answered(session, user_id)

    # 1. The apology first. Someone owed an explanation gets it before being asked for anything —
    #    asking a player for a favour while they're still confused about a bug is the wrong order.
    if PROMPT_GOODWILL not in answered and await _was_paid_goodwill(session, user_id):
        return PROMPT_GOODWILL

    runs = await royales_completed(session, user_id)
    if runs < NOTIFICATIONS_AFTER_RUNS:
        return None  # nothing is asked before the first finished run

    # 2. Notifications, once they've finished a run — but never to a player who already subscribed
    #    (on any device), where the ask would be nonsense.
    if PROMPT_NOTIFICATIONS not in answered and not await _has_push(session, user_id):
        return PROMPT_NOTIFICATIONS

    # 3. The rating ask, once they've come back twice more.
    if PROMPT_RATE not in answered and runs >= RATE_AFTER_RUNS:
        return PROMPT_RATE
    return None


async def ack_prompt(
    session: AsyncSession, user_id: uuid.UUID, prompt_id: str, *, outcome: str = DISMISSED
) -> None:
    """Record the answer. Upsert, so a double-tap or a retried request is harmless."""
    if outcome not in (ACCEPTED, DISMISSED):
        raise ValueError(f"unknown outcome {outcome!r}")
    await session.execute(
        pg_insert(UserPromptAck)
        .values(user_id=user_id, prompt_id=prompt_id, outcome=outcome)
        .on_conflict_do_update(index_elements=["user_id", "prompt_id"], set_={"outcome": outcome})
    )
    await session.flush()


def in_provisional_cohort(user_id: uuid.UUID, pct: int | None = None) -> bool:
    """Stable per-user membership of the quiet-push rollout.

    Hashed rather than random so a player's cohort never flips between two calls — a device that
    registered a quiet token yesterday must not be told it's out of the cohort today, which would
    leave a registered token nobody ever sends to. Raising the percentage only ever ADDS players.
    """
    from app.core.config import settings

    share = settings.push_provisional_rollout_pct if pct is None else pct
    if share <= 0:
        return False
    if share >= 100:
        return True
    # int.from_bytes over the raw uuid: uniform, stable across processes (unlike hash()), no salt
    # needed because the cohort isn't a secret.
    return int.from_bytes(user_id.bytes, "big") % 100 < share
