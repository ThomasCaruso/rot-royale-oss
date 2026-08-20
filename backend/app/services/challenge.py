"""Challenge snapshots — the viral share loop (see models/challenge.Challenge).

A `Challenge` is a public, spoiler-free SNAPSHOT of one finished Daily-Royale entry, addressed by a
short base62 id used in the share link `…/c/<id>`. It carries only display metadata (the sharer's
handle, score, and a provisional place/field at share time) — NEVER questions or answers — so an
anonymous visitor can see "beat my 742" and jump straight into today's Daily Royale.

Anti-cheat: this service reads the entry's score/place only; it never touches RoundAnswer, so no
answer can leak through a challenge. Pure-ish: takes an AsyncSession and never commits — callers do.
"""

from __future__ import annotations

import secrets
import string
import uuid
from datetime import UTC, date, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import DAILY_ROYALE_EPOCH, DEFAULT_THEME_ID
from app.core.timezone import ET
from app.models import Challenge, ContestWindow, Entry, Profile
from app.models.contest import OPEN, SUBMITTED
from app.models.user import User

_BASE62 = string.ascii_letters + string.digits


class ChallengeError(Exception):
    """Base class for challenge-creation problems."""


class ChallengeEntryNotFound(ChallengeError):
    """The referenced entry does not exist."""


class ChallengeNotYours(ChallengeError):
    """The entry belongs to another user."""


class ChallengeEntryNotPlayable(ChallengeError):
    """The entry is practice / window-less / unfinished — not a shareable Daily-Royale result."""


def contest_no_for_date(d: date) -> int:
    """Human-facing Daily-Royale number ("#N") for an ET contest date. #1 on the launch epoch."""
    return max(1, (d - DAILY_ROYALE_EPOCH).days + 1)


def _new_id(length: int = 8) -> str:
    """Short, URL-safe, unguessable base62 id for a share link."""
    return "".join(secrets.choice(_BASE62) for _ in range(length))


def percentile(place: int | None, field_size: int | None) -> int | None:
    """ "Top X%" bracket for a provisional place within the real field — SMALLER is better, so it
    reads correctly as a "Top {pct}%" label. Clamped 1..99; None if unknown.

    round(place / field_size * 100): 1st of 100 → 1 (top 1%); 1st of 8 → 13 (top 13%); last → 99.
    """
    if place is None or field_size is None or field_size <= 0:
        return None
    pct = round(place / field_size * 100)
    return max(1, min(99, pct))


async def get_challenge(
    session: AsyncSession, challenge_id: str, *, now: datetime | None = None
) -> Challenge | None:
    """The share snapshot, or None if it does not exist OR its day is over.

    A share page is PUBLIC — anyone holding the link can read the sharer's username, score and
    placement without logging in. That exposure is justified only while the link still does its job:
    "beat my score today". Once the window closes nobody can enter that contest any more, so the
    page has no remaining purpose and keeps publishing personal data indefinitely to anyone who ever
    saw the URL (links get forwarded, pasted into group chats, and indexed).

    So the link stops resolving when its window closes. Expiry is computed from the window rather
    than stored on the row, which means it cannot drift from the contest it belongs to, and it
    applies retroactively to links shared before this rule existed.

    Callers treat None as "no such link" — an expired link is deliberately indistinguishable from a
    nonexistent one, so the endpoint does not confirm that a given id ever existed.
    """
    challenge = await session.get(Challenge, challenge_id)
    if challenge is None:
        return None
    window = await session.get(ContestWindow, challenge.window_id)
    if window is None:
        return None
    if (now or datetime.now(UTC)) >= window.close_at:
        return None
    return challenge


