"""Outage remediation — reset the runs the §5f protocol break stranded, and pay the goodwill grant.

Both halves are written to be RE-RUNNABLE, because a remediation job that can only be run once is a
job nobody dares run at all. The reset is naturally idempotent (a deleted entry is not found twice);
the grant leans on the ledgers' `idempotency_key`, so paying twice is a no-op rather than a
double-payout.

Background: the second chance withholds the `RoundResult` so the sequence guard still blocks the
next idx. A client that does not understand the offer advances anyway and then wedges against that
guard — the run dies mid-play. The protocol is fixed (§5f, `supports_retry`), but runs already
wedged stay wedged: the entry is IN_PROGRESS forever and `uq_entry_window_user` blocks a fresh one.
Deleting the entry is what unblocks the player.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ContestWindow, Entry, RoundAnswer, User
from app.models.contest import IN_PROGRESS, OPEN
from app.models.gem_ledger import GemLedger
from app.services.gem_ledger import record_gem_delta
from app.services.ledger import record_coin_delta

GOODWILL_GEMS = 5
GOODWILL_COINS = 50
GOODWILL_REASON = "goodwill_outage"  # ledger `reason` is String(64)

# A pending offer is only EVIDENCE of a wedge once it can no longer be answered. A player who is
# mid-second-chance right now looks identical in the data, and deleting their entry would make the
# remediation its own outage — so anything younger than this is left alone. The retry window itself
# is seconds; minutes of slack costs nothing and removes the race entirely.
STRANDED_GRACE_MINUTES = 5


@dataclass
class ResetReport:
    deleted: int = 0
    entry_ids: list[uuid.UUID] = field(default_factory=list)
    dry_run: bool = False


@dataclass
class GoodwillReport:
    granted: int = 0
    already_paid: int = 0
    skipped: int = 0  # no profile row → nothing to credit
    gems: int = GOODWILL_GEMS
    coins: int = GOODWILL_COINS
    dry_run: bool = False


async def find_stranded_entries(
    session: AsyncSession, now: datetime | None = None
) -> list[uuid.UUID]:
    """Entries on an OPEN royale window holding an unanswerable second-chance offer.

    Deliberately narrow. It does NOT sweep every unfinished run: an abandoned entry is ordinary and
    resetting it would hand out a replay nobody is owed. The pending offer is what distinguishes a
    run the SERVER stranded from one the player simply walked away from.
    """
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(minutes=STRANDED_GRACE_MINUTES)

    rows = (
        await session.execute(
            select(Entry.id, RoundAnswer.retry)
            .join(RoundAnswer, RoundAnswer.entry_id == Entry.id)
            .join(ContestWindow, ContestWindow.id == Entry.window_id)
            .where(
                ContestWindow.slot == "royale",
                ContestWindow.state == OPEN,
                Entry.status == IN_PROGRESS,
                RoundAnswer.retry.isnot(None),
            )
        )
    ).all()

    stranded: list[uuid.UUID] = []
    for entry_id, retry in rows:
        # The SQL filter is a narrowing pass, NOT the authority. JSONB renders an explicit Python
        # None as JSON `null` rather than SQL NULL, and attempt 2 consumes the offer with exactly
        # that (`answer.retry = None`) — so every SUCCESSFULLY COMPLETED second chance still passes
        # `retry IS NOT NULL`. Only a dict carrying a real timestamp is an outstanding offer;
        # anything else is a resolved round and must not be deleted.
        offered_at = _offered_at(retry)
        if offered_at is not None and offered_at <= cutoff:
            stranded.append(entry_id)
    return stranded


def _offered_at(retry: dict[str, Any] | None) -> datetime | None:
    if not isinstance(retry, dict):
        return None
    raw = retry.get("at")
    if not isinstance(raw, str):
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


async def reset_stranded_entries(
    session: AsyncSession, now: datetime | None = None, *, dry_run: bool = False
) -> ResetReport:
    """Delete the wedged entries so `uq_entry_window_user` no longer blocks a fresh /enter.

    Round answers, results and any bound cognition instances go with the entry (all FKs are
    ON DELETE CASCADE), so the replay is served the identical 8 questions — the seed is a pure
    function of the WINDOW, not the entry.
    """
    ids = await find_stranded_entries(session, now)
    if ids and not dry_run:
        await session.execute(delete(Entry).where(Entry.id.in_(ids)))
        await session.flush()
    return ResetReport(deleted=len(ids), entry_ids=ids, dry_run=dry_run)


async def grant_goodwill(
    session: AsyncSession,
    *,
    key: str,
    gems: int = GOODWILL_GEMS,
    coins: int = GOODWILL_COINS,
    dry_run: bool = False,
) -> GoodwillReport:
    """Credit every account, exactly once per `key`.

    `key` names the INCIDENT, so a later apology can pay the same players again without this one
    being re-paid. Per-user idempotency keys mean a partial run (timeout, deploy, crash) is resumed
    simply by running it again.
    """
    report = GoodwillReport(gems=gems, coins=coins, dry_run=dry_run)
    user_ids = list((await session.execute(select(User.id))).scalars().all())

    for user_id in user_ids:
        ident = f"goodwill:{key}:{user_id}"
        gem_key, coin_key = f"{ident}:gems", f"{ident}:coins"

        # Asked BEFORE the write rather than inferred from what the ledger returns. record_*_delta
        # hands back the pre-existing row on a repeat, which is indistinguishable from a fresh one
        # without inspecting session state — and the count is the whole point of the report.
        paid = await session.scalar(
            select(GemLedger.id).where(GemLedger.idempotency_key == gem_key)
        )
        if paid is not None:
            report.already_paid += 1
            continue
        if dry_run:
            report.granted += 1
            continue
        try:
            await record_gem_delta(
                session, user_id, gems, GOODWILL_REASON, ref_key=key, idempotency_key=gem_key
            )
            await record_coin_delta(
                session, user_id, coins, GOODWILL_REASON, ref_key=key, idempotency_key=coin_key
            )
        except ValueError:
            # No profile row — nothing to credit. Counted, not fatal: one malformed account must
            # not stop the payout for everyone after it.
            report.skipped += 1
            continue
        report.granted += 1
    await session.flush()
    return report
