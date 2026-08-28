"""Daily Royale × cognition round integration.

The Royale stays the single daily competitive object; a round can now be a cognition type instead
of always being trivia. This module owns the three pieces that differ from the pure-trivia path:

1. PROVISIONING — pin the day's round plan on the window (type sequence from
   services/royale_sequencing + cognition content refs), once, so a mid-day content deploy can't
   split the field. Trivia-only days return None → the unchanged build path runs.
2. ENTRY BUILD — turn the pinned plan into an entry's round set. ATOMIC rounds (trivia) get a
   RoundAnswer with the server answer, exactly as today. INTERACTIVE rounds (estimate,
   change_detection) create a cognition round_instance BOUND to (entry_id, round_idx) with the
   pinned item; the client plays it through the cognition endpoints, and RoundAnswer holds only an
   interactive marker (the answer lives in the instance).
3. SCORING BRIDGE — map a finished interactive round's native outcome onto (correct, time_frac) so
   the ONE canonical points formula (services/scoring.compute_points) scores it on the same scale
   as trivia. No second economy; speed factors in the way trivia's already does.
"""

from __future__ import annotations

import uuid
from random import Random
from typing import Any

from content.loader import fetch_bank
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CognitionChangeItem,
    CognitionEstimateItem,
    CognitionRoundInstance,
    CognitionVideoItem,
    ContestWindow,
    Entry,
)
from app.modules.base import GenerationContext, RoundJudgement, clamp_elapsed_ms
from app.modules.change_detection import CHANGE_TIME_LIMIT_MS
from app.modules.registry import get_module
from app.modules.trivia import trivia_spec
from app.services.bots import window_seed
from app.services.cognition import (
    VIDEO_QUESTION_TIME_LIMIT_MS,
    start_change_with_item,
    start_estimate_with_item,
    start_video_with_item,
)
from app.services.royale_sequencing import ROYALE_TYPES, royale_type_sequence

# Royale entries that contain cognition rounds carry this scoring_version so historical
# leaderboards stay distinguishable. (1 = trivia-only Royale — left NULL in practice; 2 = standalone
# cognition rounds; 3 = a Royale mixing trivia + cognition.)
ROYALE_COGNITION_SCORING_VERSION = 3

# Guess-number → speed-term mapping for estimate: solving on guess 1 earns the full speed bonus,
# guess 2 half, guess 3 none — so estimate's 3/2/1 lands as 160/130/100 through compute_points,
# the same shape trivia gets from fast/medium/slow correct answers.
_ESTIMATE_TIME_FRAC = {3: 1.0, 2: 0.5, 1: 0.0}

_MAX_TRIVIA_REROLLS = 25


def _pick(seed_key: str, items: list[Any]) -> Any:
    return items[Random(seed_key).randrange(len(items))]


def _pick_unseen(seed_key: str, items: list[Any], used: set[Any], prefer: str | None = None) -> Any:
    """Deterministically pick an item the plan has not already used.

    Independent per-slot draws let the SAME item land twice in one run — with a 20-item change bank
    and three change slots that is a ~15% chance per day, and a repeated change pair is worth free
    points because the player already knows where to tap. So the day's plan draws without
    replacement.

    `prefer` narrows to a difficulty tier when one is available (the Royale opens easy and closes
    hard), falling back to any unused item, then — only if the bank is smaller than the number of
    slots — to the whole bank. Still a pure function of the seed, so concurrent first-enters pin the
    identical plan.
    """
    unused = [i for i in items if i.id not in used]
    pool = unused or items
    if prefer is not None:
        tiered = [i for i in pool if getattr(i, "difficulty", None) == prefer]
        pool = tiered or pool
    chosen = _pick(seed_key, pool)
    used.add(chosen.id)
    return chosen


async def _active(session: AsyncSession, model: type[Any]) -> list[Any]:
    return list(
        (await session.execute(select(model).where(model.active.is_(True)).order_by(model.id)))
        .scalars()
        .all()
    )


async def royale_content_availability(session: AsyncSession, locale: str = "en") -> set[str]:
    """Which Royale pool types have content today."""
    avail: set[str] = set()
    if await fetch_bank(session, "trivia", locale=locale):
        avail.add("trivia")
    if await _active(session, CognitionEstimateItem):
        avail.add("estimate")
    if await _active(session, CognitionChangeItem):
        avail.add("change_detection")
    if await _active(session, CognitionVideoItem):
        avail.add("video")
    # Generated from the seed, so it has no bank and is available every day — there is nothing that
    # could make it unavailable short of deleting the module.
    avail.add("memory_flash")
    return avail


