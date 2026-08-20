"""H-3 regression: server-side verification of the self-reported answer time.

The exploit: `elapsed_ms: 0` on every round claimed `time_frac 1.0` — a flat +60% on every answer
and a perfect tiebreak average — with nothing tying the claim to reality. The ranked path is played
round-by-round through /answer, so the server measures the wall-clock gap between answers; the real
client's unskippable reveal+splash animations make that gap a verifiable lower bound on the time
actually taken. See services/answer_timing.py.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.models import ContestWindow
from app.models.contest import OPEN
from app.services.answer_timing import (
    ANSWER_TIME_GRACE_MS,
    MIN_HUMAN_ANSWER_MS,
    ROUND_REVEAL_MS,
    ROUND_SPLASH_MS,
    verified_elapsed_ms,
)
from app.services.contest import answer_round
from content.loader import load_trivia
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

LIMIT = 10_000
OVERHEAD = ROUND_REVEAL_MS + ROUND_SPLASH_MS  # 4000: a non-first round's unskippable animation


# ---------------------------------------------------------------------------
# Pure function
# ---------------------------------------------------------------------------
class TestVerifiedElapsed:
    def test_honest_claim_passes_through(self):
        # Gap = overhead + real think; the player's honest elapsed matches → no change.
        think = 5000
        gap = OVERHEAD + think
        assert verified_elapsed_ms(think, gap, is_first_round=False, limit_ms=LIMIT) == think

    def test_scripted_instant_fire_earns_no_speed(self):
        # A gap far below the animations = the UI was bypassed → elapsed forced to the limit (tf 0).
        assert verified_elapsed_ms(0, 40, is_first_round=False, limit_ms=LIMIT) == LIMIT
        assert verified_elapsed_ms(0, 40, is_first_round=True, limit_ms=LIMIT) == LIMIT

    def test_wait_then_lie_is_floored_up(self):
        # Player waited the animations and really thought ~5s, but claims 0. Floored toward the
        # measured think-time (minus grace), NOT left at 0.
        think = 5000
        gap = OVERHEAD + think
        out = verified_elapsed_ms(0, gap, is_first_round=False, limit_ms=LIMIT)
        assert out == think - ANSWER_TIME_GRACE_MS  # 2000, i.e. time_frac 0.8 not 1.0
        assert out > 0

    def test_generous_grace_never_penalises_a_slow_network(self):
        # Honest fast answer (think 800ms) on a slow link (2.5s RTT folded into the gap): the grace
        # absorbs it, so the claim is not floored above what the player reported.
        think, rtt = 800, 2500
        gap = OVERHEAD + think + rtt
        assert verified_elapsed_ms(think, gap, is_first_round=False, limit_ms=LIMIT) == think

    def test_never_below_human_minimum(self):
        # Even a legit-looking gap can't credit a literally-zero answer.
        gap = OVERHEAD + 100
        out = verified_elapsed_ms(0, gap, is_first_round=False, limit_ms=LIMIT)
        assert out >= MIN_HUMAN_ANSWER_MS

    def test_first_round_uses_smaller_overhead(self):
        # Round 0 follows only the splash, so the same gap can be legit for it while being
        # impossibly-fast for a later round that must also play the 3s reveal.
        gap = 2000
        first = verified_elapsed_ms(0, gap, is_first_round=True, limit_ms=LIMIT)
        later = verified_elapsed_ms(0, gap, is_first_round=False, limit_ms=LIMIT)
        # later: gap 2000 well below overhead 4000 → scripted → limit. first: overhead 1000 → legit.
        assert later == LIMIT
        assert first < LIMIT


# ---------------------------------------------------------------------------
# Integration through answer_round
# ---------------------------------------------------------------------------
async def _open_window(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    w = ContestWindow(
        contest_date=now.date(),
        slot="night",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=OPEN,
        template_id="m2_trivia_7",  # all-trivia, so every round has a correctIndex
    )
    session.add(w)
    await session.flush()
    return w


async def _enter(client: AsyncClient, session: AsyncSession, email: str):
    from app.models import Entry, RoundAnswer

    r = await client.post(
        "/auth/register",
        json={"email": email, "username": email.split("@")[0], "password": "super-secret-pw"},
    )
    token = r.json()["access_token"]
    w = await _open_window(session)
    enter = (
        await client.post(f"/contests/{w.id}/enter", headers={"Authorization": f"Bearer {token}"})
    ).json()
    eid = uuid.UUID(enter["entry_id"])
    me = (await client.get("/me", headers={"Authorization": f"Bearer {token}"})).json()
    answers = (
        (
            await session.execute(
                select(RoundAnswer).where(RoundAnswer.entry_id == eid).order_by(RoundAnswer.idx)
            )
        )
        .scalars()
        .all()
    )
    started_at = (await session.get(Entry, eid)).started_at
    return eid, uuid.UUID(me["user_id"]), answers, started_at


async def test_scripted_run_gets_no_time_bonus(client: AsyncClient, db_session: AsyncSession):
    """Firing every /answer instantly with elapsed_ms:0 (the exploit) → time_frac 0 on every round
    beyond the first: the measured gaps are far below the client's unskippable animations."""
    await load_trivia(db_session)
    eid, uid, answers, started_at = await _enter(client, db_session, "scripted@example.com")
    # All answers ~30ms apart, each claiming 0ms think — the blatant script.
    now = started_at
    time_fracs = []
    for a in answers:
        now = now + timedelta(milliseconds=30)
        out = await answer_round(
            db_session,
            eid,
            uid,
            a.idx,
            {"choice": a.server_answer["correctIndex"], "elapsed_ms": 0},
            now=now,
        )
        time_fracs.append(out.time_frac)
    # Rounds 1..N answered faster than the reveal+splash could play → zero speed credit.
    assert all(tf == 0.0 for tf in time_fracs[1:]), time_fracs
    # The exploit's reward is gone: no round beyond the first earns the +60% time bonus.


