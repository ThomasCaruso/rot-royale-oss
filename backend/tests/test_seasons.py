"""Monthly season soft-reset: season-end gem rewards by final division/tier, ratings + duel XP
pulled halfway to baseline, exactly-once per season, and non-participants untouched."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from app.models import DuelUserStats, Profile, User
from app.services.seasons import (
    apply_season_reset,
    current_season_key,
    ended_season_key,
    season_key,
    season_label,
    soft_reset_rating,
    soft_reset_xp,
)
from sqlalchemy.ext.asyncio import AsyncSession

NOW = datetime(2026, 7, 5, 12, 0, tzinfo=UTC)  # July → the season that just ended is June 2026


# ---------------- pure helpers ----------------
def test_season_keys_and_labels():
    assert season_key(date(2026, 7, 5)) == "2026-07"
    assert season_label("2026-07") == "July 2026"
    assert current_season_key(NOW) == "2026-07"
    assert ended_season_key(NOW) == "2026-06"
    # January rolls back across the year boundary.
    assert ended_season_key(datetime(2026, 1, 3, tzinfo=UTC)) == "2025-12"


def test_soft_reset_math():
    assert soft_reset_rating(1400) == 1200  # halfway from 1000 baseline
    assert soft_reset_rating(1000) == 1000  # already at baseline
    assert soft_reset_rating(600) == 800
    assert soft_reset_xp(150) == 75
    assert soft_reset_xp(0) == 0


# ---------------- integration ----------------
async def _user(session: AsyncSession, *, rating: int, division: str, xp: int | None, tier: str):
    u = User(email=f"{uuid.uuid4().hex}@s.test", password_hash="x")
    session.add(u)
    await session.flush()
    session.add(
        Profile(
            user_id=u.id, username=f"u{uuid.uuid4().hex[:10]}", division=division, rating=rating
        )
    )
    if xp is not None:
        session.add(DuelUserStats(user_id=u.id, duel_xp=xp, duel_tier=tier))
    await session.flush()
    return u


async def test_reset_rewards_and_soft_resets_participants(db_session: AsyncSession):
    a = await _user(db_session, rating=1400, division="Gold", xp=150, tier="silver")
    b = await _user(db_session, rating=1000, division="Bronze", xp=None, tier="bronze")  # inactive

    result = await apply_season_reset(db_session, now=NOW)
    assert result.applied is True
    assert result.season == "2026-06"
    assert result.rewarded == 1  # only the participant

    pa = await db_session.get(Profile, a.id)
    sa = await db_session.get(DuelUserStats, a.id)
    # Reward = Gold(6) + silver(3) = 9 gems, paid before the reset.
    assert pa.gems_balance == 9
    # Rating + duel XP pulled halfway to baseline; division/tier recomputed.
    assert pa.rating == 1200
    assert pa.division == "Silver"
    assert sa.duel_xp == 75
    assert sa.duel_tier == "bronze"

    pb = await db_session.get(Profile, b.id)
    assert pb.gems_balance == 0  # inactive → no reward
    assert pb.rating == 1000  # baseline → unchanged


async def test_reset_is_exactly_once(db_session: AsyncSession):
    a = await _user(db_session, rating=1400, division="Gold", xp=150, tier="silver")

    first = await apply_season_reset(db_session, now=NOW)
    assert first.applied is True
    pa1 = await db_session.get(Profile, a.id)
    gems_after_first = pa1.gems_balance
    rating_after_first = pa1.rating

    second = await apply_season_reset(db_session, now=NOW)  # same season already claimed
    assert second.applied is False
    pa2 = await db_session.get(Profile, a.id)
    assert pa2.gems_balance == gems_after_first  # no double reward
    assert pa2.rating == rating_after_first  # no double reset


async def test_season_endpoint_reports_current_standing(client):
    r = await client.post(
        "/auth/register",
        json={"email": "season@x.com", "username": "seasonp", "password": "super-secret-pw"},
    )
    token = r.json()["access_token"]
    resp = await client.get("/me/season", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["season"]) == 7 and body["season"][4] == "-"  # "YYYY-MM"
    assert body["label"] and body["ends_at"]
    assert body["division"] == "Bronze"  # fresh account
    assert body["duel_tier"] == "bronze"
