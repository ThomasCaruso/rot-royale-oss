"""Cognition round runner — the server-side driver for the cognitive round types.

Modules stay stateless plugins in the round-module registry (CLAUDE.md §5); this service owns the
turn-by-turn state that trivia-style one-shot rounds don't need, persisted in the
cognition.round_instance / cognition.attempt tables. Server-authoritative throughout: sequences
derive from the instance seed on demand, the client only ever sees what a player would see on
screen, and every submission is judged here.

Services never commit — the request boundary commits once (CLAUDE.md §8).
"""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from random import Random
from typing import Any, cast
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import (
    CognitionAttempt,
    CognitionChangeItem,
    CognitionEstimateItem,
    CognitionRoundInstance,
    CognitionRoundType,
)
from app.modules.base import GenerationContext
from app.modules.change_detection import CHANGE_TAP_TOLERANCE_FRAC, ChangeDetectionModule
from app.modules.estimate import (
    ESTIMATE_MAX_GUESSES,
    effective_close_pct,
    judge_guess,
    narrow_bounds,
)
from app.modules.registry import get_module

# Stamped on every new cognition round_instance. Rows predating the column are version 1 (the DB
# default); bump this when cognition scoring semantics change so leaderboards never mix versions.
COGNITION_SCORING_VERSION = 2


class CognitionError(Exception):
    """Base for cognition play errors; the API layer maps subclasses to error codes."""


class RoundNotFoundError(CognitionError):
    pass


class RoundCompletedError(CognitionError):
    pass


class EstimateUnavailableError(CognitionError):
    pass


class ChangeUnavailableError(CognitionError):
    pass


class RoundNotResolvedError(CognitionError):
    pass


def _now(now: datetime | None) -> datetime:
    return now if now is not None else datetime.now(UTC)


def new_seed() -> int:
    """A fresh 63-bit round seed (fits entries-style BIGINT, always non-negative)."""
    return secrets.randbits(63)


async def get_round_type(session: AsyncSession, key: str) -> CognitionRoundType:
    rt = (
        await session.execute(
            select(CognitionRoundType).where(
                CognitionRoundType.key == key, CognitionRoundType.active.is_(True)
            )
        )
    ).scalar_one_or_none()
    if rt is None:
        raise RoundNotFoundError(key)
    return rt


async def _owned_instance(
    session: AsyncSession, instance_id: uuid.UUID, user_id: uuid.UUID, type_key: str
) -> CognitionRoundInstance:
    """The user's own instance of the given type, or RoundNotFoundError — another player's round
    is indistinguishable from a nonexistent one."""
    rt = await get_round_type(session, type_key)
    inst = await session.get(CognitionRoundInstance, instance_id)
    if inst is None or inst.user_id != user_id or inst.round_type_id != rt.id:
        raise RoundNotFoundError(str(instance_id))
    return inst


# ------------------------------------------------------------------------------------ ESTIMATE
#
# No reveal endpoint here — the hidden value (the answer + its components) never reaches the
# client at all until the round resolves. The span reveal/TTL machinery is span-specific (its
# stimulus IS the secret and must be displayed once); estimate reuses only the generic
# instance/attempt state machine. Guesses are attempts 1..3; attempt 0 is the draw marker that
# pins the drawn item at start so a catalog change mid-round can never switch the answer.


@dataclass
class EstimateStart:
    instance: CognitionRoundInstance
    spec: dict[str, Any]


@dataclass
class EstimateGuessOutcome:
    correct: bool
    direction: str | None
    band: str | None
    done: bool
    guesses_left: int
    points: int
    slider_min: float  # server-narrowed surviving range after this guess (client never computes it)
    slider_max: float


@dataclass
class EstimateReveal:
    answer: float
    unit: str | None
    acceptable_pct: float
    close_pct: float
    points: int
    reveal_explanation: str
    intuition_note: str | None
    components: list[dict[str, Any]]
    guesses: list[float]
    # The content file id of the drawn item, exposed ONLY at resolve (round over) so an admin can
    # rate it in the moment via the verdict endpoint. Not answer material; None for items not
    # ingested from a file.
    source_id: str | None