async def test_honest_run_keeps_its_earned_speed(client: AsyncClient, db_session: AsyncSession):
    """A real run — gaps that include the animations plus a genuine ~1s think, elapsed reported
    honestly — is not penalised: the reported time flows straight through."""
    await load_trivia(db_session)
    eid, uid, answers, started_at = await _enter(client, db_session, "honest@example.com")
    think = 1200
    now = started_at
    for a in answers:
        overhead = ROUND_SPLASH_MS if a.idx == 0 else (ROUND_REVEAL_MS + ROUND_SPLASH_MS)
        now = now + timedelta(milliseconds=overhead + think + 200)  # +200 = network
        out = await answer_round(
            db_session,
            eid,
            uid,
            a.idx,
            {"choice": a.server_answer["correctIndex"], "elapsed_ms": think},
            now=now,
        )
        # Honest fast answer keeps a high time_frac — the grace absorbs the 200ms network.
        assert out.time_frac == pytest.approx((LIMIT - think) / LIMIT), out.time_frac


async def test_wait_then_lie_is_corrected(client: AsyncClient, db_session: AsyncSession):
    """Waiting the real animations + a real 6s think but CLAIMING elapsed_ms:0 is floored toward the
    measured think-time — the liar can't get the full speed bonus for time they actually spent."""
    await load_trivia(db_session)
    eid, uid, answers, started_at = await _enter(client, db_session, "liar@example.com")
    think = 6000
    a0 = answers[1]  # a non-first round (full overhead)
    # answer round 0 honestly first (so round 1 has a prior timestamp)
    now = started_at + timedelta(milliseconds=ROUND_SPLASH_MS + 3000)
    await answer_round(
        db_session,
        eid,
        uid,
        0,
        {"choice": answers[0].server_answer["correctIndex"], "elapsed_ms": 3000},
        now=now,
    )
    now = now + timedelta(milliseconds=OVERHEAD + think)  # really spent 6s on round 1
    out = await answer_round(
        db_session,
        eid,
        uid,
        1,
        {"choice": a0.server_answer["correctIndex"], "elapsed_ms": 0},
        now=now,
    )
    # Claimed tf 1.0; corrected toward (10000 - (6000 - grace))/10000 = 0.7, nowhere near 1.0.
    assert out.time_frac < 0.75, out.time_frac
    assert out.time_frac > 0.0
