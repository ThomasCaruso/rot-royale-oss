"""Campaign Mode service: the progression layer + the primary coin source.

Design (the "smallest safe" seam — the contest engine, scoring, settlement and the practice service
are untouched):
  - A campaign play is a window-less practice Entry (is_practice=True, window_id NULL), built from a
    level's EXACT authored questions (not a random draw). Play reuses the unchanged
    `/practice/{entry}/answer` lesson loop, which finalizes the Entry on the last round.
  - Rewards are applied by `complete_campaign_level`, which recomputes correct/total from the
    persisted RoundResults (server-authoritative) and pays coins through the append-only ledger.
    It is IDEMPOTENT — a campaign ledger row with (ref_type="campaign", ref_id=entry_id) means the
    level was already settled, so a retry never double-pays.

Coins are cosmetic-only and NEVER touch rating/division/standings — this service writes to the
ledger and the campaign tables, never to Profile.rating/division or any contest table.
"""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, time
from typing import Any

from content.campaign import manifest as cm
from content.campaign.keys import question_key
from content.loader import fetch_bank
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import (
    CAMPAIGN_CHEST_LEVEL,
    CAMPAIGN_COIN_FIRST_CLEAR,
    CAMPAIGN_COIN_PERFECT_BONUS,
    CAMPAIGN_COIN_REASONS,
    CAMPAIGN_COIN_REPLAY_CLEAR,
    CAMPAIGN_COIN_STRONG_BONUS,
    CAMPAIGN_DAILY_COIN_CAP,
    GEM_CAMPAIGN_ALL_WORLDS,
    GEM_CAMPAIGN_BOSS_CLEAR,
    GEM_CAMPAIGN_LEVEL5_CHEST,
    GEM_CAMPAIGN_PERFECT_BOSS,
    GEM_CAMPAIGN_PERFECT_WORLD,
)
from app.core.timezone import ET, et_wall_to_utc
from app.models import (
    CampaignSession,
    CoinLedger,
    Entry,
    GemLedger,
    Profile,
    RoundAnswer,
    RoundResult,
    UserCampaignProgress,
)
from app.models.campaign import CLEAR, CLEAR_STATUS_RANK, PERFECT, STRONG
from app.models.contest import IN_PROGRESS, SUBMITTED
from app.modules.trivia import trivia_spec
from app.services.contest import CategoryUnavailableError, EntryNotFoundError
from app.services.engine import GeneratedRound
from app.services.gem_ledger import record_gem_delta
from app.services.ledger import record_coin_delta
from app.services.world_progress import (
    all_worlds_cleared,
    world_cleared,
    world_completion,
)


def _clear_threshold() -> int:
    """Correct answers needed to CLEAR a level, per the active content package's campaign spec."""
    from content.campaign.spec import load as _load_spec

    from app.core.config import settings

    return _load_spec(settings.content_root).clear_threshold


def _strong_threshold() -> int:
    """Correct answers for a STRONG clear bonus, per the active campaign spec."""
    from content.campaign.spec import load as _load_spec

    from app.core.config import settings

    return _load_spec(settings.content_root).strong_threshold


def _perfect_threshold() -> int:
    """Correct answers needed for a PERFECT level, per the active campaign spec."""
    from content.campaign.spec import load as _load_spec

    from app.core.config import settings

    return _load_spec(settings.content_root).perfect_threshold


class CampaignError(Exception):
    pass


class LevelNotFoundError(CampaignError):
    """No such (world, level) in the manifest."""


class LevelLockedError(CampaignError):
    """The requested level is not unlocked yet (the previous level isn't cleared)."""


class NotACampaignEntryError(CampaignError):
    """The entry exists but is not a campaign session (no campaign_sessions link)."""


class LevelNotFinishedError(CampaignError):
    """Completion was requested before all rounds were answered."""


# --- clear-status helpers (pure) -------------------------------------------------------------


def clear_status_for(correct: int) -> str | None:
    """Map a correct-count (of 10) to a clear status, or None if it didn't pass."""
    if correct >= _perfect_threshold():
        return PERFECT
    if correct >= _strong_threshold():
        return STRONG
    if correct >= _clear_threshold():
        return CLEAR
    return None


def is_pass(correct: int) -> bool:
    return correct >= _clear_threshold()