def _estimate_item_dict(item: CognitionEstimateItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "prompt": item.prompt,
        "answer": item.answer,
        "unit": item.unit,
        "difficulty": item.difficulty,
        "acceptable_pct": item.acceptable_pct,
        "close_pct": item.close_pct,
    }


async def start_estimate_with_item(
    session: AsyncSession, user_id: uuid.UUID, seed: int, item: CognitionEstimateItem
) -> EstimateStart:
    """Create an estimate instance for a SPECIFIC item — the pinned-draw core, also used by the
    gauntlet, which snapshots the day's item at provisioning."""
    rt = await get_round_type(session, "estimate")
    inst = CognitionRoundInstance(
        round_type_id=rt.id,
        user_id=user_id,
        seed=seed,
        scoring_version=COGNITION_SCORING_VERSION,
    )
    session.add(inst)
    await session.flush()

    module = get_module("estimate")
    spec, _answer = module.generate(
        Random(seed), None, GenerationContext(bank=[_estimate_item_dict(item)], seed=seed)
    )
    # Attempt 0 pins the draw; guesses occupy attempt_index 1..ESTIMATE_MAX_GUESSES.
    session.add(
        CognitionAttempt(
            round_instance_id=inst.id, attempt_index=0, payload={"item_id": str(item.id)}
        )
    )
    await session.flush()
    return EstimateStart(instance=inst, spec=spec)


async def estimate_start(
    session: AsyncSession, user_id: uuid.UUID, *, seed: int | None = None
) -> EstimateStart:
    items = (
        (
            await session.execute(
                select(CognitionEstimateItem)
                .where(CognitionEstimateItem.active.is_(True))
                .order_by(CognitionEstimateItem.id)  # stable order → seed-reproducible draw
            )
        )
        .scalars()
        .all()
    )
    if not items:
        raise EstimateUnavailableError("no active estimate items")
    actual_seed = new_seed() if seed is None else seed
    return await start_estimate_with_item(
        session, user_id, actual_seed, items[actual_seed % len(items)]
    )


async def _estimate_state(
    session: AsyncSession, inst: CognitionRoundInstance
) -> tuple[CognitionEstimateItem, list[CognitionAttempt]]:
    """(the pinned item, judged guess attempts in order). The item is fetched by its pinned id
    regardless of `active` — deactivating content must not break a round in progress."""
    attempts = (
        (
            await session.execute(
                select(CognitionAttempt)
                .where(CognitionAttempt.round_instance_id == inst.id)
                .order_by(CognitionAttempt.attempt_index)
            )
        )
        .scalars()
        .all()
    )
    marker = next((a for a in attempts if a.attempt_index == 0), None)
    if marker is None:
        raise RoundNotFoundError(str(inst.id))
    item = await session.get(CognitionEstimateItem, uuid.UUID(marker.payload["item_id"]))
    if item is None:
        raise EstimateUnavailableError(marker.payload["item_id"])
    guesses = [a for a in attempts if a.attempt_index >= 1]
    return item, guesses


async def estimate_guess(
    session: AsyncSession,
    instance_id: uuid.UUID,
    user_id: uuid.UUID,
    value: float,
    *,
    now: datetime | None = None,
) -> EstimateGuessOutcome:
    inst = await _owned_instance(session, instance_id, user_id, "estimate")
    if inst.completed_at is not None:
        raise RoundCompletedError(str(instance_id))

    item, guesses = await _estimate_state(session, inst)
    idx = len(guesses) + 1  # 1-based guess number
    correct, direction, band = judge_guess(
        float(item.answer),
        float(item.acceptable_pct),
        effective_close_pct(float(item.acceptable_pct), item.close_pct),
        float(value),
    )
    # 3 / 2 / 1 by attempt number on success, 0 otherwise.
    points = (ESTIMATE_MAX_GUESSES + 1 - idx) if correct else 0
    session.add(
        CognitionAttempt(
            round_instance_id=inst.id,
            attempt_index=idx,
            payload={"guess": float(value), "direction": direction, "band": band},
            is_correct=correct,
            points_awarded=points,
        )
    )
    done = correct or idx >= ESTIMATE_MAX_GUESSES
    if done:
        inst.completed_at = _now(now)
        inst.final_score = points
    await session.flush()
    # Narrowed bounds after this guess: fold over every wrong guess so far (prior guesses were all
    # wrong, since a correct one ends the round; include the current one only if it missed).
    wrong = [float(a.payload["guess"]) for a in guesses] + ([] if correct else [float(value)])
    slider_min, slider_max = narrow_bounds(float(item.answer), wrong)
    return EstimateGuessOutcome(
        correct=correct,
        direction=direction,
        band=band,
        done=done,
        guesses_left=0 if done else ESTIMATE_MAX_GUESSES - idx,
        points=points,
        slider_min=slider_min,
        slider_max=slider_max,
    )


