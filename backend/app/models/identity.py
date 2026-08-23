"""Third-party sign-in identities (Sign in with Apple / Google).

One row per (provider, subject) the player has proven control of. `subject` is the provider's
immutable user id — NOT the email, which the player can change at Apple or Google without telling
us, and which Apple's Hide My Email deliberately obscures. Keying on the subject means an account
survives an email change; keying on email would silently orphan it.

A user may hold several identities (Apple and Google both), and an identity belongs to exactly one
user. The unique constraint is on (provider, subject), so the same subject cannot be attached to two
accounts, and the same subject signing in twice always lands on the same row.

`email` here is what the provider asserted at the time, kept for support and for the link-by-email
path. It is a snapshot, never the key.

**No credential is stored.** We never see the player's Apple or Google password; the provider
authenticates them and hands us a signed assertion. That is the whole security benefit, and it is
why `users.password_hash` is nullable — an account that only ever signed in this way has no password
of ours to store, and nothing for an attacker to steal from us.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# The providers we accept assertions from. Adding one is a deliberate edit here plus an audience in
# settings — an unknown provider string must never reach the verifier.
PROVIDER_APPLE = "apple"
PROVIDER_GOOGLE = "google"
SOCIAL_PROVIDERS = frozenset({PROVIDER_APPLE, PROVIDER_GOOGLE})


class UserIdentity(Base):
    __tablename__ = "user_identities"
    __table_args__ = (
        # The identity of the row. Two accounts claiming one provider subject is the thing that
        # must be impossible, so it is a database constraint rather than a service-layer check:
        # concurrent first-time sign-ins race, and only the DB can settle that.
        UniqueConstraint("provider", "subject", name="uq_user_identities_provider_subject"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    # What the provider asserted at link time. Apple sends it on the FIRST authorization only, so
    # this can legitimately be null for later Apple rows.
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
