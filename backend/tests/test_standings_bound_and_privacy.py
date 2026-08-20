"""Standings: bounded response, and no cross-user rating disclosure (Audit 2B-1 / 2B-hidden-Elo).

Two independent properties of the same endpoint:

1. BOUNDED. `/contests/{id}/standings` returned every Standing row for the window. `/field` in the
   same module was already capped to a top slice for exactly this reason; standings was not. As the
   field grows, one authenticated request becomes a memory and egress amplifier.

2. PRIVATE ELO. `MeResponse` documents rating as "kept under the hood", yet standings published
   `rating_before`/`rating_after` for every participant, so any player could enumerate everyone's
   hidden rating. Elo is private: a player may see their OWN rating through /me and their own
   settled history, never another player's.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from app.api.contests import STANDINGS_MAX
from app.models import ContestWindow, Profile, Standing, User
from app.models.contest import SETTLED
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


def _auth(t: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {t}"}


async def _register(client: AsyncClient, email: str, username: str) -> str:
    r = await client.post(
        "/auth/register", json={"email": email, "username": username, "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _settled_window(session: AsyncSession) -> ContestWindow:
    now = datetime.now(UTC)
    w = ContestWindow(
        contest_date=now.date(),
        slot="royale",
        open_at=now - timedelta(hours=3),
        close_at=now - timedelta(hours=1),
        state=SETTLED,
        template_id="dr_8_trivia",
    )
    session.add(w)
    await session.flush()
    return w


async def _fill(session: AsyncSession, window: ContestWindow, n: int) -> None:
    """n standings rows, each with its own user+profile (the join requires a profile).

    Users and profiles are flushed BEFORE the standings rows: Standing declares no ORM relationship
    to User, so SQLAlchemy cannot infer the insert order and would otherwise hit the FK.
    """
    users = []
    for i in range(n):
        u = User(
            id=uuid.uuid4(), email=f"s{i}-{uuid.uuid4().hex[:6]}@example.com", password_hash="x"
        )
        session.add(u)
        session.add(
            Profile(user_id=u.id, username=f"stand_{i}_{uuid.uuid4().hex[:5]}", division="bronze")
        )
        users.append(u)
    await session.flush()

    for i, u in enumerate(users):
        session.add(
            Standing(
                window_id=window.id,
                user_id=u.id,
                place=i + 1,
                field_size=n,
                total_score=1000 - i,
                coins_awarded=0,
                gems_awarded=0,
                rating_before=1200 + i,
                rating_after=1210 + i,
            )
        )
    await session.flush()


async def test_standings_are_capped_by_the_server(client: AsyncClient, db_session: AsyncSession):
    """A field larger than the cap must not produce an unbounded response."""
    window = await _settled_window(db_session)
    await _fill(db_session, window, STANDINGS_MAX + 12)
    token = await _register(client, "bound1@example.com", "bounduser1")

    r = await client.get(f"/contests/{window.id}/standings", headers=_auth(token))
    assert r.status_code == 200, r.text
    rows = r.json()["standings"]
    assert len(rows) == STANDINGS_MAX, f"expected the cap, got {len(rows)}"


async def test_the_cap_keeps_the_top_of_the_leaderboard(
    client: AsyncClient, db_session: AsyncSession
):
    """Bounding must not scramble the leaderboard: it keeps places 1..N in order, which is the part
    a player actually cares about."""
    window = await _settled_window(db_session)
    await _fill(db_session, window, STANDINGS_MAX + 12)
    token = await _register(client, "bound2@example.com", "bounduser2")

    rows = (await client.get(f"/contests/{window.id}/standings", headers=_auth(token))).json()[
        "standings"
    ]
    places = [s["place"] for s in rows]
    assert places == sorted(places), "ordering is not deterministic/ascending"
    assert places[0] == 1, "the winner must still be first"
    assert places == list(range(1, STANDINGS_MAX + 1)), "the cap must take the TOP slice"


async def test_field_size_still_reports_the_true_total(
    client: AsyncClient, db_session: AsyncSession
):
    """Truncating the list must not misreport how many people played."""
    window = await _settled_window(db_session)
    total = STANDINGS_MAX + 12
    await _fill(db_session, window, total)
    token = await _register(client, "bound3@example.com", "bounduser3")

    rows = (await client.get(f"/contests/{window.id}/standings", headers=_auth(token))).json()[
        "standings"
    ]
    assert rows[0]["field_size"] == total


async def test_standings_never_disclose_another_players_rating(
    client: AsyncClient, db_session: AsyncSession
):
    """Elo is private. It must not appear in a cross-user schema in any form."""
    window = await _settled_window(db_session)
    await _fill(db_session, window, 3)
    token = await _register(client, "elo1@example.com", "elouser1")

    body = (await client.get(f"/contests/{window.id}/standings", headers=_auth(token))).json()
    for row in body["standings"]:
        assert "rating_before" not in row
        assert "rating_after" not in row
        assert not any("rating" in k for k in row), f"a rating field leaked: {sorted(row)}"


async def test_a_player_can_still_see_their_own_rating(
    client: AsyncClient, db_session: AsyncSession
):
    """The private endpoint is unaffected — this is about cross-user disclosure, not hiding a
    player's own number from themselves."""
    token = await _register(client, "elo2@example.com", "elouser2")
    me = (await client.get("/me", headers=_auth(token))).json()
    assert isinstance(me["rating"], int)
