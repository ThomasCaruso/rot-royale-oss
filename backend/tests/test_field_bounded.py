"""H-2 regression: the window field is bounded for scale, and the caller's standing stays correct.

`GET /contests/{id}/field` used to return EVERY submitted entry to every viewer — O(field) mem and
bandwidth per leaderboard open, an OOM/egress risk once the (global, daily) field grows with the
player base. `window_field` now returns only the top slice by score, plus the true field size and
the caller's own rank/score over the FULL field — so a player below the slice still gets a correct
"Nth of M" instead of vanishing from their own leaderboard.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.models import ContestWindow, Entry, Profile, RoundResult, User
from app.models.contest import OPEN, SUBMITTED
from app.services.contest import window_field
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


async def _user(session: AsyncSession) -> User:
    u = User(email=f"{uuid.uuid4().hex}@fb.test", password_hash="x")
    session.add(u)
    await session.flush()
    session.add(Profile(user_id=u.id, username=f"u{uuid.uuid4().hex[:10]}", division="Bronze"))
    await session.flush()
    return u


async def _window(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    w = ContestWindow(
        contest_date=now.date(),
        slot="midday",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=OPEN,
        template_id="m2_trivia_7",
    )
    session.add(w)
    await session.flush()
    return w


async def _entry(session: AsyncSession, w: ContestWindow, u: User, score: int) -> None:
    now = datetime.now(UTC)
    entry = Entry(
        window_id=w.id,
        user_id=u.id,
        seed=1,
        round_set=[],
        started_at=now,
        submitted_at=now,
        total_score=score,
        status=SUBMITTED,
    )
    session.add(entry)
    await session.flush()
    # A submitted entry always has round_results in production (created on submit); the field's
    # entries list is an inner join on them, so seed one so the entry actually appears in the slice.
    session.add(
        RoundResult(
            entry_id=entry.id,
            idx=0,
            module_type="trivia",
            points=score,
            correct=True,
            time_frac=1.0,
            valid=True,
            flags=[],
        )
    )
    await session.flush()


async def test_field_is_bounded_but_size_and_rank_are_true(db_session: AsyncSession):
    w = await _window(db_session)
    # 5 entries with distinct descending scores; the last-placed one is our viewer.
    users = [await _user(db_session) for _ in range(5)]
    scores = [500, 400, 300, 200, 100]
    for u, s in zip(users, scores, strict=True):
        await _entry(db_session, w, u, s)
    viewer = users[-1]  # score 100 → last place (rank 5 of 5)

    # Cap the slice at 2 — the viewer is NOT in it, but their standing must still be correct.
    result = await window_field(db_session, w.id, viewer_user_id=viewer.id, top_n=2)

    assert len(result.entries) == 2, "slice must be bounded to top_n"
    assert result.field_size == 5, "field_size is the TRUE total, not the slice length"
    assert result.viewer_rank == 5, "viewer ranked below the slice still gets their real rank"
    assert result.viewer_score == 100
    # The slice holds the two HIGHEST scorers (500, 400), heaviest first — not the viewer.
    assert [sum(e.points) for e in result.entries] == [500, 400]


async def test_top_scorer_ranks_first_and_appears_in_slice(db_session: AsyncSession):
    w = await _window(db_session)
    users = [await _user(db_session) for _ in range(3)]
    for u, s in zip(users, [900, 800, 700], strict=True):
        await _entry(db_session, w, u, s)
    top = users[0]
    result = await window_field(db_session, w.id, viewer_user_id=top.id, top_n=50)
    assert result.field_size == 3
    assert result.viewer_rank == 1
    assert result.viewer_score == 900


async def test_non_entrant_has_no_rank(db_session: AsyncSession):
    w = await _window(db_session)
    player = await _user(db_session)
    await _entry(db_session, w, player, 500)
    watcher = await _user(db_session)  # never entered this window
    result = await window_field(db_session, w.id, viewer_user_id=watcher.id, top_n=50)
    assert result.field_size == 1
    assert result.viewer_rank is None
    assert result.viewer_score == 0


async def test_ties_share_the_higher_rank(db_session: AsyncSession):
    w = await _window(db_session)
    a, b, c = [await _user(db_session) for _ in range(3)]
    await _entry(db_session, w, a, 500)
    await _entry(db_session, w, b, 500)  # tied with a
    await _entry(db_session, w, c, 100)
    # Both leaders are rank 1 (competition ranking: count of strictly-higher + 1).
    ra = await window_field(db_session, w.id, viewer_user_id=a.id, top_n=50)
    rc = await window_field(db_session, w.id, viewer_user_id=c.id, top_n=50)
    assert ra.viewer_rank == 1
    assert rc.viewer_rank == 3  # two strictly above c