def _best_status(existing: str | None, new: str | None) -> str | None:
    if new is None:
        return existing
    if existing is None:
        return new
    return new if CLEAR_STATUS_RANK[new] > CLEAR_STATUS_RANK[existing] else existing


# --- result dataclasses ----------------------------------------------------------------------


@dataclass
class CampaignCompletion:
    world: str
    level_number: int
    title: str
    is_boss: bool
    correct: int
    total: int
    passed: bool
    clear_status: str | None
    coins_awarded: int
    gems_awarded: int
    daily_cap_reached: bool
    first_clear: bool  # this completion was the level's first-ever clear
    next_level_unlocked: bool  # this completion just unlocked the following level
    best_correct: int
    already_settled: bool  # idempotent replay of complete() for an already-rewarded entry


@dataclass
class LevelView:
    level_number: int
    title: str
    arc_name: str
    is_boss: bool
    difficulty_mix: dict[str, int]
    unlocked: bool
    cleared: bool
    clear_status: str | None
    best_correct: int


@dataclass
class WorldView:
    world: str
    category: str
    arcs: list[tuple[str, list[LevelView]]]  # (arc_name, levels)
    cleared_count: int
    total_levels: int


@dataclass
class LadderView:
    worlds: list[WorldView]
    daily_coins_earned: int
    daily_coins_cap: int


# --- daily cap -------------------------------------------------------------------------------


def _et_day_start_utc(now: datetime) -> datetime:
    """UTC instant of the most recent America/New_York midnight at or before `now`."""
    et_date = now.astimezone(ET).date()
    return et_wall_to_utc(et_date, time(0, 0))


