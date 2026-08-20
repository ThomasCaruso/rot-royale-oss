"""Server-side reconstruction of a finished entry's Rot Report (CLAUDE.md §5, §9).

WHY THIS EXISTS: the Rot Report was originally built only on the client, from a per-round log that
lives in the Contest screen's memory, and stashed in `localStorage` so Home could re-open it. That
stash is per device — play on your phone and the laptop has no idea what your report was, so the
completed Daily row went dead with no explanation.

Nothing new needs to be stored to fix that. Everything the report shows is ALREADY server-side:

  - `round_results.correct`   → the score AND the per-round tick/cross grid (server-canonical, not
                                the client's provisional count)
  - `round_results.time_frac` → the answer time, because scoring defines
                                `time_frac = clamp((limit_ms - elapsed_ms) / limit_ms, 0, 1)`,
                                so `elapsed_ms = limit_ms * (1 - time_frac)` inverts it exactly
  - `entries.round_set[i].client_spec` → the round's `time_limit_ms`

So this module REBUILDS the report rather than persisting a client-supplied blob. That keeps
Invariant 1 intact (nothing the client says is trusted; answers still never leave the server) and it
works retroactively for every entry ever played, not just ones played after this shipped.

`build_rot_report` mirrors `frontend/src/lib/rotReport.ts::buildRotReport` decision for decision, so
the report a player re-opens on another device matches the one they saw at the finish line.
`tests/test_rot_report.py` pins that.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Entry, RoundResult
from app.modules.registry import get_module
from app.services.contest import EntryNotFoundError


@dataclass(frozen=True)
class RoundFact:
    """One answered round, in the shape the report cares about."""

    correct: bool
    #: Reconstructed answer time; None when the round has no usable timing (see `elapsed_ms_from`).
    elapsed_ms: int | None


@dataclass(frozen=True)
class RotReport:
    score: int
    total: int
    incorrect: int
    avg_ms: int | None
    fastest_ms: int | None
    #: Per-round outcome in play order, always `total` long — the tick/cross grid on the card and in
    #: the share text. Replaced "worst category", which duplicated what Brain Boost already tracks
    #: across days; the shape of a single run is the more interesting thing to show and to share.
    rounds: tuple[bool, ...]


def elapsed_ms_from(time_frac: float, limit_ms: int | None) -> int | None:
    """Invert the scoring formula back to the answer time in ms; None only when no limit is known.

    `time_frac` is CLAMPED at 0 by scoring, so 0 means "took at least the whole limit" — a round the
    player let time out. That round still HAS an answer time: the full limit. The client counts it
    that way (its modules report the elapsed time on a timeout rather than reporting none), so
    counting it here keeps both averages over the same eight rounds. Dropping them instead made the
    rebuilt average read 1.5s against the 5.8s the player was shown — verified against a real run.

    The same clamp is what the anti-cheat timing check returns when a gap is too short to be the
    real client (`answer_timing.verified_elapsed_ms`). Crediting the full limit there is the right
    reading too: a scripted round earns no speed, and the honest player never reaches that branch.
    """
    if limit_ms is None or limit_ms <= 0:
        return None
    if time_frac <= 0:
        return limit_ms
    return round(limit_ms * (1.0 - time_frac))


def build_rot_report(rounds: Sequence[RoundFact], total: int) -> RotReport:
    """Derive the report from the per-round facts.

    Mirrors the client builder: timing stats use rounds with a known answer time, and the outcome
    grid is padded to `total` so it always matches the run length the score is quoted against — a
    run abandoned part-way pads with misses, exactly as `incorrect = total - score` does.
    """
    score = sum(1 for r in rounds if r.correct)
    timed = [r.elapsed_ms for r in rounds if r.elapsed_ms is not None]
    avg_ms = round(sum(timed) / len(timed)) if timed else None
    fastest_ms = min(timed) if timed else None

    return RotReport(
        score=score,
        total=total,
        incorrect=max(0, total - score),
        avg_ms=avg_ms,
        fastest_ms=fastest_ms,
        rounds=tuple(rounds[i].correct if i < len(rounds) else False for i in range(total)),
    )


def _limit_ms(client_spec: dict[str, Any], module_type: str) -> int | None:
    """The round's time limit: the client_spec's own value, else the module's registered default.

    The spec copy is preferred because it is what the round was actually played under; the registry
    is the fallback for older `round_set` rows written before a module carried the field.
    """
    spec_limit = client_spec.get("time_limit_ms")
    if isinstance(spec_limit, int) and spec_limit > 0:
        return spec_limit
    try:
        return int(get_module(module_type).time_limit_ms)
    except (KeyError, TypeError, ValueError):
        return None


async def load_rot_report(
    session: AsyncSession, entry_id: uuid.UUID, user_id: uuid.UUID
) -> RotReport:
    """Rebuild the caller's OWN report for an entry.

    A entry that belongs to someone else raises `EntryNotFoundError` rather than a distinct
    "forbidden" — an id you don't own is indistinguishable from one that doesn't exist, so this
    can't be used to probe for other players' entries.
    """
    entry = await session.get(Entry, entry_id)
    if entry is None or entry.user_id != user_id:
        raise EntryNotFoundError()

    round_set: list[dict[str, Any]] = entry.round_set or []
    specs = {int(r.get("idx", i)): r for i, r in enumerate(round_set)}

    results = (
        (
            await session.execute(
                select(RoundResult)
                .where(RoundResult.entry_id == entry_id)
                .order_by(RoundResult.idx)
            )
        )
        .scalars()
        .all()
    )

    facts: list[RoundFact] = []
    for r in results:
        client_spec = (specs.get(r.idx) or {}).get("client_spec") or {}
        facts.append(
            RoundFact(
                correct=r.correct,
                elapsed_ms=elapsed_ms_from(
                    float(r.time_frac), _limit_ms(client_spec, r.module_type)
                ),
            )
        )

    return build_rot_report(facts, len(round_set))
