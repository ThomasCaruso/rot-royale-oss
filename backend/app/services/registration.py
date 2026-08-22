"""Registration service (docs/architecture.md, M1).

Seeds a new account atomically: user (argon2 hash) + profile (rating/division/streak/sharpness/
coins/equipped theme) + ownership of the free default theme. Any starting coins flow through the
coin ledger so coins_balance always equals SUM(ledger.delta). Does not commit — the request
boundary does.

Anonymous-first (Brain Boost onboarding): a GUEST is a real, fully-seeded user — placeholder email
on a reserved domain, auto-generated username, an unusable random password, status="guest". Every
existing endpoint works for guests, so "merging anonymous progress at signup" is a non-event:
upgrade_guest() attaches the real email/password to the SAME user row and flips status to active.
Guest continuity across app restarts rides the ordinary persisted refresh token.
"""

from __future__ import annotations

import secrets

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.core.constants import (
    DEFAULT_AVATAR_PRESET,
    DEFAULT_THEME_ID,
    STARTING_COINS,
    STARTING_RATING,
)
from app.core.security import hash_password
from app.models import Profile, User, UserTheme
from app.models.user import GUEST_STATUS
from app.services.ledger import record_coin_delta
from app.services.rating import division_for_rating


class RegistrationError(Exception):
    """Base class for registration conflicts."""


class EmailAlreadyExistsError(RegistrationError):
    pass


class UsernameAlreadyExistsError(RegistrationError):
    pass


class NotAGuestError(RegistrationError):
    """Upgrade requested for an account that already has a saved email/password."""


# Reserved-by-RFC-2606 TLD — can never collide with a deliverable address a player might register.
_GUEST_EMAIL_DOMAIN = "guest.invalid"


async def _exists(session: AsyncSession, column: InstrumentedAttribute[str], value: str) -> bool:
    return (await session.execute(select(func.count()).where(column == value))).scalar_one() > 0


# Unique indexes (see the M1 migration) used to map a constraint violation back to the right field.
_EMAIL_INDEX = "ix_users_email"
_USERNAME_INDEX = "ix_profiles_username"


def _violated_index(exc: IntegrityError) -> str:
    """Best-effort: which unique index a violation hit. The Postgres message reliably names it
    (e.g. '… unique constraint "ix_users_email"'); asyncpg also exposes constraint_name."""
    name = getattr(getattr(exc, "orig", None), "constraint_name", None)
    if name:
        return str(name)
    text = str(getattr(exc, "orig", exc))
    if _USERNAME_INDEX in text:
        return _USERNAME_INDEX
    if _EMAIL_INDEX in text:
        return _EMAIL_INDEX
    return ""


async def register_user(session: AsyncSession, email: str, username: str, password: str) -> User:
    email = email.strip().lower()
    username = username.strip()

    # Fast path: a clean 409 for the common (sequential) duplicate without touching the DB writes.
    if await _exists(session, User.email, email):
        raise EmailAlreadyExistsError(email)
    if await _exists(session, Profile.username, username):
        raise UsernameAlreadyExistsError(username)

    user = User(email=email, password_hash=hash_password(password))
    try:
        # SAVEPOINT so a concurrent-signup collision (the pre-check is TOCTOU) rolls back just these
        # inserts and surfaces as a clean 409 — without poisoning the request's outer transaction.
        async with session.begin_nested():
            session.add(user)
            await session.flush()  # assign user.id; email unique index enforced here

            session.add(
                Profile(
                    user_id=user.id,
                    username=username,
                    rating=STARTING_RATING,
                    division=division_for_rating(STARTING_RATING),
                    streak_count=0,
                    sharpness=0,
                    coins_balance=0,  # all coins (incl. any signup bonus) flow through the ledger
                    equipped_theme=DEFAULT_THEME_ID,
                    avatar_preset=DEFAULT_AVATAR_PRESET,
                )
            )
            session.add(UserTheme(user_id=user.id, theme_id=DEFAULT_THEME_ID))
            await session.flush()  # username unique index enforced here

            if STARTING_COINS:
                await record_coin_delta(session, user.id, STARTING_COINS, "signup_bonus")
    except IntegrityError as exc:
        index = _violated_index(exc)
        if index == _EMAIL_INDEX:
            raise EmailAlreadyExistsError(email) from exc
        if index == _USERNAME_INDEX:
            raise UsernameAlreadyExistsError(username) from exc
        raise

    return user


async def register_guest(session: AsyncSession) -> User:
    """Create a fully-seeded anonymous account (same seed flow as register_user).

    The password is a discarded random secret (a guest can't log in with credentials — their
    session lives in the issued token pair), and the username is auto-generated; the player can
    keep playing under it or save the profile later via upgrade_guest.
    """
    for _ in range(8):  # hex collisions are vanishingly rare; retry rather than 500
        email = f"guest-{secrets.token_hex(12)}@{_GUEST_EMAIL_DOMAIN}"
        username = f"rot_{secrets.token_hex(3)}"
        try:
            user = await register_user(session, email, username, secrets.token_urlsafe(32))
        except (EmailAlreadyExistsError, UsernameAlreadyExistsError):
            continue
        user.status = GUEST_STATUS
        await session.flush()
        return user
    raise RegistrationError("could not allocate a guest identity")


async def upgrade_guest(
    session: AsyncSession,
    user: User,
    email: str,
    password: str,
    username: str | None = None,
) -> User:
    """Attach a real email, username and password to a guest account ("save your profile").

    Same user row → every bit of progress (entries, sharpness, coins, taste profile, cosmetics)
    is retained with zero data migration. Only guests can upgrade; the email must be unused.

    `username` is optional at this layer so existing callers keep working: omitting it KEEPS the
    auto-generated guest handle. When supplied it is validated exactly like a fresh registration —
    same uniqueness rule, same index, same 409 — because a handle claimed here and a handle claimed
    at signup are the same thing and must not be able to diverge.

    Both the email and the username are checked up front for a clean 409 on the common sequential
    case, then re-checked by the unique indexes inside a SAVEPOINT so a concurrent claim of either
    one surfaces as a 409 rather than poisoning the request's transaction.
    """
    if user.status != GUEST_STATUS:
        raise NotAGuestError()
    email = email.strip().lower()
    if await _exists(session, User.email, email):
        raise EmailAlreadyExistsError(email)

    profile: Profile | None = None
    if username is not None:
        username = username.strip()
        profile = await session.get(Profile, user.id)
        # Re-claiming the handle the guest already holds is a no-op, not a conflict — otherwise
        # accepting the pre-filled name in the form would fail against the player's own row.
        if profile is None or profile.username != username:
            if await _exists(session, Profile.username, username):
                raise UsernameAlreadyExistsError(username)

    try:
        async with session.begin_nested():  # concurrent-signup TOCTOU → clean 409, not a 500
            user.email = email
            user.password_hash = hash_password(password)
            user.status = "active"
            if username is not None and profile is not None:
                profile.username = username
            await session.flush()
    except IntegrityError as exc:
        index = _violated_index(exc)
        if index == _EMAIL_INDEX:
            raise EmailAlreadyExistsError(email) from exc
        if index == _USERNAME_INDEX and username is not None:
            raise UsernameAlreadyExistsError(username) from exc
        raise
    return user
