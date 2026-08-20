"""Friends graph service (the social layer — PLAN.md §13, now in scope).

A player friends another by USERNAME. The request walks pending → accepted (or declined). The graph
is symmetric once accepted, so membership checks both (requester, addressee) orderings. All
look-ups go through Profile.username (the public handle); the User row carries only email.

Pure DB orchestration, never commits (the request/WS boundary commits) — same convention as the
rest of app/services.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FriendDuel, Friendship, Profile


# ---------------- errors ----------------
class FriendsError(Exception):
    """Base for friend-graph failures."""


class UserNotFoundError(FriendsError):
    """No user with that username."""


class CannotFriendSelfError(FriendsError):
    """A player cannot friend themselves."""


class AlreadyFriendsError(FriendsError):
    """The two users are already friends."""


class RequestExistsError(FriendsError):
    """A pending request already exists in this direction."""


class FriendRequestNotFoundError(FriendsError):
    """No such incoming pending request for this user."""


# ---------------- dataclasses ----------------
@dataclass
class FriendSummary:
    user_id: uuid.UUID
    username: str
    avatar_preset: str
    wins: int  # your completed-duel wins against this friend (head-to-head score)
    losses: int  # your completed-duel losses against this friend
    streak: int = 0  # +N = won last N straight; -N = lost last N; 0 = none
    last_result: str | None = None  # "won" | "lost" | None
    last_played: datetime | None = None
    duels_14d: int = 0
    # Worn cosmetics travel with the identity wherever it is shown (same rule as the friends board
    # in schemas/contest.py): a frame is earned merchandise, so a friend wears theirs in your list
    # exactly as they do on the leaderboard.
    equipped_frame: str | None = None
    equipped_title: str | None = None


@dataclass
class FriendRequestSummary:
    request_id: uuid.UUID
    user_id: uuid.UUID
    username: str
    avatar_preset: str
    created_at: datetime


@dataclass
class FriendsList:
    friends: list[FriendSummary]
    incoming: list[FriendRequestSummary]  # requests others sent ME (I can accept/decline)
    outgoing: list[FriendRequestSummary]  # requests I sent (awaiting their response)
    rival_user_id: uuid.UUID | None = None


# ---------------- helpers ----------------
async def _profile_by_username(session: AsyncSession, username: str) -> Profile | None:
    """Case-insensitive username lookup (usernames are unique; the handle is public identity)."""
    return (
        await session.execute(select(Profile).where(Profile.username.ilike(username.strip())))
    ).scalar_one_or_none()


async def _profiles_by_ids(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, Profile]:
    if not ids:
        return {}
    rows = (await session.execute(select(Profile).where(Profile.user_id.in_(ids)))).scalars()
    return {p.user_id: p for p in rows}


async def _edge(session: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> Friendship | None:
    """The friendship row between a and b in EITHER direction (or None)."""
    return (
        await session.execute(
            select(Friendship).where(
                or_(
                    and_(Friendship.requester_id == a, Friendship.addressee_id == b),
                    and_(Friendship.requester_id == b, Friendship.addressee_id == a),
                )
            )
        )
    ).scalar_one_or_none()


async def are_friends(session: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    """True iff a and b have an ACCEPTED friendship (in either direction)."""
    edge = await _edge(session, a, b)
    return edge is not None and edge.status == "accepted"


@dataclass
class RivalryStat:
    wins: int
    losses: int
    streak: int
    last_result: str | None
    last_played: datetime | None
    duels_14d: int


async def _rivalry_stats(session: AsyncSession, user_id: uuid.UUID) -> dict[uuid.UUID, RivalryStat]:
    """Per-opponent rivalry stats from this user's COMPLETED friend duels (oldest→newest)."""
    rows = (
        (
            await session.execute(
                select(FriendDuel)
                .where(
                    FriendDuel.status == "completed",
                    FriendDuel.completed_at.is_not(None),
                    or_(FriendDuel.challenger_id == user_id, FriendDuel.opponent_id == user_id),
                )
                .order_by(FriendDuel.completed_at)
            )
        )
        .scalars()
        .all()
    )
    cutoff = datetime.now(UTC) - timedelta(days=14)
    hist: dict[uuid.UUID, list[tuple[bool, datetime]]] = {}
    for d in rows:
        my_side = "challenger" if d.challenger_id == user_id else "opponent"
        other = d.opponent_id if my_side == "challenger" else d.challenger_id
        # completed_at is guaranteed non-null by the query filter (status completed + is_not(None)).
        assert d.completed_at is not None
        hist.setdefault(other, []).append((d.winner_side == my_side, d.completed_at))

    stats: dict[uuid.UUID, RivalryStat] = {}
    for opp, h in hist.items():
        wins = sum(1 for won, _ in h if won)
        last_won = h[-1][0]
        streak = 0
        for won, _ in reversed(h):
            if won == last_won:
                streak += 1
            else:
                break
        stats[opp] = RivalryStat(
            wins=wins,
            losses=len(h) - wins,
            streak=streak if last_won else -streak,
            last_result="won" if last_won else "lost",
            last_played=h[-1][1],
            duels_14d=sum(1 for _, ts in h if ts >= cutoff),
        )
    return stats


