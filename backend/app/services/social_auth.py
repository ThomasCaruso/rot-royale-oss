"""Turn a verified provider identity into a Rot Royale account.

`app/core/socialid.py` answers "is this token real?". This answers "whose account is it?", which is
where the interesting decisions live. Four cases, in the order they are checked:

  1. KNOWN IDENTITY   (provider, subject) already linked -> that account. Always first, so a
                      returning player lands on the same row regardless of anything below.
  2. GUEST UPGRADE    the caller is signed in as a guest -> attach the identity to THAT row.
                      Anonymous-first onboarding means the player already has a streak, coins and a
                      rating; creating a fresh account here would silently discard all of it, which
                      is the worst possible outcome of tapping a friendly button.
  3. EMAIL LINK       a verified provider email matches an existing account -> link, and RETIRE
                      that account's password. See below.
  4. NEW ACCOUNT      otherwise create one, with no password.

Why case 3 retires the password
-------------------------------
Registration has no email-verification step (`register_user` accepts any address), so a password on
an account proves only that somebody typed that address — not that they own it. Pre-registering a
stranger's address is free. If we linked their later Google sign-in to that row and left the
password working, we would have handed the squatter a live credential for the victim's account.

The provider's claim IS verified; ours never was. So the verified identity takes the account and the
unproven credential is dropped. The legitimate player keeps their progress and signs in with the
button; the squatter keeps nothing.

This is why `email_verified` is checked and not merely read. An unverified provider email would let
an attacker claim any address and link to any account — the same takeover with the roles swapped.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.socialid import SocialIdentity
from app.models import User, UserIdentity
from app.models.user import GUEST_STATUS
from app.services.registration import (
    EmailAlreadyExistsError,
    RegistrationError,
    UsernameAlreadyExistsError,
    register_user,
)

# Accounts whose provider never gave us a verified address get a non-routable placeholder rather
# than occupying the unique email slot of an address someone may genuinely own later. `.invalid` is
# reserved by RFC 2606 precisely so it can never resolve — nobody will ever receive mail here, and
# anyone reading the table can see that at a glance.
PLACEHOLDER_EMAIL_DOMAIN = "social.rotroyale.invalid"


@dataclass(frozen=True)
class SocialSignInResult:
    user: User
    #: True when this call created the account, so the caller can route a first-timer into
    #: onboarding rather than straight to the daily.
    created: bool
    #: True when an existing account's password was retired by the link in case 3. Surfaced so the
    #: client can tell the player their password no longer applies, rather than leaving them to
    #: discover it at the next login.
    password_retired: bool


async def _identity_row(session: AsyncSession, provider: str, subject: str) -> UserIdentity | None:
    return (
        await session.execute(
            select(UserIdentity).where(
                UserIdentity.provider == provider, UserIdentity.subject == subject
            )
        )
    ).scalar_one_or_none()


async def sign_in_with_identity(
    session: AsyncSession,
    identity: SocialIdentity,
    *,
    guest: User | None = None,
) -> SocialSignInResult:
    """Resolve a verified identity to an account. Never commits — the request boundary does."""

    # 1. Already linked.
    existing = await _identity_row(session, identity.provider, identity.subject)
    if existing is not None:
        user = (await session.execute(select(User).where(User.id == existing.user_id))).scalar_one()
        # Refresh the stored snapshot when the provider tells us something new. Apple only sends the
        # email on first authorization, so never overwrite a known address with nothing.
        if identity.email and existing.email != identity.email:
            existing.email = identity.email
        return SocialSignInResult(user=user, created=False, password_retired=False)

    # 2. A guest tapping the button is upgrading, not starting over.
    if guest is not None and guest.status == GUEST_STATUS:
        if identity.email_verified and identity.email:
            # Only adopt the address if it is free. A guest must not be able to seize an existing
            # account's email by signing in with a provider that happens to assert it.
            taken = (
                await session.execute(select(User.id).where(User.email == identity.email))
            ).scalar_one_or_none()
            if taken is None:
                guest.email = identity.email
        guest.status = "active"
        session.add(
            UserIdentity(
                user_id=guest.id,
                provider=identity.provider,
                subject=identity.subject,
                email=identity.email,
            )
        )
        await session.flush()
        return SocialSignInResult(user=guest, created=False, password_retired=False)

    # 3. Link to an existing account by VERIFIED email, retiring its unproven password.
    if identity.email_verified and identity.email:
        match = (
            await session.execute(select(User).where(User.email == identity.email))
        ).scalar_one_or_none()
        if match is not None:
            retired = match.password_hash is not None
            match.password_hash = None
            if match.status == GUEST_STATUS:
                match.status = "active"
            session.add(
                UserIdentity(
                    user_id=match.id,
                    provider=identity.provider,
                    subject=identity.subject,
                    email=identity.email,
                )
            )
            await session.flush()
            return SocialSignInResult(user=match, created=False, password_retired=retired)

    # 4. A new account, with no password at all.
    #
    # The email is stored ONLY when the provider verified it. An unverified address would occupy the
    # unique email slot for someone who may genuinely own it later, so those accounts get a
    # non-routable placeholder keyed to the provider subject instead — unique by construction, and
    # obviously not a real inbox to anyone reading the table.
    email = (
        identity.email
        if identity.email_verified and identity.email
        else f"{identity.provider}-{identity.subject}@{PLACEHOLDER_EMAIL_DOMAIN}"
    )

    # Goes through register_user so the account gets the SAME seeding as any other: profile,
    # starting rating and division, default theme, signup coin ledger entry. `password=None` is
    # the whole difference. The username is generated and retried on collision, exactly as
    # register_guest does — the player renames later.
    created_user: User | None = None
    for _ in range(8):
        try:
            created_user = await register_user(
                session, email, f"rot_{secrets.token_hex(3)}", password=None
            )
            break
        except UsernameAlreadyExistsError:
            continue
        except EmailAlreadyExistsError:
            # The address was taken between the checks above and here. Fall back to the
            # non-routable form so a race cannot fail a sign-in outright.
            email = f"{identity.provider}-{identity.subject}@{PLACEHOLDER_EMAIL_DOMAIN}"
            continue
    if created_user is None:
        raise RegistrationError("could not allocate an account for this identity")

    session.add(
        UserIdentity(
            user_id=created_user.id,
            provider=identity.provider,
            subject=identity.subject,
            email=identity.email,
        )
    )
    try:
        await session.flush()
    except IntegrityError:
        # Two first-time sign-ins for one subject raced; the unique constraint settled it. Re-read
        # rather than surfacing a 500 — the other request already made the account this one wanted.
        await session.rollback()
        won = await _identity_row(session, identity.provider, identity.subject)
        if won is None:
            raise
        winner = (await session.execute(select(User).where(User.id == won.user_id))).scalar_one()
        return SocialSignInResult(user=winner, created=False, password_retired=False)

    return SocialSignInResult(user=created_user, created=True, password_retired=False)
