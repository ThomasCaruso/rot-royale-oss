"""Daily difficulty-convergence batch + the ANCHOR (docs/architecture.md §9).

Estimate/notice difficulties FLOAT: they converge on observed pass rate each day,
then the pool is re-centred to its seed mean so a strong-player cohort attacking
hard items cannot drift the overall scale. Trivia ("know") difficulties are the
fixed anchor and are never created/updated by the batch.

The required property (user's own spec): a cohort of strong players passing hard
items cannot drift the overall scale — after convergence the floating pool's mean
returns to the seed mean, even though individual item ratings move.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.core import constants as C
from app.models import ContestWindow, Entry, RoundAnswer, RoundResult
from app.models.contest import OPEN, SUBMITTED
from app.models.rot_rating import RotDifficultyRating, RotSubRating
from app.services.rot_rating_store import converge_difficulties
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register",
        json={"email": email, "username": username, "password": "super-secret-pw"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _royale_window(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=now.date(),
        slot="royale",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=OPEN,
        template_id="dr_8_trivia",
    )
    session.add(window)
    await session.flush()
    return window


async def _strong_estimate_run(
    client: AsyncClient,
    session: AsyncSession,
    window: ContestWindow,
    email: str,
    username: str,
    *,
    bands: list[str],
) -> None:
    """A saved user plays a synthetic estimate-only Royale in the day's shared window, passing
    every hard item — modelled by inserting a SUBMITTED entry with per-round results + answers
    carrying the band. (The batch only reads RoundResult correctness + the answer's band.)"""
    token = await _register(client, email, username)
    me = (await client.get("/me", headers=_auth(token))).json()
    user_id = me["user_id"]
    now = datetime.now(UTC)
    entry = Entry(
        window_id=window.id,
        user_id=user_id,
        seed=1,
        status=SUBMITTED,
        round_set=[],
        started_at=now,
        submitted_at=now,
        total_score=0,
    )
    session.add(entry)
    await session.flush()
    # Give the player a strong estimate sub-rating so "strong cohort" is real.
    session.add(
        RotSubRating(
            user_id=user_id,
            verb="estimate",
            rating=1900.0,
            rd=C.ROT_RD_FLOOR,
            vol=C.ROT_SEED_VOL,
            rounds=40,
        )
    )
    for idx, band in enumerate(bands):
        session.add(
            RoundAnswer(
                entry_id=entry.id,
                idx=idx,
                module_type="estimate",
                server_answer={"interactive": True, "module_type": "estimate", "difficulty": band},
            )
        )
        session.add(
            RoundResult(
                entry_id=entry.id,
                idx=idx,
                module_type="estimate",
                points=200,
                correct=True,  # strong players PASS the hard items
                time_frac=0.0,
                valid=True,
                flags=[],
                answered_at=now,
            )
        )
    await session.flush()


async def test_batch_pins_pool_mean_to_seed_mean(client: AsyncClient, db_session: AsyncSession):
    # Seed a floating pool spread across bands, already on their seeds.
    for band in ("easy", "medium", "hard"):
        db_session.add(
            RotDifficultyRating(
                key=f"estimate:{band}",
                verb="estimate",
                rating=C.ROT_DIFFICULTY_SEED[band],
                rd=C.ROT_SEED_RD,
                vol=C.ROT_SEED_VOL,
                games=0,
                fixed=False,
            )
        )
    await db_session.flush()
    seed_mean = sum(C.ROT_DIFFICULTY_SEED[b] for b in ("easy", "medium", "hard")) / 3

    # A cohort of strong players hammers HARD items (and touches the others), all passing.
    window = await _royale_window(db_session)
    for i in range(6):
        await _strong_estimate_run(
            client,
            db_session,
            window,
            f"str{i}@e.com",
            f"strong{i}",
            bands=["hard", "hard", "hard", "hard", "medium", "medium", "easy", "hard"],
        )

    today = datetime.now(UTC).date()
    await converge_difficulties(db_session, today)

    rows = {
        r.key: r
        for r in (
            await db_session.execute(
                select(RotDifficultyRating).where(RotDifficultyRating.verb == "estimate")
            )
        )
        .scalars()
        .all()
    }
    # The hard item was passed proportionally more, so it converged toward "easier": the seed gap
    # hard-easy (400) NARROWS (individual ratings did move), while staying ordered.
    gap = rows["estimate:hard"].rating - rows["estimate:easy"].rating
    assert 0 < gap < 400.0
    assert rows["estimate:hard"].games > 0
    # ...but the anchor pins the POOL MEAN back to the seed mean -> the overall scale can't drift.
    mean = sum(r.rating for r in rows.values()) / len(rows)
    assert abs(mean - seed_mean) < 1e-6


async def test_batch_is_guarded_exactly_once_per_day(client: AsyncClient, db_session: AsyncSession):
    # The batch is not idempotent; the day-marker guard must make a second run a no-op.
    db_session.add(
        RotDifficultyRating(
            key="estimate:hard",
            verb="estimate",
            rating=C.ROT_DIFFICULTY_SEED["hard"],
            rd=C.ROT_SEED_RD,
            vol=C.ROT_SEED_VOL,
            games=0,
            fixed=False,
        )
    )
    await db_session.flush()
    today = datetime.now(UTC).date()
    window = await _royale_window(db_session)
    await _strong_estimate_run(client, db_session, window, "g@e.com", "guser", bands=["hard"] * 8)

    ran_first = await converge_difficulties(db_session, today)
    assert ran_first is True
    row = await db_session.get(RotDifficultyRating, "estimate:hard")
    games_after_first = row.games
    assert games_after_first > 0

    # Second call for the SAME day: claimed already -> no-op, game count unchanged.
    ran_second = await converge_difficulties(db_session, today)
    assert ran_second is False
    row2 = await db_session.get(RotDifficultyRating, "estimate:hard")
    assert row2.games == games_after_first


async def test_batch_never_touches_trivia_anchor(client: AsyncClient, db_session: AsyncSession):
    # A trivia (know) difficulty row must never be created or moved by the batch.
    today = datetime.now(UTC).date()
    window = await _royale_window(db_session)
    await _strong_estimate_run(
        client,
        db_session,
        window,
        "k@e.com",
        "kuser",
        bands=["hard"] * 8,
    )
    await converge_difficulties(db_session, today)
    know_rows = (
        (
            await db_session.execute(
                select(RotDifficultyRating).where(RotDifficultyRating.verb == "know")
            )
        )
        .scalars()
        .all()
    )
    assert know_rows == []  # trivia difficulties are the fixed anchor — never in the pool