async def estimate_resolve(
    session: AsyncSession, instance_id: uuid.UUID, user_id: uuid.UUID
) -> EstimateReveal:
    """The full reveal — answer, arithmetic, components — ONLY once the round is complete.
    Before that, resolving would leak the answer with guesses still in hand."""
    inst = await _owned_instance(session, instance_id, user_id, "estimate")
    if inst.completed_at is None:
        raise RoundNotResolvedError(str(instance_id))
    item, guesses = await _estimate_state(session, inst)
    return EstimateReveal(
        answer=float(item.answer),
        unit=item.unit,
        acceptable_pct=float(item.acceptable_pct),
        close_pct=effective_close_pct(float(item.acceptable_pct), item.close_pct),
        points=inst.final_score or 0,
        reveal_explanation=item.reveal_explanation,
        intuition_note=item.intuition_note,
        components=list(item.components),
        guesses=[float(a.payload["guess"]) for a in guesses],
        source_id=item.source_id,
    )


# ---------------------------------------------------------------------------- CHANGE DETECTION
#
# Same shape as estimate: the hidden value (the bounding box) never reaches the client; the drawn
# image pair is pinned in the attempt-0 marker at start; the single tap is attempt 1 and the round
# completes on it. The bbox is revealed in the submit response — the round is over by then.


@dataclass
class ChangeStart:
    instance: CognitionRoundInstance
    spec: dict[str, Any]


@dataclass
class ChangeOutcome:
    hit: bool
    points: int
    done: bool
    bbox: dict[str, float]


def _asset_url(asset: str) -> str:
    """The ABSOLUTE URL a client should fetch a change-detection asset from.

    Absolute for the reason it always was: the native app has no `server.url` — it loads the bundled
    build from disk — so a relative "/assets/change/x.jpg" resolves against the APP BUNDLE, not the
    server. Any pair added after a binary shipped simply 404s there: a blank box, nothing to find,
    and a guaranteed miss. An absolute URL loads on every client, including binaries already in the
    wild (CLAUDE.md §7c).

    What changed in Phase 2Q is the ORIGIN, not the contract. The images now live in the private
    content package and are served by this API (`/content/change/<asset>`), instead of sitting in
    `frontend/public/` and being served by the web host. The client keeps parsing the same
    `base_url`/`altered_url` keys and still just loads whatever absolute URL the server hands it, so
    every shipped binary follows the move with no App Store release — the one property that made
    this migration possible at all.

    `challenge_base_url` is this API's own public origin (it is what the public share pages are
    built against); `web_base_url` is the SPA's origin, which is no longer where these files
    are.

    Two inputs are tolerated on purpose: a bare asset id (v2 manifests), and a legacy v1 web path
    like "/assets/change/x.jpg" still sitting in a not-yet-re-ingested row — the basename of which
    IS the asset id, since the migration moved the files without renaming them. An already-absolute
    URL is passed through untouched, so a future CDN move needs no change here.
    """
    if asset.startswith(("http://", "https://")):
        return asset
    asset_id = PurePosixPath(asset).name  # legacy "/assets/change/x.jpg" -> "x.jpg"
    base = settings.challenge_base_url.rstrip("/")
    return f"{base}/content/change/{quote(asset_id)}"


def _change_item_dict(item: CognitionChangeItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "key": item.key,
        # Client-facing key names are FROZEN (§7c): every shipped binary parses
        # base_url/altered_url. Only the value moved.
        "base_url": _asset_url(item.base_asset),
        "altered_url": _asset_url(item.altered_asset),
        "width": item.width,
        "height": item.height,
        "bbox": {
            "x": float(item.bbox_x),
            "y": float(item.bbox_y),
            "w": float(item.bbox_w),
            "h": float(item.bbox_h),
        },
        "difficulty": item.difficulty,
    }


