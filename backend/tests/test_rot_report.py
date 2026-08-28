"""Server-side Rot Report rebuild (services/rot_report.py, GET /entries/{id}/rot-report).

The load-bearing property: the report rebuilt from stored rounds must MATCH the one the client built
from its in-memory log at the finish line. If those drift, a player re-opening their report on a
second device sees different numbers from the ones they shared — so the parity assertion is the
point of this file, not the endpoint plumbing.

NOTE ON TIMING. Rounds are answered through `answer_round` with an INJECTED `now` spaced by
realistic gaps, because `services/answer_timing.py` gives no speed credit when the wall-clock gap
between answers is too short for the real client's unskippable animations. A tight test loop looks
exactly like a script to that check, so driving the clock is what makes these runs honest ones.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.models import Entry, RoundAnswer
from app.models.contest import OPEN, ContestWindow
from app.modules.trivia import TRIVIA_TIME_LIMIT_MS
from app.services.answer_timing import ui_overhead_ms
from app.services.contest import answer_round
from app.services.rot_report import (
    RotReport,
    RoundFact,
    build_rot_report,
    elapsed_ms_from,
)
from content.loader import load_trivia
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register", json={"email": email, "username": username, "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return str(r.json()["access_token"])


async def _open_royale(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    window = ContestWindow(
        contest_date=now.date(),
        slot="royale",
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        state=OPEN,
        template_id="dr_8_trivia",
        # Pin an ALL-TRIVIA plan explicitly. These tests need trivia rounds at known indexes, and
        # they used to get them by accident: with no cognition content seeded, availability was
        # {"trivia"} and provisioning fell through to the legacy all-trivia build. `memory_flash`
        # is GENERATED, so it is available every day and no window is trivia-only any more. Saying
        # so here is what the test meant all along.
        round_plan=[{"idx": i, "type": "trivia", "content_ref": {}} for i in range(8)],
    )
    session.add(window)
    await session.flush()
    return window


def _fact(correct: bool, elapsed_ms: int | None) -> RoundFact:
    return RoundFact(correct=correct, elapsed_ms=elapsed_ms)


# --- the pure builder: parity with frontend/src/lib/rotReport.ts::buildRotReport ------------------


def test_counts_score_incorrect_and_timing_over_answered_rounds():
    # Mirrors the first case in frontend/src/lib/rotReport.test.ts so both sides pin one behaviour.
    report = build_rot_report(
        [
            _fact(True, 2100),
            _fact(True, 5800),
            _fact(False, 9000),
            _fact(True, 4000),
        ],
        total=8,
    )
    assert report.score == 3
    assert report.total == 8
    assert report.incorrect == 5
    assert report.avg_ms == round((2100 + 5800 + 9000 + 4000) / 4)
    assert report.fastest_ms == 2100
    assert report.rounds == (True, True, False, True, False, False, False, False)


def test_rounds_with_no_known_time_are_skipped_by_timing_but_still_count_as_misses():
    # An untimeable round (unknown round limit) drops out of the averages without distorting them,
    # and still counts against the score and shows as a cross in the grid.
    report = build_rot_report(
        [_fact(True, 3000), _fact(False, None)],
        total=2,
    )
    assert report.score == 1
    assert report.incorrect == 1
    assert report.avg_ms == 3000
    assert report.fastest_ms == 3000
    assert report.rounds == (True, False)


def test_the_grid_is_always_the_full_run_length():
    # A run walked away from part-way pads with misses, matching incorrect = total - score. An
    # unplayed question is not a right one, and the grid must not be shorter than the "/ 8".
    report = build_rot_report([_fact(True, 900), _fact(False, 900)], total=8)
    assert report.rounds == (True, False, False, False, False, False, False, False)
    assert len(report.rounds) == report.total
    assert report.score == 1 and report.incorrect == 7


def test_extra_logged_rounds_are_truncated_to_the_run_length():
    report = build_rot_report([_fact(True, 1), _fact(True, 1), _fact(True, 1)], total=2)
    assert report.rounds == (True, True)


def test_no_rounds_yields_an_empty_but_valid_report():
    report = build_rot_report([], total=8)
    assert report == RotReport(
        score=0,
        total=8,
        incorrect=8,
        avg_ms=None,
        fastest_ms=None,
        rounds=(False,) * 8,
    )


# --- the scoring inversion ------------------------------------------------------------------------


@pytest.mark.parametrize("elapsed_ms", [0, 1, 1500, 5800, TRIVIA_TIME_LIMIT_MS - 1])
def test_elapsed_ms_round_trips_through_the_scoring_formula(elapsed_ms: int):
    # scoring.py: time_frac = clamp((limit - elapsed) / limit, 0, 1). Inverting it must land back on
    # the original answer time — this is what lets the report be rebuilt without storing it.
    limit = TRIVIA_TIME_LIMIT_MS
    time_frac = max(0.0, min(1.0, (limit - elapsed_ms) / limit))
    assert elapsed_ms_from(time_frac, limit) == elapsed_ms


def test_a_timed_out_round_counts_as_the_full_limit():
    # REGRESSION (found by playing a real run): a round the player let expire stores time_frac 0.
    # It still took the whole limit, and the client counts it that way — dropping it made a rebuilt
    # average read 1.5s where the player had been shown 5.8s on the same run.
    assert elapsed_ms_from(0.0, TRIVIA_TIME_LIMIT_MS) == TRIVIA_TIME_LIMIT_MS


def test_no_time_is_reported_when_the_round_limit_is_unknown():
    assert elapsed_ms_from(0.5, None) is None
    assert elapsed_ms_from(0.5, 0) is None


def test_timed_out_rounds_are_averaged_exactly_as_the_client_averages_them():
    # The real run this came from: four rounds timed out at the 10s limit, four were answered in
    # 974/291/616/4270ms. The finish screen showed 5.8s; the rebuild must agree.
    answered = [974, 291, 616, 4270]
    rounds = [_fact(False, TRIVIA_TIME_LIMIT_MS) for _ in range(4)] + [
        _fact(i == 0, ms) for i, ms in enumerate(answered)
    ]
    report = build_rot_report(rounds, total=8)
    assert report.avg_ms == round((TRIVIA_TIME_LIMIT_MS * 4 + sum(answered)) / 8) == 5769
    assert report.fastest_ms == 291


# --- the endpoint, end to end ---------------------------------------------------------------------


async def _play(
    client: AsyncClient,
    session: AsyncSession,
    token: str,
    window: ContestWindow,
    *,
    think_by_idx: dict[int, int],
    wrong_idxs: set[int] = frozenset(),  # type: ignore[assignment]
    stop_after: int | None = None,
) -> tuple[str, list[RoundFact]]:
    """Enter and answer a royale run at a realistic pace.

    Returns (entry_id, the facts the CLIENT would have logged) so a test can rebuild the report the
    browser's way and compare. `stop_after` walks away mid-run.
    """
    await load_trivia(session)
    r = await client.post(f"/contests/{window.id}/enter", headers=_auth(token))
    assert r.status_code == 200, r.text
    entry_id = uuid.UUID(r.json()["entry_id"])
    specs = {s["idx"]: s for s in r.json()["rounds"]}

    entry = await session.get(Entry, entry_id)
    assert entry is not None

    answers = {
        a.idx: a.server_answer
        for a in (
            await session.execute(select(RoundAnswer).where(RoundAnswer.entry_id == entry_id))
        )
        .scalars()
        .all()
    }

    clock = entry.started_at
    log: list[RoundFact] = []
    for idx in sorted(specs)[: stop_after if stop_after is not None else len(specs)]:
        think = think_by_idx[idx]
        # Advance the clock by the real client's unskippable animation plus the think time, so the
        # timing verifier sees a plausible human gap and passes the claim through untouched.
        clock += timedelta(milliseconds=ui_overhead_ms(idx == 0) + think)
        correct_index = answers[idx]["correctIndex"]
        choice = correct_index if idx not in wrong_idxs else (correct_index + 1) % 4
        outcome = await answer_round(
            session,
            entry_id,
            entry.user_id,
            idx,
            {"choice": choice, "elapsed_ms": think},
            now=clock,
        )
        fact_ms = think
        if outcome.retry_available:
            # §5f: a wrong first pick opens a retry; finalize this round as a MISS with a second
            # wrong pick. The retry has its own think time (scored against the base limit, like any
            # round), so the client logs THAT as the round's elapsed and the rebuild matches. Kept
            # above the fastest correct round so it doesn't become the report's "fastest answer".
            retry_think = 3000
            clock += timedelta(milliseconds=retry_think)
            outcome = await answer_round(
                session,
                entry_id,
                entry.user_id,
                idx,
                {"choice": (correct_index + 2) % 4, "elapsed_ms": retry_think},
                now=clock,
            )
            fact_ms = retry_think
        log.append(_fact(outcome.correct, fact_ms))

    return str(entry_id), log


async def test_rebuilt_report_matches_what_the_client_built_at_the_finish_line(
    client: AsyncClient, db_session: AsyncSession
):
    token = await _register(client, "rot-report@example.com", "rotreporter")
    window = await _open_royale(db_session)

    entry_id, log = await _play(
        client,
        db_session,
        token,
        window,
        think_by_idx={i: 1200 + i * 700 for i in range(8)},
        wrong_idxs={2, 5},
    )

    r = await client.get(f"/entries/{entry_id}/rot-report", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()

    # The exact report the browser would have shown at the finish line, from its own round log.
    expected = build_rot_report(log, total=8)
    assert body["score"] == expected.score == 6
    assert body["total"] == 8
    assert body["incorrect"] == expected.incorrect == 2
    assert body["avg_ms"] == expected.avg_ms
    assert body["fastest_ms"] == expected.fastest_ms == 1200
    # The tick/cross grid the browser drew, rebuilt from the DB — misses were forced at 2 and 5.
    assert body["rounds"] == list(expected.rounds)
    assert body["rounds"] == [True, True, False, True, True, False, True, True]


async def test_another_players_entry_reads_as_not_found(
    client: AsyncClient, db_session: AsyncSession
):
    owner = await _register(client, "owner@example.com", "reportowner")
    snooper = await _register(client, "snoop@example.com", "reportsnoop")
    window = await _open_royale(db_session)

    entry_id, _ = await _play(
        client, db_session, owner, window, think_by_idx={i: 2000 for i in range(8)}
    )

    r = await client.get(f"/entries/{entry_id}/rot-report", headers=_auth(snooper))
    assert r.status_code == 404
    assert r.json()["detail"] == "entry_not_found"


async def test_an_abandoned_run_still_reports_against_the_full_total(
    client: AsyncClient, db_session: AsyncSession
):
    # Walking away mid-run leaves fewer round_results than round_set — "3 / 8" must still read
    # right.
    token = await _register(client, "abandon@example.com", "abandoner")
    window = await _open_royale(db_session)

    entry_id, _ = await _play(
        client,
        db_session,
        token,
        window,
        think_by_idx={i: 900 for i in range(8)},
        stop_after=3,
    )

    body = (await client.get(f"/entries/{entry_id}/rot-report", headers=_auth(token))).json()
    assert body["score"] == 3
    assert body["total"] == 8
    assert body["incorrect"] == 5
    assert body["fastest_ms"] == 900
    # Three played, five never reached — the grid still spans the full run.
    assert body["rounds"] == [True, True, True, False, False, False, False, False]
