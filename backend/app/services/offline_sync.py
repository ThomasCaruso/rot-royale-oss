from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from content.loader import fetch_bank
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Profile
from app.models.campaign import CampaignSession
from app.models.contest import IN_PROGRESS, SUBMITTED, Entry, RoundAnswer, RoundResult
from app.modules.trivia import TRIVIA_TIME_LIMIT_MS
from app.services import offline_content
from app.services.practice import PracticeResult, submit_practice
from app.services.scoring import ScoredRound, score_entry
from app.services.taste_profile import record_answer_signal

if TYPE_CHECKING:
    from app.services.campaign import CampaignCompletion


def score_offline_items(
    items: list[dict[str, Any]], bank_by_id: dict[str, dict[str, Any]]
) -> tuple[list[ScoredRound], int, int]:
    """Re-score recorded offline choices with the SAME engine online uses.

    Each item's selected_source_index is the ORIGINAL bank option index; we build a server_answer
    whose correctIndex is the bank's original correctIndex and a submission whose `choice` is that
    same original index, so trivia.score()'s `choice == correctIndex` comparison is correct and
    streak/points come out identical to an online run. Order of `items` defines round order
    (streak).
    """
    answers: list[tuple[int, str, dict[str, Any]]] = []
    submissions: dict[int, dict[str, Any]] = {}
    for idx, it in enumerate(items):
        q = bank_by_id[it["question_id"]]
        answers.append(
            (
                idx,
                "trivia",
                {
                    "correctIndex": int(q["payload"]["correctIndex"]),
                    "question_id": it["question_id"],
                    "difficulty": q.get("difficulty"),
                },
            )
        )
        submissions[idx] = {
            "choice": int(it["selected_source_index"]),
            "elapsed_ms": int(it["elapsed_ms"]),
        }
    scored, _total_points = score_entry(answers, submissions)
    correct = sum(1 for s in scored if s.correct and s.valid)
    return scored, correct, len(scored)


async def sync_campaign_offline(
    session: AsyncSession,
    user_id: uuid.UUID,
    world: str,
    level_number: int,
    client_id: str,
    items: list[dict[str, Any]],
    now: datetime | None = None,
) -> CampaignCompletion:
    """Idempotently re-score a client's recorded offline choices for a campaign level and settle it
    through the EXISTING online reward path (`complete_campaign_level`).

    Server-authoritative: the device answer is reveal-only; we re-score the STABLE original bank
    option index against the live bank here (`score_offline_items`). The Entry is materialized to
    look EXACTLY like a finished online campaign completion (is_practice, seed, round_set,
    SUBMITTED, RoundAnswer per authored question, RoundResult per scored round), handed to unchanged
    `complete_campaign_level` for all coin/gem/progress logic. Does not commit (request boundary).

    Exactly-once: keyed on `entries.offline_client_id` (unique partial index). A re-sync of the same
    client_id finds the existing entry and re-settles it (complete_campaign_level is itself
    idempotent via CampaignSession.settled_at), so coins are never double-paid and only one Entry
    ever carries the key.
    """
    from app.services import campaign as camp

    now = now or datetime.now(UTC)

    # 1. Idempotency: a prior sync of this client_id → re-settle the existing entry (no new entry).
    existing = await session.scalar(
        select(Entry).where(
            Entry.offline_client_id == client_id,
            Entry.user_id == user_id,
        )
    )
    if existing is not None:
        return await camp.complete_campaign_level(session, existing.id, user_id, now=now)

    # 2. Same unlock gate the online start uses.
    level = await camp.get_unlocked_level_or_raise(session, user_id, world, level_number, now=now)

    # 3. Resolve the level's exact authored questions and validate the client submitted precisely
    #    those (no more, no fewer, no substitutions) — content drift or a tampered payload → reject.
    bank = await fetch_bank(session, "trivia")
    authored = camp.authored_bank_questions(level, bank)
    authored_ids = sorted(str(q["id"]) for q in authored)
    item_ids = sorted(str(it["question_id"]) for it in items)
    if authored_ids != item_ids:
        raise camp.CampaignError(
            f"offline items do not match the level's authored questions ({world} L{level_number})"
        )

    # 4. Score in AUTHORED order (stable streak — order defines the contest streak).
    by_id = {str(q["id"]): q for q in authored}
    items_by_id = {str(it["question_id"]): it for it in items}
    ordered_items = [items_by_id[str(q["id"])] for q in authored]
    scored, _correct, _total = score_offline_items(ordered_items, by_id)

    # 5. Materialize the finished Entry exactly as an online completion looks (mirror
    #    start_campaign_level's is_practice/seed/round_set), plus the offline_client_id key.
    seed = camp.campaign_level_seed(user_id, world, level_number)
    # Same {idx, type, client_spec} projection the online path stores (campaign/practice/contest),
    # so the audit copy can't break a future RoundSpecOut consumer. build_offline_round's extra
    # option_source_index/correct_index/explanation fields are reveal-only and not persisted here.
    offline_rounds = [
        offline_content.build_offline_round(q, idx=i, shuffle_seed=seed)
        for i, q in enumerate(authored)
    ]
    entry = Entry(
        window_id=None,
        user_id=user_id,
        is_practice=True,
        seed=seed,
        round_set=[
            {"idx": r["idx"], "type": "trivia", "client_spec": r["client_spec"]}
            for r in offline_rounds
        ],
        started_at=now,
        submitted_at=now,
        total_score=sum(s.points for s in scored),
        status=SUBMITTED,
        offline_client_id=client_id,
    )
    session.add(entry)
    await session.flush()  # assign entry.id

    # RoundAnswer per authored question (ORIGINAL correctIndex/question_id/difficulty), so the
    # persisted server answer matches an online run's stored answer.
    for i, q in enumerate(authored):
        session.add(
            RoundAnswer(
                entry_id=entry.id,
                idx=i,
                module_type="trivia",
                server_answer={
                    "correctIndex": int(q["payload"]["correctIndex"]),
                    "question_id": str(q["id"]),
                    "difficulty": q.get("difficulty"),
                },
            )
        )
    # RoundResult per scored round (what complete_campaign_level recomputes correct/total from).
    for s in scored:
        session.add(
            RoundResult(
                entry_id=entry.id,
                idx=s.idx,
                module_type=s.module_type,
                points=s.points,
                correct=s.correct,
                time_frac=s.time_frac,
                valid=s.valid,
                flags=s.flags,
            )
        )
    session.add(
        CampaignSession(
            entry_id=entry.id,
            user_id=user_id,
            world=world,
            level_number=level_number,
            created_at=now,
        )
    )
    await session.flush()

    # 6. Settle through the UNCHANGED reward path.
    return await camp.complete_campaign_level(session, entry.id, user_id, now=now)