async def start_change_with_item(
    session: AsyncSession, user_id: uuid.UUID, seed: int, item: CognitionChangeItem
) -> ChangeStart:
    """Create a change-detection instance for a SPECIFIC image pair (gauntlet pins the day's)."""
    rt = await get_round_type(session, "change_detection")
    inst = CognitionRoundInstance(
        round_type_id=rt.id,
        user_id=user_id,
        seed=seed,
        scoring_version=COGNITION_SCORING_VERSION,
    )
    session.add(inst)
    await session.flush()

    module = get_module("change_detection")
    ctx = GenerationContext(bank=[_change_item_dict(item)], seed=seed)
    spec, _answer = module.generate(Random(seed), None, ctx)
    session.add(
        CognitionAttempt(
            round_instance_id=inst.id, attempt_index=0, payload={"item_id": str(item.id)}
        )
    )
    await session.flush()
    return ChangeStart(instance=inst, spec=spec)


async def change_start(
    session: AsyncSession, user_id: uuid.UUID, *, seed: int | None = None
) -> ChangeStart:
    items = (
        (
            await session.execute(
                select(CognitionChangeItem)
                .where(CognitionChangeItem.active.is_(True))
                .order_by(CognitionChangeItem.id)  # stable order → seed-reproducible draw
            )
        )
        .scalars()
        .all()
    )
    if not items:
        raise ChangeUnavailableError("no active change items")
    actual_seed = new_seed() if seed is None else seed
    return await start_change_with_item(
        session, user_id, actual_seed, items[actual_seed % len(items)]
    )


async def change_submit(
    session: AsyncSession,
    instance_id: uuid.UUID,
    user_id: uuid.UUID,
    x: float | None,
    y: float | None,
    elapsed_ms: int,
    *,
    now: datetime | None = None,
) -> ChangeOutcome:
    inst = await _owned_instance(session, instance_id, user_id, "change_detection")
    if inst.completed_at is not None:
        raise RoundCompletedError(str(instance_id))

    attempts = (
        (
            await session.execute(
                select(CognitionAttempt)
                .where(CognitionAttempt.round_instance_id == inst.id)
                .order_by(CognitionAttempt.attempt_index)
            )
        )
        .scalars()
        .all()
    )
    marker = next((a for a in attempts if a.attempt_index == 0), None)
    if marker is None:
        raise RoundNotFoundError(str(inst.id))
    item = await session.get(CognitionChangeItem, uuid.UUID(marker.payload["item_id"]))
    if item is None:
        raise ChangeUnavailableError(marker.payload["item_id"])

    # cast: points() is change-detection-specific, beyond the RoundModule protocol surface.
    module = cast(ChangeDetectionModule, get_module("change_detection"))
    server_answer = {
        "item_id": str(item.id),
        "bbox": _change_item_dict(item)["bbox"],
        "tolerance_frac": CHANGE_TAP_TOLERANCE_FRAC,
    }
    # No tap = the limit expired. Distinct from a malformed tap, which is a tampering signal.
    # NULL is the current client's signal; a NEGATIVE coordinate is the legacy (-1, -1) sentinel
    # still sent by every installed app binary, which cannot be updated on demand.
    timed_out = x is None or y is None or x < 0 or y < 0
    submission: dict[str, Any] = (
        {"tap": None, "timed_out": True, "elapsed_ms": elapsed_ms}
        if timed_out
        else {"tap": {"x": x, "y": y}, "elapsed_ms": elapsed_ms}
    )
    judgement = module.score(server_answer, submission)
    points = module.points(server_answer, submission)

    session.add(
        CognitionAttempt(
            round_instance_id=inst.id,
            attempt_index=1,
            payload={"x": x, "y": y, "elapsed_ms": elapsed_ms, "hit": judgement.correct},
            is_correct=judgement.correct,
            points_awarded=points,
        )
    )
    inst.completed_at = _now(now)
    inst.final_score = points
    await session.flush()
    return ChangeOutcome(
        hit=judgement.correct, points=points, done=True, bbox=server_answer["bbox"]
    )
