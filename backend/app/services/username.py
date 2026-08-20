"""Changing the public handle — first change free, every one after costs coins.

The username is public identity: it appears on leaderboards, on share links, and it is how friends
add you. So a change is allowed but priced. The first is free because a player who was handed an
auto-generated guest handle (`rot_swift_fox`) or simply picked badly should not have to pay to fix
it; after that, coins (see `core/constants.USERNAME_CHANGE_COST`).

Coins are cosmetic-only (DESIGN §7) — this never touches rating, standings or anything competitive.

Money-path rules this follows, all inherited from the Vault purchase path:
  * The debit goes through `record_coin_delta`, never by writing `coins_balance` directly, so the
    append-only ledger stays the source of truth and the cached balance stays equal to its sum
    (PLAN §8). `record_coin_delta` locks the profile row FOR UPDATE, which serializes concurrent
    attempts.
  * Nothing commits here — the request boundary owns the transaction, so a uniqueness collision
    after the debit rolls the debit back with it. A player can never be charged for a name they
    did not get.
  * The counter is incremented in the same transaction as the debit, so "how many changes have
    been made" and "what was paid" cannot disagree.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import USERNAME_CHANGE_COST, USERNAME_FREE_CHANGES
from app.models import Profile
from app.services.ledger import record_coin_delta

# Same shape the rest of the app accepts. Length mirrors RegisterRequest (3..32) so a name that
# is legal at signup is legal here — one handle, one rule, whichever door it comes through.
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,32}$")

COIN_REASON = "username_change"


class UsernameError(Exception):
    """Base class for username-change problems."""


class InvalidUsernameError(UsernameError):
    """Fails the format/length rule."""


class UsernameTakenError(UsernameError):
    """Another account already holds it."""


class SameUsernameError(UsernameError):
    """The requested handle is the one already held — nothing to do, and never charge for it."""


class InsufficientCoinsError(UsernameError):
    """The change costs more coins than the player has."""


@dataclass
class UsernameQuote:
    """What a change would cost right now — so the UI can say the price before asking to confirm."""

    cost: int
    free_changes_remaining: int
    changes_made: int
    balance: int
    affordable: bool


@dataclass
class UsernameChangeResult:
    username: str
    cost: int
    balance: int
    changes_made: int


def cost_for(changes_made: int) -> int:
    """Price of the NEXT change given how many have already happened."""
    return 0 if changes_made < USERNAME_FREE_CHANGES else USERNAME_CHANGE_COST


async def quote_username_change(session: AsyncSession, user_id: uuid.UUID) -> UsernameQuote:
    """Read-only: what the next change costs and whether the player can afford it."""
    profile = await session.get(Profile, user_id)
    if profile is None:
        raise UsernameError("no profile")
    made = profile.username_changes
    cost = cost_for(made)
    return UsernameQuote(
        cost=cost,
        free_changes_remaining=max(0, USERNAME_FREE_CHANGES - made),
        changes_made=made,
        balance=profile.coins_balance,
        affordable=profile.coins_balance >= cost,
    )


async def change_username(
    session: AsyncSession, user_id: uuid.UUID, new_username: str
) -> UsernameChangeResult:
    """Change the handle, charging coins when the free change is spent. Does not commit."""
    new_username = new_username.strip()
    if not USERNAME_RE.match(new_username):
        raise InvalidUsernameError(new_username)

    profile = await session.get(Profile, user_id)
    if profile is None:
        raise UsernameError("no profile")

    # Case-insensitive: re-submitting the same name in different case is not a change worth
    # charging for, and treating it as one would let a player burn 300 coins on a no-op.
    if profile.username.casefold() == new_username.casefold():
        raise SameUsernameError(new_username)

    taken = await session.scalar(
        select(Profile.user_id).where(Profile.username == new_username, Profile.user_id != user_id)
    )
    if taken is not None:
        raise UsernameTakenError(new_username)

    cost = cost_for(profile.username_changes)
    if cost and profile.coins_balance < cost:
        raise InsufficientCoinsError(f"needs {cost}, has {profile.coins_balance}")

    try:
        # SAVEPOINT so a concurrent claim of the same handle (the check above is TOCTOU) rolls back
        # the debit AND the rename together, rather than poisoning the outer transaction.
        async with session.begin_nested():
            if cost:
                await record_coin_delta(
                    session,
                    user_id,
                    -cost,
                    COIN_REASON,
                    ref_type="username",
                    ref_key=new_username,
                )
            profile.username = new_username
            profile.username_changes += 1
            await session.flush()  # username unique index enforced here
    except IntegrityError as exc:
        raise UsernameTakenError(new_username) from exc

    return UsernameChangeResult(
        username=profile.username,
        cost=cost,
        balance=profile.coins_balance,
        changes_made=profile.username_changes,
    )


__all__ = [
    "USERNAME_RE",
    "InsufficientCoinsError",
    "InvalidUsernameError",
    "SameUsernameError",
    "UsernameChangeResult",
    "UsernameError",
    "UsernameQuote",
    "UsernameTakenError",
    "change_username",
    "cost_for",
    "quote_username_change",
]
