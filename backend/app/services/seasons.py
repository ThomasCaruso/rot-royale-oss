"""Seasons — monthly soft-reset of the ranked rating + duel-tier ladders, with season-end rewards.

A season is one ET calendar month (key ``YYYY-MM``). At each rollover the *previous* season is
closed exactly once (a claimed ``season_resets`` row): everyone's rating and duel XP are pulled
halfway toward their baselines, and a one-time GEM reward is paid by final rating division + duel
tier. Status/rewards only — never touches coins, and the reward flows through the idempotent gem
ledger, so a re-run can never double-pay.
"""

from __future__ import annotations

import calendar
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import (
    SEASON_DUEL_REWARDS,
    SEASON_RATING_REWARDS,
    SEASON_RESET_FACTOR,
    STARTING_RATING,
)
from app.core.timezone import ET
from app.models import DuelUserStats, Profile, SeasonReset
from app.services.duel_logic import tier_for_xp
from app.services.gem_ledger import record_gem_delta
from app.services.rating import division_for_rating


# ---------------- season keys / dates ----------------
def season_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def season_label(key: str) -> str:
    """'2026-07' → 'July 2026'."""
    y, m = key.split("-")
    return f"{calendar.month_name[int(m)]} {y}"


def current_season_key(now: datetime) -> str:
    return season_key(now.astimezone(ET).date())


def ended_season_key(now: datetime) -> str:
    """The season (previous ET month) that has ended and should be reset once this month begins."""
    first_of_month = now.astimezone(ET).date().replace(day=1)
    return season_key(first_of_month - timedelta(days=1))


def season_ends_at(now: datetime) -> datetime:
    """The UTC instant the current season ends — 00:00 ET on the first of next ET month."""
    et_today = now.astimezone(ET).date()
    # jump into next month, then to its first day
    nxt = (et_today.replace(day=28) + timedelta(days=4)).replace(day=1)
    return datetime(nxt.year, nxt.month, nxt.day, tzinfo=ET).astimezone(UTC)


# ---------------- soft-reset math ----------------
def soft_reset_rating(rating: int) -> int:
    return round(STARTING_RATING + (rating - STARTING_RATING) * SEASON_RESET_FACTOR)


def soft_reset_xp(xp: int) -> int:
    return round(xp * SEASON_RESET_FACTOR)


# ---------------- the reset job ----------------
@dataclass
class SeasonResetResult:
    applied: bool
    season: str
    reset: int  # profiles soft-reset
    rewarded: int  # profiles paid a season-end reward


async def apply_season_reset(
    session: AsyncSession, now: datetime | None = None
) -> SeasonResetResult:
    """Close + reset the just-ended season, exactly once. Does NOT commit — the caller commits (the
    claim + batch land in one transaction, so a crash rolls back and a re-run redoes it cleanly)."""
    now = now or datetime.now(UTC)
    ended = ended_season_key(now)

    claim = (
        pg_insert(SeasonReset)
        .values(season_key=ended)
        .on_conflict_do_nothing(index_elements=["season_key"])
        .returning(SeasonReset.season_key)
    )
    if (await session.scalars(claim)).one_or_none() is None:
        return SeasonResetResult(applied=False, season=ended, reset=0, rewarded=0)

    profiles = (await session.execute(select(Profile))).scalars().all()
    stats_by_user: dict[uuid.UUID, DuelUserStats] = {
        s.user_id: s for s in (await session.execute(select(DuelUserStats))).scalars().all()
    }

    reset_count = 0
    rewarded = 0
    for p in profiles:
        stats = stats_by_user.get(p.user_id)
        # Reward is based on the FINAL standing (computed before the reset).
        rating_reward = SEASON_RATING_REWARDS.get(p.division, 0)
        duel_reward = SEASON_DUEL_REWARDS.get(stats.duel_tier, 0) if stats is not None else 0
        total = rating_reward + duel_reward
        participated = p.rating != STARTING_RATING or (stats is not None and stats.duel_xp > 0)
        if total > 0 and participated:
            await record_gem_delta(
                session,
                p.user_id,
                total,
                "season_reward",
                ref_key=ended,
                idempotency_key=f"season:{ended}:{p.user_id}",
            )
            rewarded += 1

        new_rating = soft_reset_rating(p.rating)
        if new_rating != p.rating:
            p.rating = new_rating
            p.division = division_for_rating(new_rating)
        if stats is not None and stats.duel_xp > 0:
            stats.duel_xp = soft_reset_xp(stats.duel_xp)
            stats.duel_tier = tier_for_xp(stats.duel_xp)
        reset_count += 1

    return SeasonResetResult(applied=True, season=ended, reset=reset_count, rewarded=rewarded)


# ---------------- read model (for the UI) ----------------
@dataclass
class SeasonStatus:
    season: str
    label: str
    ends_at: datetime
    rating: int
    division: str
    duel_tier: str


async def season_status(
    session: AsyncSession, user_id: uuid.UUID, now: datetime | None = None
) -> SeasonStatus:
    now = now or datetime.now(UTC)
    profile = await session.get(Profile, user_id)
    stats = await session.get(DuelUserStats, user_id)
    key = current_season_key(now)
    return SeasonStatus(
        season=key,
        label=season_label(key),
        ends_at=season_ends_at(now),
        rating=profile.rating if profile else STARTING_RATING,
        division=profile.division if profile else "Bronze",
        duel_tier=stats.duel_tier if stats else "bronze",
    )