async def _campaign_coins_today(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> int:
    """Sum of campaign coins already granted to the user in the current ET day."""
    since = _et_day_start_utc(now)
    total = await session.scalar(
        select(func.coalesce(func.sum(CoinLedger.delta), 0)).where(
            CoinLedger.user_id == user_id,
            CoinLedger.reason.in_(CAMPAIGN_COIN_REASONS),
            CoinLedger.created_at >= since,
        )
    )
    return int(total or 0)


# --- ladder ----------------------------------------------------------------------------------


async def get_ladder(
    session: AsyncSession, user_id: uuid.UUID, now: datetime | None = None
) -> LadderView:
    """The full campaign ladder for a user: every world/arc/level with unlock + best/clear overlaid
    from their progress rows. Level 1 of each world is always unlocked; level N unlocks once N-1 is
    cleared."""
    now = now or datetime.now(UTC)
    rows = (
        (
            await session.execute(
                select(UserCampaignProgress).where(UserCampaignProgress.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    prog: dict[tuple[str, int], UserCampaignProgress] = {(p.world, p.level_number): p for p in rows}

    worlds: list[WorldView] = []
    for w in cm.worlds():
        cleared_count = 0
        prev_cleared = True  # level 1 is always unlocked
        arcs: list[tuple[str, list[LevelView]]] = []
        for arc in w.arcs:
            level_views: list[LevelView] = []
            for lvl in arc.levels:
                p = prog.get((w.world, lvl.level_number))
                cleared = p is not None and p.clear_status is not None
                unlocked = lvl.level_number == 1 or prev_cleared
                if cleared:
                    cleared_count += 1
                level_views.append(
                    LevelView(
                        level_number=lvl.level_number,
                        title=lvl.title,
                        arc_name=arc.name,
                        is_boss=lvl.is_boss,
                        difficulty_mix=dict(lvl.difficulty_mix),
                        unlocked=unlocked,
                        cleared=cleared,
                        clear_status=p.clear_status if p else None,
                        best_correct=p.best_correct if p else 0,
                    )
                )
                prev_cleared = cleared
            arcs.append((arc.name, level_views))
        worlds.append(
            WorldView(
                world=w.world,
                category=w.category,
                arcs=arcs,
                cleared_count=cleared_count,
                total_levels=len(w.levels),
            )
        )

    return LadderView(
        worlds=worlds,
        daily_coins_earned=await _campaign_coins_today(session, user_id, now),
        daily_coins_cap=CAMPAIGN_DAILY_COIN_CAP,
    )


async def offline_cacheable_levels(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    lookahead: int,
) -> list[tuple[cm.CampaignWorld, cm.CampaignLevel]]:
    """Every level UNLOCKED for the user plus up to `lookahead` locked levels immediately ahead per
    world, as (world, level) manifest pairs — the set worth caching for offline campaign play.

    Reuses the SAME unlock rule as `get_ladder` (level 1 always unlocked; level N unlocks once
    N-1 is cleared, i.e. has a non-null clear_status). Levels are in manifest order per world.
    """
    rows = (
        (
            await session.execute(
                select(UserCampaignProgress).where(UserCampaignProgress.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    prog: dict[tuple[str, int], UserCampaignProgress] = {(p.world, p.level_number): p for p in rows}

    out: list[tuple[cm.CampaignWorld, cm.CampaignLevel]] = []
    for w in cm.worlds():
        prev_cleared = True  # level 1 is always unlocked
        locked_ahead = 0
        for lvl in w.levels:
            unlocked = lvl.level_number == 1 or prev_cleared
            if unlocked:
                out.append((w, lvl))
            elif locked_ahead < lookahead:
                out.append((w, lvl))
                locked_ahead += 1
            else:
                break  # further levels are all locked and beyond the lookahead window
            p = prog.get((w.world, lvl.level_number))
            prev_cleared = p is not None and p.clear_status is not None
    return out


# --- start -----------------------------------------------------------------------------------


def bank_key_index(category: str, bank: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """question_key → bank row for one category. `question_key` is a hash over the canonical
    English prompt, so building this is O(bank) hashing — callers resolving MANY levels (the
    offline bundle) build it once per category instead of once per level."""
    return {question_key(category, q["payload"]["prompt"]): q for q in bank}


def authored_bank_questions(
    level: cm.CampaignLevel,
    bank: list[dict[str, Any]],
    *,
    by_key: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """The ordered authored bank questions for a level, resolved against the live servable bank.

    Resolves each of the level's `question_keys` (in serve order) to its `fetch_bank` row via the
    same `question_key(category, prompt)` mapping the online campaign uses. Raises
    `CategoryUnavailableError` if any authored question is no longer servable (content drift) — the
    same behavior `_build_campaign_round_set` has always had. Shared by the online round-set builder
    and the offline bundle builder so both resolve identically (offline scores the same on sync).
    `by_key` lets a caller reuse a `bank_key_index(level.category, bank)` across levels.
    """
    if by_key is None:
        by_key = bank_key_index(level.category, bank)
    resolved: list[dict[str, Any]] = []
    for key in level.question_keys:
        q = by_key.get(key)
        if q is None:
            raise CategoryUnavailableError(
                f"campaign {level.world} L{level.level_number}: question {key} not servable"
            )
        resolved.append(q)
    return resolved


def campaign_level_seed(user_id: uuid.UUID, world: str, level_number: int) -> int:
    """Deterministic per-(user, world, level) seed for offline round option shuffles.

    Stable across processes and re-downloads of the offline bundle (seeded off the string form).
    It deliberately does NOT match the online path (a random per-entry seed): sync re-scores by the
    stable ORIGINAL option index (option_source_index), not by re-deriving the shuffle, so scoring
    parity never depends on the offline and online seeds agreeing.
    """
    from random import Random

    return Random(f"offline:{user_id}:{world}:{level_number}").getrandbits(63)


def _build_campaign_round_set(
    level: cm.CampaignLevel, bank: list[dict[str, Any]], seed: int
) -> list[GeneratedRound]:
    """Resolve a level's authored question_keys against the live servable bank and build the exact,
    ordered round set. Raises if any authored question is no longer servable (content drift).

    `seed` drives the per-question server-side option shuffle (trivia_spec), so the displayed answer
    position is decorrelated from the skewed bank order and the level is reproducible from the seed.
    """
    rounds: list[GeneratedRound] = []
    for idx, q in enumerate(authored_bank_questions(level, bank)):
        client_spec, server_answer = trivia_spec(q, shuffle_seed=seed)
        rounds.append(GeneratedRound(idx, "trivia", client_spec, server_answer))
    return rounds


async def _is_unlocked(
    session: AsyncSession, user_id: uuid.UUID, world: str, level_number: int
) -> bool:
    if level_number <= 1:
        return True
    prev = await session.get(UserCampaignProgress, (user_id, world, level_number - 1))
    return prev is not None and prev.clear_status is not None


async def get_unlocked_level_or_raise(
    session: AsyncSession,
    user_id: uuid.UUID,
    world: str,
    level_number: int,
    now: datetime | None = None,
) -> cm.CampaignLevel:
    """Return the manifest level if it exists AND is unlocked for the user, else raise the real
    campaign error (`LevelNotFoundError` / `LevelLockedError`). The single unlock gate, shared by
    `start_campaign_level` (online) and the offline sync — so both admit exactly the same levels.

    `now` is accepted for a uniform signature with the callers; the unlock rule is progress-based
    (previous level cleared) and does not currently consult the clock."""
    level = cm.get_level(world, level_number)
    if level is None:
        raise LevelNotFoundError(f"{world} L{level_number}")
    if not await _is_unlocked(session, user_id, world, level_number):
        raise LevelLockedError(f"{world} L{level_number}")
    return level


async def start_campaign_level(
    session: AsyncSession,
    user_id: uuid.UUID,
    world: str,
    level_number: int,
    now: datetime | None = None,
    locale: str = "en",
) -> tuple[Entry, cm.CampaignLevel]:
    """Start a campaign level: validate it's unlocked, build the exact authored round set, and link
    the play Entry to (world, level). Does not commit."""
    now = now or datetime.now(UTC)
    level = await get_unlocked_level_or_raise(session, user_id, world, level_number, now=now)

    bank = await fetch_bank(session, "trivia", category=level.category, locale=locale)
    if not bank:
        raise CategoryUnavailableError(level.category)
    # The question SET is authored (not seed-drawn), but the seed drives the server-side option
    # shuffle (trivia_spec) — so it is genuinely reproducible, not vestigial. Generate it before
    # building rounds so the same seed is used for the shuffle and stored on the entry.
    seed = secrets.randbits(63)
    rounds = _build_campaign_round_set(level, bank, seed)

    entry = Entry(
        window_id=None,
        user_id=user_id,
        is_practice=True,  # window-less, no stakes, kept out of standings/settlement
        seed=seed,
        round_set=[
            {"idx": r.idx, "type": r.module_type, "client_spec": r.client_spec} for r in rounds
        ],
        started_at=now,
        status=IN_PROGRESS,
    )
    session.add(entry)
    await session.flush()  # assign entry.id

    for r in rounds:
        session.add(
            RoundAnswer(
                entry_id=entry.id,
                idx=r.idx,
                module_type=r.module_type,
                server_answer=r.server_answer,
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
    return entry, level


# --- complete + reward -----------------------------------------------------------------------


def _reward_components(correct: int, first_clear_claimed: bool) -> list[tuple[str, int]]:
    """The (reason, amount) coin components for a finished level, BEFORE the daily cap is applied.
    First clear stacks the strong/perfect bonuses; an already-cleared level pays only the flat
    replay amount (anti-farm). A failed run earns nothing."""
    if not is_pass(correct):
        return []
    if first_clear_claimed:
        return [("campaign_replay_clear", CAMPAIGN_COIN_REPLAY_CLEAR)]
    components = [("campaign_first_clear", CAMPAIGN_COIN_FIRST_CLEAR)]
    if correct >= _strong_threshold():
        components.append(("campaign_strong_clear", CAMPAIGN_COIN_STRONG_BONUS))
    if correct >= _perfect_threshold():
        components.append(("campaign_perfect", CAMPAIGN_COIN_PERFECT_BONUS))
    return components


async def _campaign_grant_for_entry(session: AsyncSession, entry_id: uuid.UUID) -> int:
    """Sum of campaign coin deltas paid for this entry (0 if none — a fail or capped pass)."""
    rows = (
        (
            await session.execute(
                select(CoinLedger.delta).where(
                    CoinLedger.ref_type == "campaign", CoinLedger.ref_id == entry_id
                )
            )
        )
        .scalars()
        .all()
    )
    return int(sum(rows))


async def _campaign_gem_grant_for_entry(session: AsyncSession, entry_id: uuid.UUID) -> int:
    """Sum of campaign gem deltas attributed to this entry (ref_type='campaign', ref_id=entry)."""
    rows = (
        (
            await session.execute(
                select(GemLedger.delta).where(
                    GemLedger.ref_type == "campaign", GemLedger.ref_id == entry_id
                )
            )
        )
        .scalars()
        .all()
    )
    return int(sum(rows))


async def complete_campaign_level(
    session: AsyncSession,
    entry_id: uuid.UUID,
    user_id: uuid.UUID,
    now: datetime | None = None,
) -> CampaignCompletion:
    """Settle a finished campaign level: recompute correct/total from persisted results, pay coins
    (capped per ET day), and upsert progress. Idempotent — a re-call for an already-rewarded entry
    returns the recorded result without paying again. Does not commit (request boundary does)."""
    now = now or datetime.now(UTC)

    entry = await session.get(Entry, entry_id)
    if entry is None or entry.user_id != user_id or not entry.is_practice:
        raise EntryNotFoundError()
    # Lock the campaign-session row so two concurrent completes of the SAME entry serialize: the
    # loser blocks here, then falls into the `settled_at is not None` idempotent branch below
    # instead of paying the first-clear stack a second time.
    link = await session.get(CampaignSession, entry_id, with_for_update=True)
    if link is None:
        raise NotACampaignEntryError()
    if entry.status != SUBMITTED:
        raise LevelNotFinishedError()

    level = cm.get_level(link.world, link.level_number)
    if level is None:  # manifest changed under a live entry — treat as gone
        raise LevelNotFoundError(f"{link.world} L{link.level_number}")

    results = (
        (await session.execute(select(RoundResult).where(RoundResult.entry_id == entry_id)))
        .scalars()
        .all()
    )
    total = len(results)
    correct = sum(1 for r in results if r.correct and r.valid)
    status = clear_status_for(correct)
    passed = is_pass(correct)

    progress = await session.get(UserCampaignProgress, (user_id, link.world, link.level_number))
    cleared_before = progress is not None and progress.clear_status is not None

    if link.settled_at is not None:
        # Already settled (idempotent) — report the recorded outcome, change nothing. This guard is
        # on the per-entry marker, NOT on the presence of a coin row, so a failed or cap-exhausted
        # (zero-coin) completion is still settled-once and never re-runs the progress upsert.
        return CampaignCompletion(
            world=link.world,
            level_number=link.level_number,
            title=level.title,
            is_boss=level.is_boss,
            correct=correct,
            total=total,
            passed=passed,
            clear_status=progress.clear_status if progress else status,
            coins_awarded=await _campaign_grant_for_entry(session, entry_id),
            gems_awarded=await _campaign_gem_grant_for_entry(session, entry_id),
            daily_cap_reached=False,
            first_clear=False,
            next_level_unlocked=False,
            best_correct=progress.best_correct if progress else correct,
            already_settled=True,
        )

    # Award coins (priority order), clamped to the remaining daily cap.
    components = _reward_components(
        correct, first_clear_claimed=bool(progress and progress.first_clear_claimed)
    )
    # Lock the player's profile BEFORE reading today's earned total. Without this, two completes of
    # DIFFERENT levels racing for the same user each read the cap as unspent and both pay in full —
    # blowing past CAMPAIGN_DAILY_COIN_CAP. The lock serializes them on the profile row
    # (record_coin_delta re-locks the same row this session), so the second read sees the first's.
    if components:
        await session.get(Profile, user_id, with_for_update=True, populate_existing=True)
    earned_today = await _campaign_coins_today(session, user_id, now)
    remaining = max(0, CAMPAIGN_DAILY_COIN_CAP - earned_today)
    coins_awarded = 0
    capped = False
    for reason, amount in components:
        grant = min(amount, remaining)
        if grant <= 0:
            capped = True
            break
        # Idempotency-keyed on (entry, reason): even if the settled-once gate were bypassed, the
        # ledger's partial unique index refuses a duplicate grant for this entry+reason. Each entry
        # pays each reason at most once. (reason is unique within one completion's components.)
        await record_coin_delta(
            session,
            user_id,
            grant,
            reason,
            ref_type="campaign",
            ref_id=entry_id,
            idempotency_key=f"campaign:{entry_id}:{reason}",
        )
        remaining -= grant
        coins_awarded += grant
        if grant < amount:
            capped = True
            break

    # Upsert progress.
    first_clear = passed and not cleared_before
    if progress is None:
        # Set the defaults explicitly: server_defaults only materialize on flush, but we mutate
        # best_correct/times_cleared below (before flush), so they must be real ints now.
        progress = UserCampaignProgress(
            user_id=user_id,
            world=link.world,
            level_number=link.level_number,
            best_correct=0,
            times_cleared=0,
            first_clear_claimed=False,
        )
        session.add(progress)
    progress.best_correct = max(progress.best_correct, correct)
    progress.updated_at = now
    if passed:
        progress.clear_status = _best_status(progress.clear_status, status)
        progress.first_clear_claimed = True
        progress.times_cleared += 1
        progress.completed_at = now
    link.settled_at = now  # mark settled-once (even on a zero-coin fail / capped pass)
    await session.flush()

    # --- Gem milestones: fixed, first-time-only (idempotency-keyed), BYPASSING the coin daily cap.
    # Only on a pass. record_gem_delta is a no-op if the key already exists (granted by an earlier
    # entry), so a milestone already earned is neither re-granted nor re-counted. All grants use
    # ref_id=entry_id, so _campaign_gem_grant_for_entry reports just this completion's new grants.
    if passed:
        if link.level_number == CAMPAIGN_CHEST_LEVEL:
            await record_gem_delta(
                session,
                user_id,
                GEM_CAMPAIGN_LEVEL5_CHEST,
                "campaign_level5_chest",
                ref_type="campaign",
                ref_id=entry_id,
                ref_key=f"{link.world}:{CAMPAIGN_CHEST_LEVEL}",
                idempotency_key=f"cm:{user_id}:{link.world}:{CAMPAIGN_CHEST_LEVEL}:chest",
            )
        if level.is_boss:
            await record_gem_delta(
                session,
                user_id,
                GEM_CAMPAIGN_BOSS_CLEAR,
                "campaign_boss_clear",
                ref_type="campaign",
                ref_id=entry_id,
                ref_key=f"{link.world}:{link.level_number}",
                idempotency_key=f"cm:{user_id}:{link.world}:{link.level_number}:boss",
            )
            if correct >= _perfect_threshold():
                await record_gem_delta(
                    session,
                    user_id,
                    GEM_CAMPAIGN_PERFECT_BOSS,
                    "campaign_perfect_boss",
                    ref_type="campaign",
                    ref_id=entry_id,
                    ref_key=f"{link.world}:{link.level_number}",
                    idempotency_key=f"cm:{user_id}:{link.world}:{link.level_number}:perfect_boss",
                )
        # These two grouped COUNT queries run on every passing completion by design (cheap,
        # indexed, pass-gated). A tighter guard is avoided because a clear->perfect replay can newly
        # complete a perfect-world without changing the level's cleared count.
        perfect_completion = await world_completion(session, user_id, perfect_only=True)
        if world_cleared(perfect_completion, link.world):
            await record_gem_delta(
                session,
                user_id,
                GEM_CAMPAIGN_PERFECT_WORLD,
                "campaign_perfect_world",
                ref_type="campaign",
                ref_id=entry_id,
                ref_key=link.world,
                idempotency_key=f"cm:{user_id}:{link.world}:perfect_world",
            )
        cleared_completion = await world_completion(session, user_id)
        if all_worlds_cleared(cleared_completion):
            await record_gem_delta(
                session,
                user_id,
                GEM_CAMPAIGN_ALL_WORLDS,
                "campaign_all_worlds",
                ref_type="campaign",
                ref_id=entry_id,
                ref_key="all",
                idempotency_key=f"cm:{user_id}:all_worlds",
            )
    gems_awarded = await _campaign_gem_grant_for_entry(session, entry_id)

    next_level_unlocked = first_clear and link.level_number < cm.levels_per_world()
    return CampaignCompletion(
        world=link.world,
        level_number=link.level_number,
        title=level.title,
        is_boss=level.is_boss,
        correct=correct,
        total=total,
        passed=passed,
        clear_status=status,
        coins_awarded=coins_awarded,
        gems_awarded=gems_awarded,
        daily_cap_reached=capped,
        first_clear=first_clear,
        next_level_unlocked=next_level_unlocked,
        best_correct=progress.best_correct,
        already_settled=False,
    )