async def provision_royale_plan(
    session: AsyncSession, window: ContestWindow, *, locale: str = "en"
) -> list[dict[str, Any]] | None:
    """Get-or-pin the window's round plan. Returns None for a trivia-only window (the caller then
    uses the unchanged build path). The plan is a pure function of (window_seed, available content),
    so concurrent first-enters converge on the identical plan."""
    if window.round_plan is not None:
        return window.round_plan
    avail = await royale_content_availability(session, locale=locale)
    if avail <= {"trivia"}:
        return None

    seed = window_seed(window)
    seq = royale_type_sequence(seed, avail)
    est_items = await _active(session, CognitionEstimateItem)
    chg_items = await _active(session, CognitionChangeItem)
    vid_items = await _active(session, CognitionVideoItem)

    plan: list[dict[str, Any]] = []
    # Per-type sets, so the day never repeats an item within its own run (see _pick_unseen).
    used_est: set[Any] = set()
    used_chg: set[Any] = set()
    used_vid: set[Any] = set()
    last = len(seq) - 1
    for idx, t in enumerate(seq):
        ref: dict[str, str] = {}
        if t == "estimate":
            ref["estimate_item_id"] = str(
                _pick_unseen(f"{seed}:estimate:{idx}", est_items, used_est).id
            )
        elif t == "change_detection":
            # Slot 1 opens the run and slot 8 closes it (royale_sequencing already places the
            # TYPES that way); this applies the same shape to the ITEM drawn.
            prefer = "easy" if idx == 0 else "hard" if idx == last else None
            ref["change_item_id"] = str(
                _pick_unseen(f"{seed}:change:{idx}", chg_items, used_chg, prefer=prefer).id
            )
        elif t == "video":
            ref["video_item_id"] = str(_pick_unseen(f"{seed}:video:{idx}", vid_items, used_vid).id)
        plan.append({"idx": idx, "type": t, "content_ref": ref})

    window.round_plan = plan
    await session.flush()
    return plan


def _draw_trivia(rng: Random, bank: list[dict[str, Any]], seen: set[Any]) -> dict[str, Any]:
    q = rng.choice(bank)
    attempts = 0
    while q["id"] in seen and attempts < _MAX_TRIVIA_REROLLS:
        q = rng.choice(bank)
        attempts += 1
    seen.add(q["id"])
    return q


async def build_royale_entry_rounds(
    session: AsyncSession,
    window: ContestWindow,
    entry: Entry,
    plan: list[dict[str, Any]],
    bank: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[tuple[int, str, dict[str, Any]]]]:
    """Build (round_set client specs, [(idx, module_type, server_answer)]) for one entry from the
    pinned plan. Interactive rounds create a cognition instance bound to (entry.id, idx). Requires
    entry.id (entry already flushed)."""
    seed = window_seed(window)
    round_set: list[dict[str, Any]] = []
    answers: list[tuple[int, str, dict[str, Any]]] = []
    seen_trivia: set[Any] = set()

    for p in plan:
        idx = int(p["idx"])
        t = str(p["type"])
        if t == "trivia":
            question = _draw_trivia(Random(f"{seed}:trivia:{idx}"), bank, seen_trivia)
            client_spec, server_answer = trivia_spec(question, shuffle_seed=seed)
            round_set.append({"idx": idx, "type": t, "client_spec": client_spec})
            answers.append((idx, t, server_answer))
            continue

        if not ROYALE_TYPES[t].interactive:
            # ATOMIC and GENERATED (memory_flash): no content bank and no cognition instance — the
            # module makes its own round from the seed, exactly as engine.build_round_set does for
            # practice. Seeded per (window, type, idx) so the day's round is identical for everyone
            # and regenerable from the stored seed, like every other Royale round.
            module = get_module(t)
            client_spec, server_answer = module.generate(
                Random(f"{seed}:{t}:{idx}"), None, GenerationContext(bank=[])
            )
            round_set.append({"idx": idx, "type": t, "client_spec": client_spec})
            answers.append((idx, t, server_answer))
            continue

        # INTERACTIVE — create a bound cognition instance from the pinned item.
        inst_seed = int(Random(f"{seed}:{t}:{idx}").getrandbits(63))
        if t == "estimate":
            eitem = await session.get(
                CognitionEstimateItem, uuid.UUID(p["content_ref"]["estimate_item_id"])
            )
            if eitem is None:
                raise ValueError("pinned estimate item missing")
            est = await start_estimate_with_item(session, entry.user_id, inst_seed, eitem)
            inst, spec_src = est.instance, est.spec
        elif t == "change_detection":
            citem = await session.get(
                CognitionChangeItem, uuid.UUID(p["content_ref"]["change_item_id"])
            )
            if citem is None:
                raise ValueError("pinned change item missing")
            chg = await start_change_with_item(session, entry.user_id, inst_seed, citem)
            inst, spec_src = chg.instance, chg.spec
        elif t == "video":
            vitem = await session.get(
                CognitionVideoItem, uuid.UUID(p["content_ref"]["video_item_id"])
            )
            if vitem is None:
                raise ValueError("pinned video item missing")
            vid = await start_video_with_item(session, entry.user_id, inst_seed, vitem)
            inst, spec_src = vid.instance, vid.spec
        else:  # pragma: no cover - plan only ever holds pool types
            raise ValueError(f"unknown interactive royale type {t!r}")

        inst.entry_id = entry.id
        inst.round_idx = idx
        spec = dict(spec_src)
        spec["cognition_instance_id"] = str(inst.id)
        round_set.append({"idx": idx, "type": t, "client_spec": spec})
        # The answer lives in the instance; the RoundAnswer holds only the binding marker plus the
        # difficulty band (so Rot Rating can resolve this round's opponent uniformly with trivia).
        answers.append(
            (
                idx,
                t,
                {
                    "interactive": True,
                    "cognition_instance_id": str(inst.id),
                    "module_type": t,
                    "difficulty": spec.get("difficulty"),
                },
            )
        )

    await session.flush()
    return round_set, answers


