"""Contest play service (PLAN.md §7): enter a window and submit results.

Server-authoritative throughout: the round set is generated + stored server-side, answers never
leave the server, and scores are recomputed from stored answers (client-sent scores are ignored).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from content.loader import fetch_bank
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import TRIVIA_RETRY_MS
from app.models import ContestWindow, Entry, Profile, RoundAnswer, RoundResult
from app.models.contest import IN_PROGRESS, OPEN, SUBMITTED
from app.modules.base import GenerationContext, RoundJudgement, clamp_elapsed_ms
from app.modules.registry import get_module
from app.services.answer_timing import MIN_HUMAN_ANSWER_MS, verified_elapsed_ms
from app.services.bots import window_seed
from app.services.engine import build_round_set
from app.services.friends import list_friends
from app.services.personalization import personalize_bank
from app.services.rot_rating_store import apply_run as apply_rot_rating
from app.services.royale_rounds import (
    ROYALE_COGNITION_SCORING_VERSION,
    bound_instance,
    bridge_judgement,
    build_royale_entry_rounds,
    provision_royale_plan,
)
from app.services.scheduler import transition_windows
from app.services.scoring import ScoredRound, compute_points, score_entry
from app.services.taste_profile import question_id_from_server_answer, record_answer_signal
from app.services.templates import get_template


class ContestError(Exception):
    pass


class WindowNotFoundError(ContestError):
    pass


class WindowNotOpenError(ContestError):
    pass


class AlreadyEnteredError(ContestError):
    pass


class EntryNotFoundError(ContestError):
    pass


class EntryNotSubmittableError(ContestError):
    pass


class RoundSequenceError(ContestError):
    """A round was answered out of order (Phase A is strictly sequential, one answer per round)."""


class InteractiveRoundNotResolvedError(ContestError):
    """An interactive Royale round was finalized before its cognition instance completed."""


class CategoryUnavailableError(ContestError):
    """A category-scoped session was requested for a category with no servable questions."""


@dataclass
class FieldEntry:
    username: str
    points: list[int]  # per-round points, index == round idx (cumulative-through-N is a client sum)
    avatar_preset: str = "knight"
    equipped_frame: str | None = None
    equipped_badges: list[str] = field(default_factory=list)
    equipped_title: str | None = None


@dataclass
class AnswerOutcome:
    idx: int
    module_type: str
    points: int
    correct: bool
    valid: bool
    time_frac: float
    flags: list[str]
    server_answer: dict[str, Any]  # surfaced for the post-lock reveal (this round is now locked)
    total_score: int  # the entry's running total through this round
    finished: bool  # True when this was the last round (entry now SUBMITTED)
    # Second-chance (§5f): set when a Daily Royale trivia round's FIRST pick was wrong. The round is
    # NOT finalized — the client greys `eliminated` (its own wrong pick; the answer is NOT revealed)
    # and has `retry_ms` to pick once more for half points.
    retry_available: bool = False
    eliminated: int | None = None
    retry_ms: int = 0


# Unique constraint backing "one entry per window per user" (see the M2 migration / model).
_ENTRY_UNIQUE = "uq_entry_window_user"


def _is_duplicate_entry(exc: IntegrityError) -> bool:
    """Whether the violation is the one-entry-per-window constraint (vs. another integrity error).
    The Postgres message names the constraint reliably; asyncpg also exposes constraint_name."""
    name = getattr(getattr(exc, "orig", None), "constraint_name", None)
    if name:
        return str(name) == _ENTRY_UNIQUE
    return _ENTRY_UNIQUE in str(getattr(exc, "orig", exc))


async def enter_contest(
    session: AsyncSession,
    window_id: uuid.UUID,
    user_id: uuid.UUID,
    now: datetime | None = None,
    locale: str = "en",
) -> Entry:
    now = now or datetime.now(UTC)
    await transition_windows(session, now)  # lazy transition so a due window is OPEN

    window = await session.get(ContestWindow, window_id)
    if window is None:
        raise WindowNotFoundError()
    if window.state != OPEN:
        raise WindowNotOpenError()

    # One entry per window: pre-check before insert so a failed INSERT can't poison the txn.
    # The UNIQUE(window_id, user_id) constraint remains the real backstop.
    existing = await session.scalar(
        select(Entry.id).where(Entry.window_id == window_id, Entry.user_id == user_id)
    )
    if existing is not None:
        raise AlreadyEnteredError()

    # Wordle property: the seed is derived from the WINDOW (contest_date + slot), NOT a per-entry
    # random draw — so every player in a day's Daily Royale gets the IDENTICAL 8 questions and
    # option order. That's what makes the leaderboard and "beat my score" share apples-to-apples.
    # (Trade-off: same-for-all is leakable within the 24h window; acceptable for a currency-only,
    # server-validated contest. Practice/category/campaign/duels keep their own per-run seeds.)
    seed = window_seed(window)

    # Daily Royale cognition integration: a royale window pins a mixed round plan (trivia +
    # cognition types) once at first entry. A trivia-only day returns None → the unchanged path
    # below runs, so legacy windows are untouched.
    plan = (
        await provision_royale_plan(session, window, locale=locale)
        if window.slot == "royale"
        else None
    )
    if plan is not None:
        return await _enter_royale_mixed(session, window, user_id, now, plan, seed, locale)

    template = get_template(window.template_id)
    bank = await fetch_bank(session, "trivia", locale=locale)
    # Ranked stays globally fair: personalize_bank is a NO-OP for mode="ranked" unless
    # PERSONALIZE_RANKED_DAILY=true (default false — leaderboard comparability). The call runs
    # through the one gate so the flag is enforced in a single place.
    bank = await personalize_bank(session, user_id, bank, mode="ranked", seed=seed)
    ctx = GenerationContext(bank=bank, seed=seed)
    rounds = build_round_set(seed, template, ctx)

    entry = Entry(
        window_id=window_id,
        user_id=user_id,
        seed=seed,
        round_set=[
            {"idx": r.idx, "type": r.module_type, "client_spec": r.client_spec} for r in rounds
        ],
        started_at=now,
        status=IN_PROGRESS,
    )
    try:
        # SAVEPOINT so a concurrent double-enter (the pre-check above is TOCTOU) rolls back just
        # this entry + its answers and surfaces as a clean 409 — without poisoning the outer txn.
        async with session.begin_nested():
            session.add(entry)
            await session.flush()  # assign entry.id; uq(window_id, user_id) enforced here

            for r in rounds:
                session.add(
                    RoundAnswer(
                        entry_id=entry.id,
                        idx=r.idx,
                        module_type=r.module_type,
                        server_answer=r.server_answer,
                    )
                )
            await session.flush()
    except IntegrityError as exc:
        if _is_duplicate_entry(exc):
            raise AlreadyEnteredError() from exc
        raise
    return entry


async def _enter_royale_mixed(
    session: AsyncSession,
    window: ContestWindow,
    user_id: uuid.UUID,
    now: datetime,
    plan: list[dict[str, Any]],
    seed: int,
    locale: str,
) -> Entry:
    """Build a mixed-type Royale entry from the pinned plan. Trivia rounds are ordinary
    RoundAnswers; interactive rounds create a cognition instance bound to (entry_id, idx)."""
    bank = await fetch_bank(session, "trivia", locale=locale)
    entry = Entry(
        window_id=window.id,
        user_id=user_id,
        seed=seed,
        round_set=[],  # filled after the entry (and its id) exist — interactive rounds need it
        started_at=now,
        status=IN_PROGRESS,
        scoring_version=ROYALE_COGNITION_SCORING_VERSION,
    )
    try:
        async with session.begin_nested():
            session.add(entry)
            await session.flush()  # assign entry.id; uq(window_id, user_id) enforced here
            round_set, answers = await build_royale_entry_rounds(session, window, entry, plan, bank)
            entry.round_set = round_set
            for idx, module_type, server_answer in answers:
                session.add(
                    RoundAnswer(
                        entry_id=entry.id,
                        idx=idx,
                        module_type=module_type,
                        server_answer=server_answer,
                    )
                )
            await session.flush()
    except IntegrityError as exc:
        if _is_duplicate_entry(exc):
            raise AlreadyEnteredError() from exc
        raise
    return entry


async def submit_entry(
    session: AsyncSession,
    entry_id: uuid.UUID,
    user_id: uuid.UUID,
    submissions_by_idx: dict[int, dict[str, Any]],
    now: datetime | None = None,
) -> tuple[Entry, list[ScoredRound]]:
    now = now or datetime.now(UTC)

    entry = await session.get(Entry, entry_id)
    # Practice entries (M8) are window-less and submit via /practice — never through the contest
    # path. Reject explicitly rather than rely on get(ContestWindow, None) behavior.
    if entry is None or entry.user_id != user_id or entry.is_practice:
        raise EntryNotFoundError()
    if entry.status != IN_PROGRESS:
        raise EntryNotSubmittableError()
    # A Royale that mixes cognition rounds (scoring_version set) has interactive rounds whose
    # RoundAnswer is a binding marker, not a scoreable server answer — it can only finalize
    # round-by-round through /answer (which bridges each interactive round). Never the batch path.
    if entry.scoring_version is not None:
        raise EntryNotSubmittableError()

    # The batch path and the per-round /answer path are NOT allowed to mix on one entry. /answer
    # reveals each round's correct index after locking it in (safe on its own), but only finalizes
    # the entry on the LAST round — so a player could answer rounds 0..N-2 to harvest their answers
    # while the entry is still IN_PROGRESS, then batch-/submit all N with those answers, for a
    # guaranteed near-perfect score. Any recorded round_result means /answer was used, so this entry
    # must finalize through that path (its last round), never here. Status alone did not catch it.
    already_answered = await session.scalar(
        select(func.count()).select_from(RoundResult).where(RoundResult.entry_id == entry_id)
    )
    if already_answered:
        raise EntryNotSubmittableError()

    window = await session.get(ContestWindow, entry.window_id)
    if window is None or window.state != OPEN or window.close_at <= now:
        raise WindowNotOpenError()  # reject submissions after close

    answer_rows = (
        (
            await session.execute(
                select(RoundAnswer)
                .where(RoundAnswer.entry_id == entry_id)
                .order_by(RoundAnswer.idx)
            )
        )
        .scalars()
        .all()
    )
    answers = [(a.idx, a.module_type, a.server_answer) for a in answer_rows]

    # NO speed bonus on the batch path. Unlike the per-round /answer path, a single batch submit
    # carries no server-measured per-round timing, so the reported `elapsed_ms` is unverifiable
    # and would let a caller claim time_frac 1.0 on every round (a flat +60%). The ranked client
    # never uses this path (it plays round-by-round through /answer); crediting no speed here kills
    # the exploit while still recording an honest, correctness-only result. Force each round's
    # elapsed to the round limit → time_frac 0, by overriding the submitted value before scoring.
    zeroed_submissions = {
        idx: {**submissions_by_idx.get(idx, {}), "elapsed_ms": get_module(mt).time_limit_ms}
        for idx, mt, _ in answers
    }
    results, total = score_entry(answers, zeroed_submissions)
    for r in results:
        session.add(
            RoundResult(
                entry_id=entry.id,
                idx=r.idx,
                module_type=r.module_type,
                points=r.points,
                correct=r.correct,
                time_frac=r.time_frac,
                valid=r.valid,
                flags=r.flags,
                answered_at=now,
            )
        )
    entry.total_score = total
    entry.submitted_at = now
    entry.status = SUBMITTED
    await session.flush()
    return entry, results


async def answer_round(
    session: AsyncSession,
    entry_id: uuid.UUID,
    user_id: uuid.UUID,
    idx: int,
    result: dict[str, Any],
    now: datetime | None = None,
    supports_retry: bool = False,
) -> AnswerOutcome:
    """Score a single round and reveal it (Phase A's per-round rhythm).

    Strictly sequential and immutable: a round may be answered only when all earlier rounds are
    answered (idx == count of stored round_results) and never re-answered. The answer is revealed
    ONLY after the choice is recorded — so this is anti-cheat-safe (same posture as the results
    reveal, just per round). Reuses the canonical points formula (compute_points) with the streak
    derived from stored round_results, so per-round scoring matches batch score_entry exactly. The
    last round finalizes the entry (SUBMITTED). Does not commit — the request boundary does.
    """
    now = now or datetime.now(UTC)

    entry = await session.get(Entry, entry_id)
    if entry is None or entry.user_id != user_id or entry.is_practice:
        raise EntryNotFoundError()
    if entry.status != IN_PROGRESS:
        raise EntryNotSubmittableError()

    window = await session.get(ContestWindow, entry.window_id)
    if window is None or window.state != OPEN or window.close_at <= now:
        raise WindowNotOpenError()

    num_rounds = len(entry.round_set)
    prior = (
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
    # one answer per round, in order: idx must be exactly the next unanswered round.
    if idx != len(prior) or idx >= num_rounds:
        raise RoundSequenceError()

    answer = await session.get(RoundAnswer, (entry_id, idx))
    if answer is None:
        raise RoundSequenceError()

    # Verify the client's self-reported answer time against the server-measured wall-clock before
    # scoring (anti-cheat for the speed bonus — see services/answer_timing.py). The gap is measured
    # from the previous round's server timestamp (or entry start for round 0). A scripted run that
    # answers faster than the client's unskippable animations gets no speed credit; a claim far
    # below the measured think-time is floored up. For an honest run this is a no-op. `answered_at`
    # is None only on rows predating the column (a play spanning the migration) — then we cannot
    # measure, so trust the client (fail-open, historical only).
    interactive = bool(answer.server_answer.get("interactive"))
    half = False  # §5f: True when scoring a trivia second-chance retry (half points)
    if interactive:
        # INTERACTIVE Royale round: played against its BOUND cognition instance; answerRound is the
        # single finalize. Bridge the instance's outcome onto (correct, time_frac) so the same
        # points formula scores it. The instance carries its own timing, so the /answer answer-time
        # verification is skipped, and the bound instance — not any client-sent id — is scored, so a
        # round can't be replayed or scored from an instance played outside this Royale.
        inst = await bound_instance(session, entry_id, idx)
        if inst is None or inst.completed_at is None:
            raise InteractiveRoundNotResolvedError()
        judgement = await bridge_judgement(session, answer.module_type, inst)
    else:
        module = get_module(answer.module_type)
        limit_ms = module.time_limit_ms
        # §5f second-chance: a Daily Royale trivia round whose FIRST pick is wrong greys that option
        # and grants ONE retry within TRIVIA_RETRY_MS for HALF points. `answer.retry` holds the
        # pending first-pick state between the two /answer calls; None on a normal one-shot round.
        # The answer is NEVER revealed on the offer — the client learns only that its own pick was
        # wrong (still 3 options live), a bounded, deliberate relaxation.
        # `supports_retry` is the client's declaration that it can re-answer the SAME idx. Without
        # it the offer would strand the run on the sequence guard (see AnswerRoundRequest), so an
        # undeclared client is served the pre-§5f one-shot contract.
        retry_eligible = (
            supports_retry and window.slot == "royale" and answer.module_type == "trivia"
        )
        pending = answer.retry
        if pending is not None:
            # ATTEMPT 2 — the fixed TRIVIA_RETRY_MS window is the DEADLINE; speed is still scored
            # against the base limit_ms (so a round's time_frac reconstructs identically whether or
            # not it was retried — the Rot Report rebuild depends on that), then halved via `half`.
            answer.retry = None  # consume the pending state (exactly one retry)
            attempt1_at = datetime.fromisoformat(str(pending["at"]))
            eliminated = int(pending["choice"])
            choice = result.get("choice")
            within = now <= attempt1_at + timedelta(milliseconds=TRIVIA_RETRY_MS)
            if not within or choice == eliminated:
                # The window lapsed, or the client re-sent the greyed option → wrong, zero points.
                judgement = RoundJudgement(
                    correct=False,
                    time_frac=0.0,
                    valid=True,
                    flags=["retry_lapsed"] if not within else ["retry_repeat"],
                )
            else:
                scored = module.score(answer.server_answer, {**result, "elapsed_ms": limit_ms})
                # The retry RE-ARMS the same round — no reveal/splash animation — so the standard
                # overhead model (verified_elapsed_ms) doesn't apply. Floor the claim up to the
                # server-measured retry gap (can't claim faster than the real think), bounded to a
                # human minimum; the TRIVIA_RETRY_MS deadline already caps the window.
                gap_ms = (now - attempt1_at).total_seconds() * 1000.0
                client_elapsed = clamp_elapsed_ms(result.get("elapsed_ms", limit_ms), limit_ms)
                effective = min(max(client_elapsed, int(gap_ms), MIN_HUMAN_ANSWER_MS), limit_ms)
                judgement = RoundJudgement(
                    correct=scored.correct,
                    time_frac=(limit_ms - effective) / limit_ms,
                    valid=scored.valid,
                    flags=["retry"],
                )
            half = True
        else:
            # ATTEMPT 1 — unchanged timing verification.
            prev_answered_at = prior[-1].answered_at if prior else entry.started_at
            if prev_answered_at is not None:
                client_elapsed = clamp_elapsed_ms(result.get("elapsed_ms", limit_ms), limit_ms)
                gap_ms = (now - prev_answered_at).total_seconds() * 1000.0
                effective = verified_elapsed_ms(client_elapsed, gap_ms, idx == 0, limit_ms)
                result = {**result, "elapsed_ms": effective}
            judgement = module.score(answer.server_answer, result)
            picked = result.get("choice")
            if (
                not (judgement.correct and judgement.valid)
                and retry_eligible
                and isinstance(picked, int)
            ):
                # WRONG first PICK on an eligible round → OFFER the retry: grey the pick, +4s. Do
                # not finalize/reveal or record a taste signal yet (round not done). A TIMEOUT (no
                # pick / choice None) has no option to grey, so it finalizes as a normal miss.
                answer.retry = {"choice": picked, "at": now.isoformat()}
                await session.flush()
                return AnswerOutcome(
                    idx=idx,
                    module_type=answer.module_type,
                    points=0,
                    correct=False,
                    valid=True,
                    time_frac=0.0,
                    flags=["retry_offered"],
                    server_answer={},  # the answer is NOT revealed on the offer
                    total_score=sum(int(r.points) for r in prior),
                    finished=False,
                    retry_available=True,
                    eliminated=picked,
                    retry_ms=TRIVIA_RETRY_MS,
                )
    counts = judgement.correct and judgement.valid

    # streak = trailing consecutive (correct & valid) ending at this round — matches score_entry.
    streak_prev = 0
    for r in reversed(prior):
        if r.correct and r.valid:
            streak_prev += 1
        else:
            break
    points = compute_points(True, judgement.time_frac, streak_prev + 1, half=half) if counts else 0

    session.add(
        RoundResult(
            entry_id=entry_id,
            idx=idx,
            module_type=answer.module_type,
            points=points,
            correct=judgement.correct,
            time_frac=judgement.time_frac,
            valid=judgement.valid,
            flags=judgement.flags,
            answered_at=now,
        )
    )
    # Taste/personalization signals are trivia-question-keyed; interactive cognition rounds have no
    # question_id, so they don't feed the taste profile.
    if not interactive:
        await record_answer_signal(
            session,
            user_id,
            question_id=question_id_from_server_answer(answer.server_answer),
            mode="royale",
            is_correct=bool(counts),
            time_frac=judgement.time_frac,
            limit_ms=get_module(answer.module_type).time_limit_ms,
            streak_before=streak_prev,
            streak_after=streak_prev + 1 if counts else 0,
            session_id=entry_id,
            difficulty=answer.server_answer.get("difficulty"),
        )
    total_score = sum(int(r.points) for r in prior) + points
    finished = idx == num_rounds - 1
    if finished:
        entry.status = SUBMITTED
        entry.submitted_at = now
        entry.total_score = total_score
    await session.flush()

    # Rot Rating (§5e): the sharpness rating updates at RUN COMPLETION, independent of the field /
    # settlement, from the run's 8 pass/fail games. Royale entries only; guests excluded inside.
    if finished and window.slot == "royale":
        await apply_rot_rating(session, entry)

    return AnswerOutcome(
        idx=idx,
        module_type=answer.module_type,
        points=points,
        correct=judgement.correct,
        valid=judgement.valid,
        time_frac=judgement.time_frac,
        flags=judgement.flags,
        server_answer=answer.server_answer,
        total_score=total_score,
        finished=finished,
    )


# The Daily Royale is ONE global window per ET day, so its field grows with the whole player base.
# Returning every entry to every viewer is O(field) memory + bandwidth PER leaderboard open — an
# OOM/egress risk at scale (H-2). The list is therefore bounded to the top slice by score (all any
# leaderboard actually shows), while the TRUE field size and the caller's own rank/score are
# computed server-side over the full field so a player outside the slice still sees a correct rank.
FIELD_TOP_N = 200


@dataclass
class WindowField:
    entries: list[FieldEntry]  # top-N by total score (bounded)
    field_size: int  # TRUE count of submitted real entries (not len(entries))
    viewer_rank: (
        int | None
    )  # the caller's 1-based rank in the full field, None if they didn't enter
    viewer_score: int  # the caller's total score (0 if they didn't enter)


async def window_field(
    session: AsyncSession,
    window_id: uuid.UUID,
    *,
    viewer_user_id: uuid.UUID | None = None,
    top_n: int = FIELD_TOP_N,
) -> WindowField:
    """The window's competitive field (SUBMITTED REAL entries), BOUNDED for scale.

    Returns the top `top_n` entries by total score (the leaderboard slice), plus the true
    `field_size` and — when `viewer_user_id` is given — that viewer's rank and score over the FULL
    field. The client sums each returned entry's `points[]` for through-N interstitials; ranking is
    by the cached `Entry.total_score`. Practice and in-progress entries are excluded.
    """
    base = (
        Entry.window_id == window_id,
        Entry.status == SUBMITTED,
        Entry.is_practice.is_(False),
    )

    field_size = (await session.scalar(select(func.count()).select_from(Entry).where(*base))) or 0

    # The caller's own standing over the WHOLE field (not just the returned slice), so a player
    # ranked below the cap still gets a correct "you're Nth of M". Rank = how many entries scored
    # strictly higher, + 1 (standard competition ranking; ties share the higher place).
    viewer_rank: int | None = None
    viewer_score = 0
    if viewer_user_id is not None:
        mine = (
            await session.execute(
                select(Entry.total_score).where(*base, Entry.user_id == viewer_user_id)
            )
        ).scalar_one_or_none()
        if mine is not None:
            viewer_score = int(mine or 0)
            higher = (
                await session.scalar(
                    select(func.count())
                    .select_from(Entry)
                    .where(*base, Entry.total_score > viewer_score)
                )
            ) or 0
            viewer_rank = higher + 1

    # The top slice: pick the entry ids first (bounded), then fan out their per-round points. Order
    # by total_score to keep the heaviest scorers; NULLS LAST so an unscored straggler never
    # displaces a real entry. Ties fall back to entry id for a stable order.
    top_ids = (
        (
            await session.execute(
                select(Entry.id)
                .where(*base)
                .order_by(Entry.total_score.desc().nulls_last(), Entry.id)
                .limit(top_n)
            )
        )
        .scalars()
        .all()
    )
    if not top_ids:
        return WindowField(
            entries=[], field_size=field_size, viewer_rank=viewer_rank, viewer_score=viewer_score
        )

    rows = (
        await session.execute(
            select(
                Entry.id,
                Entry.total_score,
                Profile.username,
                Profile.avatar_preset,
                Profile.equipped_frame,
                Profile.equipped_badges,
                Profile.equipped_title,
                RoundResult.idx,
                RoundResult.points,
            )
            .join(Profile, Profile.user_id == Entry.user_id)
            .join(RoundResult, RoundResult.entry_id == Entry.id)
            .where(Entry.id.in_(top_ids))
            .order_by(Entry.total_score.desc().nulls_last(), Entry.id, RoundResult.idx)
        )
    ).all()
    by_entry: dict[uuid.UUID, FieldEntry] = {}
    for (
        entry_id,
        _total,
        username,
        avatar_preset,
        equipped_frame,
        equipped_badges,
        equipped_title,
        _idx,
        points,
    ) in rows:
        rec = by_entry.get(entry_id)
        if rec is None:
            rec = FieldEntry(
                username=username,
                points=[],
                avatar_preset=avatar_preset,
                equipped_frame=equipped_frame,
                equipped_badges=list(equipped_badges) if equipped_badges else [],
                equipped_title=equipped_title,
            )
            by_entry[entry_id] = rec
        rec.points.append(int(points))
    return WindowField(
        entries=list(by_entry.values()),
        field_size=field_size,
        viewer_rank=viewer_rank,
        viewer_score=viewer_score,
    )


async def my_window_entry(
    session: AsyncSession, window_id: uuid.UUID, user_id: uuid.UUID
) -> Entry | None:
    """The user's contest entry for a window (any status), or None — drives the post-play lobby."""
    return (
        await session.execute(
            select(Entry).where(
                Entry.window_id == window_id,
                Entry.user_id == user_id,
                Entry.is_practice.is_(False),
            )
        )
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Friends leaderboard
# ---------------------------------------------------------------------------


@dataclass
class FriendBoardRow:
    user_id: uuid.UUID
    username: str
    avatar_preset: str
    equipped_frame: str | None
    equipped_title: str | None
    score: int
    rank: int
    is_me: bool


@dataclass
class FriendBoardPending:
    user_id: uuid.UUID
    username: str
    avatar_preset: str
    # Yet-to-play friends are still shown as themselves, so they wear their frame like everyone
    # else on this board — not playing today is not a reason to strip someone's cosmetics.
    equipped_frame: str | None = None


@dataclass
class FriendsBoardData:
    my_rank: int | None
    friend_field_size: int
    played: list[FriendBoardRow]
    yet_to_play: list[FriendBoardPending]


async def friends_board(
    session: AsyncSession, window_id: uuid.UUID, user_id: uuid.UUID
) -> FriendsBoardData:
    """Friends cut of a window's SUBMITTED entries: accepted friends + me, ranked by the settlement
    ordering (score desc, faster avg time_frac). Entry-based (live pre-settlement, equal after). A
    filter on existing entries — never a re-score."""
    friends = (await list_friends(session, user_id)).friends
    id_set: set[uuid.UUID] = {f.user_id for f in friends} | {user_id}

    entries = list(
        (
            await session.execute(
                select(Entry).where(
                    Entry.window_id == window_id,
                    Entry.user_id.in_(id_set),
                    Entry.status == SUBMITTED,
                )
            )
        )
        .scalars()
        .all()
    )

    avg_by_entry: dict[uuid.UUID, float] = {}
    if entries:
        rows = (
            await session.execute(
                select(RoundResult.entry_id, func.avg(RoundResult.time_frac))
                .where(RoundResult.entry_id.in_([e.id for e in entries]))
                .group_by(RoundResult.entry_id)
            )
        ).all()
        avg_by_entry = {r[0]: float(r[1]) for r in rows}

    ranked = sorted(entries, key=lambda e: (-(e.total_score or 0), -avg_by_entry.get(e.id, 0.0)))
    profiles = {
        p.user_id: p
        for p in (await session.execute(select(Profile).where(Profile.user_id.in_(id_set))))
        .scalars()
        .all()
    }

    played: list[FriendBoardRow] = []
    for i, e in enumerate(ranked):
        p = profiles.get(e.user_id)
        if p is None:
            continue
        played.append(
            FriendBoardRow(
                user_id=e.user_id,
                username=p.username,
                avatar_preset=p.avatar_preset,
                equipped_frame=p.equipped_frame,
                equipped_title=p.equipped_title,
                score=e.total_score or 0,
                rank=i + 1,
                is_me=e.user_id == user_id,
            )
        )

    played_ids = {e.user_id for e in entries}
    not_played = [f for f in friends if f.user_id not in played_ids]

    # Order the not-yet-played friends by most-recent activity (their latest submitted run, any
    # window) so a capped board surfaces real, active friends first — never a random slice. Friends
    # who have never submitted sort last (then by username, for a stable order).
    last_seen = {}
    if not_played:
        seen_rows = (
            await session.execute(
                select(Entry.user_id, func.max(Entry.submitted_at))
                .where(
                    Entry.user_id.in_([f.user_id for f in not_played]),
                    Entry.status == SUBMITTED,
                )
                .group_by(Entry.user_id)
            )
        ).all()
        last_seen = {r[0]: r[1] for r in seen_rows if r[1] is not None}
    not_played.sort(
        key=lambda f: (
            f.user_id not in last_seen,
            -(last_seen[f.user_id].timestamp() if f.user_id in last_seen else 0.0),
            f.username,
        )
    )
    yet = [
        FriendBoardPending(f.user_id, f.username, f.avatar_preset, f.equipped_frame)
        for f in not_played
    ]
    my_rank = next((r.rank for r in played if r.is_me), None)
    return FriendsBoardData(
        my_rank=my_rank,
        friend_field_size=len(played),
        played=played,
        yet_to_play=yet,
    )
