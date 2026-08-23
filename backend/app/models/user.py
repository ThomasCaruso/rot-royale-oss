"""User identity (docs/architecture.md)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

# Anonymous-first accounts (Brain Boost onboarding). A guest is a REAL user in every way; the flag
# gates only SAVED-profile privileges: ranked leaderboard permanence (standings/rating/streak/gems
# at settlement — services/settlement.py) requires status != GUEST_STATUS. Upgrading
# (services/registration.py::upgrade_guest) flips status to "active" on the same row.
GUEST_STATUS = "guest"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    # NULLABLE since third-party sign-in: an account created by "Continue with Apple/Google" has no
    # password of ours, because the provider does the authenticating and we never see a credential.
    #
    # It is also nulled DELIBERATELY when a verified provider identity links to an account that
    # already had one. Registration has no email-verification step, so a password proves only that
    # somebody typed an address — not that they own it. Without this, pre-registering a stranger's
    # address would leave a working password on the account they later sign into with Google, which
    # is an account takeover with extra steps. The verified claim wins; the unproven one is retired.
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'active'"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    profile: Mapped[Profile] = relationship(back_populates="user", uselist=False)


# Imported at end to avoid circular import at module load; resolved by mapper configuration.
from app.models.profile import Profile  # noqa: E402