# ----------------------------------------------------------------- scoring bridge (interactive)


async def bound_instance(
    session: AsyncSession, entry_id: uuid.UUID, round_idx: int
) -> CognitionRoundInstance | None:
    """The cognition instance BOUND to (entry_id, round_idx). Looked up by the binding — never
    from a client-supplied id — so an instance played outside the Royale can't be submitted in."""
    return (
        await session.execute(
            select(CognitionRoundInstance).where(
                CognitionRoundInstance.entry_id == entry_id,
                CognitionRoundInstance.round_idx == round_idx,
            )
        )
    ).scalar_one_or_none()


async def bridge_judgement(
    session: AsyncSession, module_type: str, instance: CognitionRoundInstance
) -> RoundJudgement:
    """Map a FINISHED interactive round's native outcome onto (correct, time_frac) for
    compute_points — the same scale as trivia. Speed factors in the way trivia's does."""
    from app.models import CognitionAttempt  # local import avoids a heavy top-level dep

    if module_type == "estimate":
        correct = bool((instance.final_score or 0) > 0)
        time_frac = _ESTIMATE_TIME_FRAC.get(instance.final_score or 0, 0.0) if correct else 0.0
        return RoundJudgement(correct=correct, time_frac=time_frac, valid=True, flags=[])

    if module_type == "change_detection":
        tap = (
            await session.execute(
                select(CognitionAttempt).where(
                    CognitionAttempt.round_instance_id == instance.id,
                    CognitionAttempt.attempt_index == 1,
                )
            )
        ).scalar_one_or_none()
        hit = bool(tap and tap.is_correct)
        elapsed = clamp_elapsed_ms(
            tap.payload.get("elapsed_ms") if tap else None, CHANGE_TIME_LIMIT_MS
        )
        time_frac = (CHANGE_TIME_LIMIT_MS - elapsed) / CHANGE_TIME_LIMIT_MS if hit else 0.0
        return RoundJudgement(correct=hit, time_frac=time_frac, valid=True, flags=[])

    if module_type == "video":
        # THREE answers in one round. Attempt 0 is the draw marker; 1 and 2 are the comprehension
        # questions; 3 is the change question.
        #
        # The CHANGE question decides the round — its correctness is what drives the in-run streak
        # and the Rot Rating game — because it is the round's actual test. The comprehension pair
        # adds points without deciding it, which is why they ride in `sub_scores` instead.
        rows = (
            (
                await session.execute(
                    select(CognitionAttempt)
                    .where(
                        CognitionAttempt.round_instance_id == instance.id,
                        CognitionAttempt.attempt_index > 0,
                    )
                    .order_by(CognitionAttempt.attempt_index)
                )
            )
            .scalars()
            .all()
        )

        def frac(row: Any) -> float:
            if not row or not row.is_correct:
                return 0.0
            elapsed = clamp_elapsed_ms(row.payload.get("elapsed_ms"), VIDEO_QUESTION_TIME_LIMIT_MS)
            return (VIDEO_QUESTION_TIME_LIMIT_MS - elapsed) / VIDEO_QUESTION_TIME_LIMIT_MS

        by_index = {r.attempt_index: r for r in rows}
        change = by_index.get(3)
        comprehension = [by_index.get(1), by_index.get(2)]
        return RoundJudgement(
            correct=bool(change and change.is_correct),
            time_frac=frac(change),
            valid=True,
            flags=[],
            sub_scores=[(bool(r and r.is_correct), frac(r)) for r in comprehension],
        )

    raise ValueError(f"no royale bridge for module type {module_type!r}")
