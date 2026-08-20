"""The expired-share-link purge must actually be SCHEDULED, not merely defined.

`purge_expired_challenges` and its `purge_expired_share_links` task wrapper both existed and were
correct — and neither was ever called by the daemon or the cron entrypoint. Production accumulated
50 expired snapshots (the oldest three weeks old), each still holding a username, score and
placement for a link that had already stopped resolving. The expiry is a privacy promise, so a
404 alone does not honour it; the row has to go.

A behavioural test of the purge alone would pass against the broken code, because the purge
function itself was fine. So these assert the WIRING — that both entrypoints actually CALL it.
Verified to fail when the call is removed.
"""

from __future__ import annotations

import inspect
from datetime import UTC, datetime, timedelta

from app.jobs import daemon, run
from app.models import Challenge, ContestWindow
from app.models.contest import CLOSED, OPEN
from app.services.challenge import purge_expired_challenges
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Assert the CALL, not the name. The first version of these tests checked whether the module
# source merely mentioned `purge_expired_share_links` — which the import statement satisfies, so
# they passed even with the call deleted. Matching the invocation is what makes them bite.
_CALL = "purge_expired_share_links(session)"


def test_daemon_tick_purges_expired_share_links() -> None:
    """The long-running scheduler must CALL the purge on its tick, not merely import it."""
    assert _CALL in inspect.getsource(daemon._tick), (
        "the daemon tick no longer purges expired share links — expired snapshots would be "
        "retained indefinitely"
    )


def test_cron_entrypoint_purges_expired_share_links() -> None:
    """Render runs `python -m app.jobs.run both` rather than the daemon, so it must purge too."""
    assert _CALL in inspect.getsource(run), (
        "app.jobs.run no longer purges expired share links — on Render (which uses the cron "
        "entrypoint, not the daemon) nothing would ever delete them"
    )


async def _window(session: AsyncSession, *, closed: bool) -> ContestWindow:
    # One royale window per ET date (uq_window_date_slot), so the two cases need distinct dates.
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=(now - timedelta(days=30 if closed else 31)).date(),
        slot="royale",
        open_at=now - timedelta(days=2),
        close_at=now - timedelta(days=1) if closed else now + timedelta(hours=1),
        state=CLOSED if closed else OPEN,
        template_id="dr_8_trivia",
    )
    session.add(window)
    await session.flush()
    return window


async def test_purge_removes_only_closed_window_links(db_session: AsyncSession) -> None:
    """The row itself is deleted once the window closes; a live link is untouched."""
    from app.core.security import hash_password
    from app.models import Entry, User
    from app.models.contest import SUBMITTED

    user = User(email="purge@example.com", password_hash=hash_password("super-secret-pw"))
    db_session.add(user)
    await db_session.flush()

    made = []
    for closed in (True, False):
        window = await _window(db_session, closed=closed)
        entry = Entry(
            window_id=window.id,
            user_id=user.id,
            is_practice=False,
            seed=1,
            round_set=[],
            started_at=datetime.now(UTC),
            submitted_at=datetime.now(UTC),
            total_score=100,
            status=SUBMITTED,
        )
        db_session.add(entry)
        await db_session.flush()
        challenge = Challenge(
            id=f"purge{'C' if closed else 'O'}",
            entry_id=entry.id,
            creator_user_id=user.id,
            window_id=window.id,
            contest_date=window.contest_date,
            contest_no=1,
            username="purge_user",
            score=100,
        )
        db_session.add(challenge)
        made.append(challenge.id)
    await db_session.flush()

    removed = await purge_expired_challenges(db_session)
    await db_session.flush()

    surviving = set(
        (await db_session.scalars(select(Challenge.id).where(Challenge.id.in_(made)))).all()
    )
    assert removed >= 1
    assert "purgeC" not in surviving, "an expired snapshot must be deleted, not just un-served"
    assert "purgeO" in surviving, "a link whose window is still open must survive"
