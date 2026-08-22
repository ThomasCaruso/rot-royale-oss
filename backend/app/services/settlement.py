"""Settlement. Runs once per window at/after close: rank the field, apply Elo rating +
division, advance the daily streak, write standings, mark SETTLED. Pays NO coins — ranked contests
grant rating/division/streak (status); coins are earned in campaign/practice and spent in the Vault.
The COINS_*/STREAK_BONUS constants are the tuning seam; zero-value ledger writes are skipped so the
append-only ledger never carries zero-value rows.

Exactly-once + atomic: settle_window locks the window row (FOR UPDATE) and only acts if state is
CLOSED; it NEVER commits — the caller commits the whole thing in one transaction, so the SETTLED
flip and all profile/standing writes land together.

The field is REAL ENTRIES ONLY — cold-start bots that once padded a thin field are gone, so a
placement always describes people who actually played.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import (
    COINS_BY_PLACE,
    COINS_PARTICIPATION,
    COINS_TOP_THIRD,
    GEM_DR_CROWN,
    GEM_DR_TOP_3,
    GEM_DR_TOP_10PCT,
    GEM_DR_TOP_25PCT,
    GEM_DR_TOP_50PCT,
    GEM_STARTER_DAILY_ROYALE,
    RATING_K,
    STREAK_BONUS_PER_DAY,
    STREAK_MILESTONE_COIN_REASON,
    STREAK_MILESTONE_GEM_REASON,
    STREAK_MILESTONE_REWARDS,
)
from app.models import ContestWindow, Entry, Profile, RoundResult, Standing, User
from app.models.contest import CLOSED, SETTLED, SUBMITTED
from app.models.user import GUEST_STATUS
from app.services.gem_ledger import record_gem_delta
from app.services.ledger import record_coin_delta
from app.services.rating import division_for_rating


# ---------------- pure helpers (tunable rules) ----------------
def coins_for_place(place: int, field_size: int) -> int:
    if place in COINS_BY_PLACE:
        return COINS_BY_PLACE[place]
    if place <= math.ceil(field_size / 3):
        return COINS_TOP_THIRD
    return COINS_PARTICIPATION


def gems_for_place(place: int, field_size: int) -> tuple[int, str] | None:
    """Highest applicable Daily Royale gem tier (amount, tier_label), or None. Never stacks.

    The tiers are evaluated top-down and the first match wins, so each place gets exactly one tier
    (the best it qualifies for). Percentile tiers use math.ceil(field_size * frac) so even a small
    real field still has a top slice.
    """
    if place == 1:
        return GEM_DR_CROWN, "dr_crown"
    if place <= 3:
        return GEM_DR_TOP_3, "dr_top_3"
    if place <= math.ceil(field_size * 0.10):
        return GEM_DR_TOP_10PCT, "dr_top_10pct"
    if place <= math.ceil(field_size * 0.25):
        return GEM_DR_TOP_25PCT, "dr_top_25pct"
    if place <= math.ceil(field_size * 0.50):
        return GEM_DR_TOP_50PCT, "dr_top_50pct"
    return None


def rating_delta(place: int, field_size: int) -> int:
    if field_size <= 1:
        return 0
    score = (field_size - place) / (field_size - 1)  # 1.0 for 1st … 0.0 for last
    return round((score - 0.5) * RATING_K)


def grace_available(grace_used_date: date | None, contest_date: date) -> bool:
    """The free weekly streak-grace is available unless it was already spent THIS ISO week."""
    if grace_used_date is None:
        return True
    return grace_used_date.isocalendar()[:2] != contest_date.isocalendar()[:2]


def next_streak(
    last_streak_date: date | None,
    contest_date: date,
    current: int,
    can_use_grace: bool = False,
) -> tuple[int, date, bool]:
    """Daily streak keyed off the contest's ET calendar date (NOT settlement wall-clock). Returns
    (new_streak, new_date, grace_consumed). A single missed day is forgiven ONCE per ISO week — the
    free weekly streak-grace — so a strong streak survives one slip instead of resetting to 1."""
    if last_streak_date == contest_date:
        return current, contest_date, False  # already counted this day
    if last_streak_date == contest_date - timedelta(days=1):
        return current + 1, contest_date, False  # consecutive day
    if can_use_grace and current >= 1 and last_streak_date == contest_date - timedelta(days=2):
        # Exactly one missed day, and the weekly grace is available → the streak lives on.
        return current + 1, contest_date, True
    return 1, contest_date, False  # first ever, or a gap → reset


def _streak_bonus(streak: int) -> int:
    return (streak + 1) * STREAK_BONUS_PER_DAY


def streak_milestone_reward(streak: int) -> tuple[int, int] | None:
    """The (coins, gems) reward for first reaching this daily-streak day (3/5/7), or None.

    Earned, never purchasable — the engagement-layer loss-aversion teeth. Granted in settle_window
    (royale only), idempotency-keyed so a re-settle never double-grants."""
    return STREAK_MILESTONE_REWARDS.get(streak)


# ---------------- ranking ----------------
@dataclass
class _Ranked:
    entry: Entry  # always a real entry — the synthetic field-fill was removed
    total_score: int
    avg_time_frac: float


def _build_field(real: list[_Ranked], window: ContestWindow) -> list[_Ranked]:
    """The ranked field: REAL entries only.

    Cold-start bots used to pad a thin field here (in memory, never persisted). They are gone. The
    Daily Royale ranks the people who actually played and nobody else — a placement of "3rd of 8"
    where five of the eight were synthetic is not a real standing, and DESIGN §7's honesty rule
    (field counts come from real entries) applies to the ranking itself, not only to the count shown
    on screen.

    A consequence worth knowing: a one-entry field now settles as 1st of 1, and `rating_delta`
    already returns 0 for `field_size <= 1`, so a solo day moves no rating rather than inventing an
    opponent to beat. Duel rivals are unaffected — those are an explicit, disclosed 1v1 opponent.
    """
    field = list(real)
    # higher score wins; faster (higher avg time_frac) breaks ties
    field.sort(key=lambda r: (-r.total_score, -r.avg_time_frac))
    return field


# ---------------- the job ----------------
async def settle_window(session: AsyncSession, window_id: uuid.UUID) -> bool:
    """Settle a CLOSED window. Returns True if it settled, False if skipped. Does NOT commit."""
    window = (
        await session.execute(
            select(ContestWindow).where(ContestWindow.id == window_id).with_for_update()
        )
    ).scalar_one_or_none()
    if window is None or window.state != CLOSED:
        return False  # not ready, or already settled → no-op (exactly-once)

    # Leaderboard permanence requires a SAVED profile: entries whose user is still a guest at
    # settle time are excluded from ranking/rating/streak/standings/gems (they previewed the run;
    # the score "disappears" unless they save before settlement — the onboarding gate's promise).
    # Guests upgraded before 12:15 AM ET are ordinary users here. Play paths are never gated.
    entries = (
        (
            await session.execute(
                select(Entry)
                .join(User, User.id == Entry.user_id)
                .where(
                    Entry.window_id == window_id,
                    Entry.status == SUBMITTED,
                    User.status != GUEST_STATUS,
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

    real = [
        _Ranked(entry=e, total_score=e.total_score or 0, avg_time_frac=avg_by_entry.get(e.id, 0.0))
        for e in entries
    ]
    field = _build_field(real, window)
    field_size = len(field)
    # Gems are granted ONLY for the Daily Royale (royale slot). Legacy/test windows pay none.
    is_royale = window.slot == "royale"

    for place, ranked in enumerate(field, start=1):
        user_id = ranked.entry.user_id
        profile = await session.get(Profile, user_id)
        if profile is None:
            continue

        rating_before = profile.rating
        rating_after = rating_before + rating_delta(place, field_size)
        can_grace = grace_available(profile.streak_grace_used_date, window.contest_date)
        new_streak, new_date, grace_used = next_streak(
            profile.last_streak_date, window.contest_date, profile.streak_count, can_grace
        )
        base = coins_for_place(place, field_size)
        bonus = _streak_bonus(new_streak)

        if base:
            await record_coin_delta(
                session, user_id, base, "contest_payout", ref_type="window", ref_id=window_id
            )
        if bonus:
            await record_coin_delta(
                session, user_id, bonus, "streak_bonus", ref_type="window", ref_id=window_id
            )

        # Daily Royale gems (royale slot only): one-time starter + highest-tier placement. The gem
        # ledger is idempotent on the keys below, so a re-settle never double-grants.
        gems_awarded = 0
        if is_royale:
            await record_gem_delta(
                session,
                user_id,
                GEM_STARTER_DAILY_ROYALE,
                "starter_daily_royale",
                idempotency_key=f"starter:{user_id}",
            )
            tier = gems_for_place(place, field_size)
            if tier:
                amount, label = tier
                await record_gem_delta(
                    session,
                    user_id,
                    amount,
                    "daily_royale_placement",
                    ref_type="window",
                    ref_id=window_id,
                    ref_key=label,
                    idempotency_key=f"dr:{window_id}:{user_id}",
                )
                gems_awarded = amount

        # Streak milestone reward (royale only): a small EARNED grant the first time the streak
        # reaches day 3/5/7. Idempotency-keyed on (user, milestone, contest_date) so a re-settle
        # never double-grants; a fresh streak reaching the same day on a later date pays again.
        if is_royale and (milestone := streak_milestone_reward(new_streak)) is not None:
            m_coins, m_gems = milestone
            if m_gems:
                await record_gem_delta(
                    session,
                    user_id,
                    m_gems,
                    STREAK_MILESTONE_GEM_REASON,
                    ref_type="window",
                    ref_id=window_id,
                    ref_key=f"day_{new_streak}",
                    idempotency_key=f"streak:{user_id}:{new_streak}:{window.contest_date}",
                )
            if m_coins:
                await record_coin_delta(
                    session,
                    user_id,
                    m_coins,
                    STREAK_MILESTONE_COIN_REASON,
                    ref_type="window",
                    ref_id=window_id,
                    ref_key=f"day_{new_streak}",
                    idempotency_key=f"streak:{user_id}:{new_streak}:{window.contest_date}",
                )

        profile.rating = rating_after
        profile.division = division_for_rating(rating_after)
        profile.streak_count = new_streak
        profile.last_streak_date = new_date
        if grace_used:
            profile.streak_grace_used_date = window.contest_date

        session.add(
            Standing(
                window_id=window_id,
                user_id=user_id,
                place=place,
                field_size=field_size,
                total_score=ranked.total_score,
                coins_awarded=base + bonus,
                gems_awarded=gems_awarded,
                rating_before=rating_before,
                rating_after=rating_after,
            )
        )

    window.state = SETTLED
    window.settled_at = datetime.now(UTC)
    await session.flush()
    return True
