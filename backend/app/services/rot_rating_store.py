"""Rot Rating persistence + run-completion application (CLAUDE.md §5e).

The pure math lives in services/rot_rating.py; this is the DB seam. `apply_run` is
called once, when a Daily Royale entry finishes (its last round is answered), and
updates the player's three sub-ratings + derived headline from that run's 8 games.
Guests are excluded (same rule as settlement — a rating needs a saved profile).
Speed never enters: each round contributes only pass/fail against its difficulty.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import and_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import constants as C
from app.models.contest import SUBMITTED, ContestWindow, Entry, RoundAnswer, RoundResult
from app.models.rot_rating import (
    RotDifficultyBatch,
    RotDifficultyRating,
    RotRating,
    RotSubRating,
)
from app.models.user import GUEST_STATUS, User
from app.services.glicko2 import Glicko, Result, update_rating
from app.services.rot_rating import (
    JudgedRound,
    SubRating,
    difficulty_key,
    difficulty_seed,
    recenter_floating_pool,
    seed_glicko,
    seed_sub_rating,
    update_run,
    verb_of_type,
)


async def _load_subs(session: AsyncSession, user_id: uuid.UUID) -> dict[str, SubRating]:
    rows = (
        (await session.execute(select(RotSubRating).where(RotSubRating.user_id == user_id)))
        .scalars()
        .all()
    )
    by_verb = {r.verb: r for r in rows}
    subs: dict[str, SubRating] = {}
    for verb in C.ROT_VERBS:
        r = by_verb.get(verb)
        subs[verb] = (
            SubRating(glicko=Glicko(r.rating, r.rd, r.vol), rounds=r.rounds)
            if r is not None
            else seed_sub_rating()
        )
    return subs


async def _opponent_for(session: AsyncSession, verb: str, key: str) -> Glicko:
    """The difficulty rating this round plays against. Trivia ('know') is the fixed anchor —
    always the seed. Floating verbs use the stored (converged) rating, or the seed if unseen."""
    if verb not in C.ROT_FLOATING_VERBS:
        return difficulty_seed(key)
    row = await session.get(RotDifficultyRating, key)
    if row is None:
        return difficulty_seed(key)
    return Glicko(row.rating, row.rd, row.vol)


async def _judged_rounds(session: AsyncSession, entry: Entry) -> list[JudgedRound]:
    results = (
        (
            await session.execute(
                select(RoundResult)
                .where(RoundResult.entry_id == entry.id)
                .order_by(RoundResult.idx)
            )
        )
        .scalars()
        .all()
    )
    answers = {
        a.idx: a
        for a in (
            await session.execute(select(RoundAnswer).where(RoundAnswer.entry_id == entry.id))
        )
        .scalars()
        .all()
    }
    rounds: list[JudgedRound] = []
    for res in results:
        answer = answers.get(res.idx)
        band = (answer.server_answer.get("difficulty") if answer else None) or "medium"
        verb = verb_of_type(res.module_type)
        key = difficulty_key(verb, str(band))
        opponent = await _opponent_for(session, verb, key)
        rounds.append(
            JudgedRound(verb=verb, opponent=opponent, passed=bool(res.correct and res.valid))
        )
    return rounds


async def converge_difficulties(session: AsyncSession, day: date) -> bool:
    """Daily batch: converge the FLOATING difficulty pools (estimate/notice) on the day's observed
    pass rate, then re-centre each verb's pool to its seed mean (the anchor — a strong cohort can't
    drift the scale). Trivia ('know') is the fixed anchor and is never created or touched here.

    EXACTLY-ONCE per ET day: the batch is NOT idempotent (per-difficulty game counts accumulate),
    so it first CLAIMS the day via INSERT ... ON CONFLICT DO NOTHING on rot_difficulty_batches. A
    redundant fire (daemon tick + targeted cron, or two instances) finds the day already claimed and
    returns False without touching anything. The claim + work share one transaction, so a rolled-
    back run leaves the day reclaimable. Returns True iff this call performed the convergence.

    A difficulty's game is (opponent = the player's current verb sub-rating, score = 1 if the player
    FAILED it). Using the current sub-rating as the opponent is a documented v1 approximation.
    Does not commit — the caller (job/request boundary) does."""
    claim = await session.execute(
        pg_insert(RotDifficultyBatch)
        .values(day=day)
        .on_conflict_do_nothing(index_elements=["day"])
        .returning(RotDifficultyBatch.day)
    )
    if claim.first() is None:
        return False  # already converged for this ET day — exactly-once guard

    rows = (
        await session.execute(
            select(RoundResult, RoundAnswer, Entry.user_id)
            .join(Entry, Entry.id == RoundResult.entry_id)
            .join(ContestWindow, ContestWindow.id == Entry.window_id)
            .join(
                RoundAnswer,
                and_(
                    RoundAnswer.entry_id == RoundResult.entry_id,
                    RoundAnswer.idx == RoundResult.idx,
                ),
            )
            .join(User, User.id == Entry.user_id)
            .where(
                ContestWindow.slot == "royale",
                ContestWindow.contest_date == day,
                Entry.status == SUBMITTED,
                User.status != GUEST_STATUS,
            )
        )
    ).all()

    # Games per (verb, key); each player's current verb sub-rating is the opponent.
    games: dict[tuple[str, str], list[Result]] = {}
    sub_cache: dict[tuple[uuid.UUID, str], Glicko] = {}
    for res, ans, user_id in rows:
        verb = verb_of_type(res.module_type)
        if verb not in C.ROT_FLOATING_VERBS:
            continue
        band = ans.server_answer.get("difficulty") or "medium"
        key = difficulty_key(verb, str(band))
        ck = (user_id, verb)
        if ck not in sub_cache:
            sub = await session.get(RotSubRating, (user_id, verb))
            sub_cache[ck] = (
                Glicko(sub.rating, sub.rd, sub.vol) if sub is not None else seed_glicko()
            )
        # The difficulty WINS (score 1) when the player fails it.
        passed = bool(res.correct and res.valid)
        games.setdefault((verb, key), []).append(
            Result(opponent=sub_cache[ck], score=0.0 if passed else 1.0)
        )

    for verb in C.ROT_FLOATING_VERBS:
        played = {key: g for (v, key), g in games.items() if v == verb}
        if not played:
            continue
        # Load the full stored pool for this verb so re-centring pins the whole scale, not just
        # today's items; apply today's converged updates on top.
        pool: dict[str, Glicko] = {}
        stored = {
            r.key: r
            for r in (
                await session.execute(
                    select(RotDifficultyRating).where(RotDifficultyRating.verb == verb)
                )
            )
            .scalars()
            .all()
        }
        for key, row in stored.items():
            pool[key] = Glicko(row.rating, row.rd, row.vol)
        for key, g in played.items():
            cur = pool.get(key) or difficulty_seed(key)
            pool[key] = update_rating(cur, g, tau=C.ROT_TAU, rd_floor=C.ROT_RD_FLOOR)

        seeds = {key: difficulty_seed(key).rating for key in pool}
        recentered = recenter_floating_pool(pool, seeds)

        for key, glicko in recentered.items():
            added = len(played.get(key, []))
            existing = stored.get(key)
            if existing is None:
                session.add(
                    RotDifficultyRating(
                        key=key,
                        verb=verb,
                        rating=glicko.rating,
                        rd=glicko.rd,
                        vol=glicko.vol,
                        games=added,
                        fixed=False,
                    )
                )
            else:
                existing.rating = glicko.rating
                existing.rd = glicko.rd
                existing.vol = glicko.vol
                existing.games += added
    await session.flush()
    return True


async def load_exposure(session: AsyncSession, user_id: uuid.UUID) -> dict[str, object]:
    """Build the Rot Rating exposure payload (headline + three sub-ratings). A player who has
    never finished a ranked Royale gets a provisional seed so the client always has a value."""
    headline = await session.get(RotRating, user_id)
    sub_rows = {
        r.verb: r
        for r in (
            await session.execute(select(RotSubRating).where(RotSubRating.user_id == user_id))
        )
        .scalars()
        .all()
    }
    sub_ratings: dict[str, dict[str, object]] = {}
    for verb in C.ROT_VERBS:
        r = sub_rows.get(verb)
        rounds = r.rounds if r is not None else 0
        sub_ratings[verb] = {
            "rating": round(r.rating) if r is not None else round(C.ROT_SEED_RATING),
            "provisional": rounds < C.ROT_SUB_PROVISIONAL_ROUNDS,
            "rounds_played": rounds,
        }
    if headline is None:
        return {
            "rating": round(C.ROT_SEED_RATING),
            "provisional": True,
            "rounds_played": 0,
            "last_change": "flat",
            "version": C.ROT_RATING_VERSION,
            "sub_ratings": sub_ratings,
        }
    return {
        "rating": round(headline.rating),
        "provisional": headline.provisional,
        "rounds_played": headline.rounds_played,
        "last_change": headline.direction,
        "version": headline.version,
        "sub_ratings": sub_ratings,
    }


async def apply_run(session: AsyncSession, entry: Entry) -> None:
    """Update the player's Rot Rating from a just-finished Daily Royale entry. No-op for guests.
    Does not commit — the request boundary does."""
    user = await session.get(User, entry.user_id)
    if user is None or user.status == GUEST_STATUS:
        return  # guests are excluded (a rating needs a saved profile)

    rounds = await _judged_rounds(session, entry)
    if not rounds:
        return
    subs = await _load_subs(session, entry.user_id)
    result = update_run(subs, rounds)

    for verb, sub in result.subs.items():
        row = await session.get(RotSubRating, (entry.user_id, verb))
        if row is None:
            session.add(
                RotSubRating(
                    user_id=entry.user_id,
                    verb=verb,
                    rating=sub.glicko.rating,
                    rd=sub.glicko.rd,
                    vol=sub.glicko.vol,
                    rounds=sub.rounds,
                )
            )
        else:
            row.rating = sub.glicko.rating
            row.rd = sub.glicko.rd
            row.vol = sub.glicko.vol
            row.rounds = sub.rounds

    headline = await session.get(RotRating, entry.user_id)
    rounds_played = sum(s.rounds for s in result.subs.values())
    if headline is None:
        session.add(
            RotRating(
                user_id=entry.user_id,
                rating=result.headline.rating,
                rd=result.headline.rd,
                provisional=result.headline_provisional,
                rounds_played=rounds_played,
                direction=result.direction,
                version=C.ROT_RATING_VERSION,
            )
        )
    else:
        headline.rating = result.headline.rating
        headline.rd = result.headline.rd
        headline.provisional = result.headline_provisional
        headline.rounds_played = rounds_played
        headline.direction = result.direction
        headline.version = C.ROT_RATING_VERSION
    await session.flush()