async def _head_to_head(
    session: AsyncSession, user_id: uuid.UUID
) -> dict[uuid.UUID, tuple[int, int]]:
    """Per-opponent (wins, losses) from this user's COMPLETED friend duels — the head-to-head score
    shown next to each friend. Only completed duels count (declined/cancelled/expired have no
    winner)."""
    rows = (
        (
            await session.execute(
                select(FriendDuel).where(
                    FriendDuel.status == "completed",
                    or_(
                        FriendDuel.challenger_id == user_id,
                        FriendDuel.opponent_id == user_id,
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    record: dict[uuid.UUID, tuple[int, int]] = {}
    for d in rows:
        my_side = "challenger" if d.challenger_id == user_id else "opponent"
        other = d.opponent_id if my_side == "challenger" else d.challenger_id
        wins, losses = record.get(other, (0, 0))
        if d.winner_side == my_side:
            wins += 1
        else:
            losses += 1
        record[other] = (wins, losses)
    return record


# ---------------- operations ----------------
async def send_friend_request(
    session: AsyncSession, requester_id: uuid.UUID, username: str
) -> Friendship:
    """Send (or auto-accept) a friend request to the user with `username`.

    If the addressee has ALREADY sent the requester a pending request, this accepts it instead of
    creating a duplicate (so "you both added each other" resolves to friends, not a deadlock).
    """
    target = await _profile_by_username(session, username)
    if target is None:
        raise UserNotFoundError(username)
    if target.user_id == requester_id:
        raise CannotFriendSelfError()

    existing = await _edge(session, requester_id, target.user_id)
    if existing is not None:
        if existing.status == "accepted":
            raise AlreadyFriendsError()
        if existing.status == "pending":
            if existing.addressee_id == requester_id:
                # They already invited me → accept their pending request.
                existing.status = "accepted"
                existing.responded_at = datetime.now(UTC)
                await session.flush()
                return existing
            raise RequestExistsError()
        # A previously declined edge → reopen it as a fresh pending request from me.
        existing.requester_id = requester_id
        existing.addressee_id = target.user_id
        existing.status = "pending"
        existing.responded_at = None
        existing.created_at = datetime.now(UTC)
        await session.flush()
        return existing

    friendship = Friendship(
        requester_id=requester_id, addressee_id=target.user_id, status="pending"
    )
    session.add(friendship)
    await session.flush()
    return friendship


async def respond_friend_request(
    session: AsyncSession, user_id: uuid.UUID, request_id: uuid.UUID, accept: bool
) -> Friendship:
    """Accept or decline an incoming pending request addressed to `user_id`."""
    friendship = await session.get(Friendship, request_id)
    if friendship is None or friendship.addressee_id != user_id or friendship.status != "pending":
        raise FriendRequestNotFoundError()
    friendship.status = "accepted" if accept else "declined"
    friendship.responded_at = datetime.now(UTC)
    await session.flush()
    return friendship


async def cancel_or_remove(
    session: AsyncSession, user_id: uuid.UUID, other_user_id: uuid.UUID
) -> bool:
    """Remove a friend, cancel an outgoing pending request, or decline an incoming one — whatever
    edge exists between the two users. Returns True if an edge was removed."""
    edge = await _edge(session, user_id, other_user_id)
    if edge is None:
        return False
    await session.delete(edge)
    await session.flush()
    return True


async def list_friends(session: AsyncSession, user_id: uuid.UUID) -> FriendsList:
    """The full friend surface for one user: accepted friends + incoming/outgoing pending requests,
    each hydrated with the other user's public username + avatar."""
    edges = (
        (
            await session.execute(
                select(Friendship).where(
                    or_(
                        Friendship.requester_id == user_id,
                        Friendship.addressee_id == user_id,
                    ),
                    Friendship.status.in_(("pending", "accepted")),
                )
            )
        )
        .scalars()
        .all()
    )

    other_ids: list[uuid.UUID] = []
    for e in edges:
        other_ids.append(e.addressee_id if e.requester_id == user_id else e.requester_id)
    profiles = await _profiles_by_ids(session, other_ids)
    stats = await _rivalry_stats(session, user_id)

    friends: list[FriendSummary] = []
    incoming: list[FriendRequestSummary] = []
    outgoing: list[FriendRequestSummary] = []
    for e in edges:
        other_id = e.addressee_id if e.requester_id == user_id else e.requester_id
        prof = profiles.get(other_id)
        if prof is None:
            continue
        if e.status == "accepted":
            s = stats.get(other_id)
            friends.append(
                FriendSummary(
                    other_id,
                    prof.username,
                    prof.avatar_preset,
                    wins=s.wins if s else 0,
                    losses=s.losses if s else 0,
                    streak=s.streak if s else 0,
                    last_result=s.last_result if s else None,
                    last_played=s.last_played if s else None,
                    duels_14d=s.duels_14d if s else 0,
                    equipped_frame=prof.equipped_frame,
                    equipped_title=prof.equipped_title,
                )
            )
        elif e.requester_id == user_id:
            outgoing.append(
                FriendRequestSummary(
                    e.id, other_id, prof.username, prof.avatar_preset, e.created_at
                )
            )
        else:
            incoming.append(
                FriendRequestSummary(
                    e.id, other_id, prof.username, prof.avatar_preset, e.created_at
                )
            )

    friends.sort(key=lambda f: f.username.lower())
    incoming.sort(key=lambda r: r.created_at, reverse=True)
    outgoing.sort(key=lambda r: r.created_at, reverse=True)

    accepted_ids = {f.user_id for f in friends}
    candidates = [
        (oid, s) for oid, s in stats.items() if oid in accepted_ids and (s.wins + s.losses) > 0
    ]
    rival_user_id = (
        max(
            candidates,
            key=lambda kv: (kv[1].duels_14d, kv[1].last_played or datetime.min.replace(tzinfo=UTC)),
        )[0]
        if candidates
        else None
    )
    return FriendsList(
        friends=friends, incoming=incoming, outgoing=outgoing, rival_user_id=rival_user_id
    )