async def create_challenge(
    session: AsyncSession,
    *,
    creator: User,
    entry_id: uuid.UUID,
    now: datetime | None = None,
) -> Challenge:
    """Create (or return the existing) share snapshot for one of the creator's finished DR entries.

    Idempotent per entry: re-sharing the same result returns the same Challenge unchanged.
    """
    now = now or datetime.now(UTC)

    entry = await session.get(Entry, entry_id)
    if entry is None:
        raise ChallengeEntryNotFound()
    if entry.user_id != creator.id:
        raise ChallengeNotYours()
    # A real, finished Daily-Royale entry only: window-bound, non-practice, and played to a score.
    if entry.window_id is None or entry.is_practice or entry.total_score is None:
        raise ChallengeEntryNotPlayable()

    # Idempotent: one shareable link per entry (uq_challenge_entry also backs this at the DB level).
    existing = await session.scalar(select(Challenge).where(Challenge.entry_id == entry_id))
    if existing is not None:
        return existing

    window = await session.get(ContestWindow, entry.window_id)
    if window is None:  # FK guarantees this, but keep the type-checker + runtime honest
        raise ChallengeEntryNotPlayable()
    contest_no = contest_no_for_date(window.contest_date)

    profile = await session.get(Profile, creator.id)
    username = profile.username if profile is not None else "player"

    score = int(entry.total_score)
    # Provisional "where you'd rank right now" among SUBMITTED, non-practice entries in this window.
    ahead = await session.scalar(
        select(func.count())
        .select_from(Entry)
        .where(
            Entry.window_id == entry.window_id,
            Entry.is_practice.is_(False),
            Entry.status == SUBMITTED,
            Entry.total_score > score,
        )
    )
    submitted = await session.scalar(
        select(func.count())
        .select_from(Entry)
        .where(
            Entry.window_id == entry.window_id,
            Entry.is_practice.is_(False),
            Entry.status == SUBMITTED,
        )
    )
    place = 1 + int(ahead or 0)
    # REAL submitted entries only — no padding. A shared "Top 13% of 8" where most of the 8 were
    # synthetic is a fabricated brag, and the share page is the most public surface in the app.
    field_size = int(submitted or 0)

    for _ in range(6):  # retry the tiny base62 collision chance
        challenge = Challenge(
            id=_new_id(),
            entry_id=entry_id,
            creator_user_id=creator.id,
            window_id=entry.window_id,
            contest_date=window.contest_date,
            contest_no=contest_no,
            username=username,
            score=score,
            place=place,
            field_size=field_size,
        )
        session.add(challenge)
        try:
            async with session.begin_nested():
                await session.flush()
            return challenge
        except Exception:  # id collision (PK) — drop this object and retry with a fresh id
            session.expunge(challenge)
    raise ChallengeError("could not allocate a challenge id")


async def today_royale_playable(session: AsyncSession, now: datetime | None = None) -> str | None:
    """The window id (str) of TODAY's OPEN Daily Royale a visitor could play right now, else None.

    Read-only: it does NOT provision or transition windows (that's the scheduler daemon / the authed
    /contests/current path). A landing page uses this to offer immediate "play today's Royale".
    """
    now = now or datetime.now(UTC)
    today_et = now.astimezone(ET).date()
    window_id = await session.scalar(
        select(ContestWindow.id).where(
            ContestWindow.contest_date == today_et,
            ContestWindow.slot == "royale",
            ContestWindow.state == OPEN,
        )
    )
    return str(window_id) if window_id is not None else None


async def creator_theme(session: AsyncSession, challenge: Challenge) -> str:
    """The sharer's CURRENTLY equipped theme id — what the share card paints itself in.

    Read live from the profile rather than snapshotted onto the challenge row, because the ask is
    "the theme the sender has equipped", not "had equipped when they shared". Re-equipping a skin
    restyles every link they've already sent, which is the behaviour a player expects from a
    cosmetic. Purely decorative: it never gates play, and a missing profile just yields the default.
    """
    theme = await session.scalar(
        select(Profile.equipped_theme).where(Profile.user_id == challenge.creator_user_id)
    )
    return theme or DEFAULT_THEME_ID


async def purge_expired_challenges(session: AsyncSession, *, now: datetime | None = None) -> int:
    """Delete share snapshots whose window has closed. Returns the number removed.

    `get_challenge` already refuses to serve these, so this is not what protects the data — it is
    data minimisation. A snapshot holds a username, score and placement; once the link can never
    resolve again there is no reason to keep that row, and keeping it only widens what a future
    database compromise would expose. Deleting also makes the retention promise in the privacy
    policy true in the database, not just at the API boundary.

    Idempotent and safe to run on the ordinary heartbeat: a second run finds nothing.
    """
    cutoff = now or datetime.now(UTC)
    expired = (
        (
            await session.execute(
                select(Challenge.id)
                .join(ContestWindow, ContestWindow.id == Challenge.window_id)
                .where(ContestWindow.close_at <= cutoff)
            )
        )
        .scalars()
        .all()
    )
    if not expired:
        return 0
    await session.execute(delete(Challenge).where(Challenge.id.in_(expired)))
    return len(expired)