async def _practice_result_from_entry(session: AsyncSession, entry: Entry) -> PracticeResult:
    """Reconstruct a finished PracticeResult from a previously-synced entry WITHOUT re-scoring or
    re-applying sharpness. Used on a re-sync (idempotency): rounds come from the stored RoundResult
    rows and sharpness is the user's CURRENT value (before==after, gained==0), so replaying the same
    offline result returns the same numbers and never double-credits sharpness."""
    result_rows = (
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
    answers_by_idx = {
        a.idx: a.server_answer
        for a in (
            await session.execute(select(RoundAnswer).where(RoundAnswer.entry_id == entry.id))
        )
        .scalars()
        .all()
    }
    rounds = [
        ScoredRound(
            idx=r.idx,
            module_type=r.module_type,
            points=int(r.points),
            correct=r.correct,
            time_frac=float(r.time_frac),
            valid=r.valid,
            flags=list(r.flags),
            server_answer=answers_by_idx.get(r.idx, {}),
        )
        for r in result_rows
    ]
    total = len(rounds)
    correct = sum(1 for r in rounds if r.correct and r.valid)
    accuracy = correct / total if total else 0.0
    profile = await session.get(Profile, entry.user_id)
    current = profile.sharpness if profile is not None else 0
    return PracticeResult(
        entry=entry,
        rounds=rounds,
        correct=correct,
        total=total,
        accuracy=accuracy,
        sharpness_before=current,
        sharpness_after=current,
        sharpness_gained=0,
    )


async def sync_practice_offline(
    session: AsyncSession,
    user_id: uuid.UUID,
    mode: str | None,
    category: str | None,
    client_id: str,
    items: list[dict[str, Any]],
    now: datetime | None = None,
) -> PracticeResult:
    """Idempotently re-score a client's recorded offline practice/category session and settle it
    through the EXISTING no-stakes `submit_practice` path (scores + nudges sharpness ONCE, no
    coins).

    Server-authoritative: the device answer is reveal-only; we materialize a practice Entry that
    looks exactly like an online `start_practice` run (is_practice, seed, {idx,type,client_spec}
    round_set, IN_PROGRESS, a RoundAnswer per item carrying the ORIGINAL bank correctIndex), then
    hand it to `submit_practice`, which re-scores the stable original option index against the
    stored server answers. Personalization signals are recorded per round to match the online
    per-round path. Does not commit (request boundary).

    Exactly-once: keyed on `entries.offline_client_id`. A re-sync of the same client_id reconstructs
    the result from the stored rows + current sharpness (no re-scoring, no re-applied sharpness), so
    sharpness is never double-credited and only one Entry ever carries the key.
    """
    now = now or datetime.now(UTC)
    session_mode = mode or "practice"

    # 1. Idempotency: a prior sync of this client_id → reconstruct without re-scoring/re-applying.
    existing = await session.scalar(
        select(Entry).where(
            Entry.offline_client_id == client_id,
            Entry.user_id == user_id,
        )
    )
    if existing is not None:
        return await _practice_result_from_entry(session, existing)

    # 2. Resolve the servable bank (scoped to category if given) and validate every submitted id.
    bank = await fetch_bank(session, "trivia", category)
    by_id = {str(q["id"]): q for q in bank}
    for it in items:
        if str(it["question_id"]) not in by_id:
            raise ValueError(f"unknown question_id in offline practice items: {it['question_id']}")

    ordered = [by_id[str(it["question_id"])] for it in items]

    # 3. Materialize the practice Entry exactly as start_practice builds it (is_practice, seed,
    #    {idx,type,client_spec} round_set), plus the offline_client_id key. Seed is stable per-item
    #    hash order (display only) — practice is not leaderboard-comparable.
    offline_rounds = [
        offline_content.build_offline_round(q, idx=i, shuffle_seed=0) for i, q in enumerate(ordered)
    ]
    entry = Entry(
        window_id=None,
        user_id=user_id,
        is_practice=True,
        seed=0,
        round_set=[
            {"idx": r["idx"], "type": "trivia", "client_spec": r["client_spec"]}
            for r in offline_rounds
        ],
        mode=session_mode,
        started_at=now,
        status=IN_PROGRESS,
        offline_client_id=client_id,
    )
    session.add(entry)
    await session.flush()  # assign entry.id

    # 4. RoundAnswer per item (ORIGINAL bank correctIndex/question_id/difficulty) + submissions
    #    keyed by round idx (the stable original option index the player picked).
    submissions: dict[int, dict[str, Any]] = {}
    for i, it in enumerate(items):
        q = by_id[str(it["question_id"])]
        session.add(
            RoundAnswer(
                entry_id=entry.id,
                idx=i,
                module_type="trivia",
                server_answer={
                    "correctIndex": int(q["payload"]["correctIndex"]),
                    "question_id": str(q["id"]),
                    "difficulty": q.get("difficulty"),
                },
            )
        )
        submissions[i] = {
            "choice": int(it["selected_source_index"]),
            "elapsed_ms": int(it["elapsed_ms"]),
        }
    await session.flush()

    # 5. Score + finalize + apply sharpness ONCE through the shared no-stakes path.
    result = await submit_practice(session, entry.id, user_id, submissions, now=now)

    # 5b. Persist a RoundResult per scored round (submit_practice returns them but doesn't store
    #     them). A re-sync reconstructs the same numbers from these rows (see
    #     _practice_result_from_entry) without re-scoring or re-applying sharpness.
    for s in result.rounds:
        session.add(
            RoundResult(
                entry_id=entry.id,
                idx=s.idx,
                module_type=s.module_type,
                points=s.points,
                correct=s.correct,
                time_frac=s.time_frac,
                valid=s.valid,
                flags=s.flags,
            )
        )
    await session.flush()

    # 6. Record personalization signals per round to match the online per-round path
    #    (record_answer_signal is best-effort and self-gated on personalization_enabled).
    streak = 0
    for i, it in enumerate(items):
        q = by_id[str(it["question_id"])]
        scored = result.rounds[i]
        counts = scored.correct and scored.valid
        streak_before = streak
        streak = streak + 1 if counts else 0
        await record_answer_signal(
            session,
            user_id,
            question_id=uuid.UUID(str(q["id"])),
            mode=session_mode,
            is_correct=bool(counts),
            time_frac=scored.time_frac,
            limit_ms=TRIVIA_TIME_LIMIT_MS,
            streak_before=streak_before,
            streak_after=streak,
            session_id=entry.id,
            difficulty=q.get("difficulty"),
        )

    return result
