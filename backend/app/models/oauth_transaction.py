"""One in-flight Sign-in-with-Google round trip, held server-side.

**This table is the source of truth for the OAuth handshake, deliberately.** The alternative —
packing nonce, guest identity and expiry into a signed `state` and trusting it on the way back — is
smaller, and it cannot do the one thing that matters most here: mark a `state` as SPENT. A signed
blob is replayable until it expires, because verifying it proves only that we minted it, never that
we have not already honoured it. A row can be consumed exactly once.

The row spans BOTH halves of the flow, and each half has its own single-use gate:

  1. `state` — minted at `/auth/google/start`, handed to Google, and presented back to us on the
     callback. Consumed there (`consumed_at`). A forged state finds no row; a replayed one finds a
     row that is already spent; an old one finds a row that has expired.
  2. `handoff_code` — minted at the END of a successful callback and put in the SPA's URL fragment.
     The browser trades it, once, for a real session. It exists so that no access token, refresh
     token or ID token ever travels in a URL. It is short-lived because it needs to survive exactly
     one redirect, and a code sitting in someone's browser history should be inert by the time
     anyone could read it.

`guest_user_id` is the reason a player does not lose their progress. It is resolved from a validated
bearer token at `/start` and written HERE, server-side — never accepted from the client on the way
back, where anyone could name any user id and have the sign-in attach to that account. On the
callback it is fed to `sign_in_with_identity` as the guest to upgrade in place, so the streak, coins
and rating earned before signing in carry onto the identity rather than being stranded.

**No secret, code or token is stored in this table.** The authorization code is exchanged
server-side, in the request that receives it, and never persisted; the ID token is verified and
discarded. What survives is the OUTCOME (`user_id`, and the two flags the client needs to render the
right thing), which is all the handoff has to return.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class OAuthTransaction(Base):
    __tablename__ = "oauth_transactions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)

    # Opaque, cryptographically random, and UNIQUE — the uniqueness is what makes "consume exactly
    # once" enforceable under concurrent callbacks rather than merely likely.
    state: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    # Echoed into the ID token by Google and checked by the existing verifier (core/socialid.py).
    # Stored rather than derived so the check compares against what we actually sent.
    nonce: Mapped[str] = mapped_column(String(128), nullable=False)

    # The guest whose progress this sign-in must adopt, resolved from a validated token at /start.
    # SET NULL rather than CASCADE: losing the guest row should not delete the audit of the attempt.
    guest_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # When `state` stops being acceptable. Generous enough for a human to pick an account and type a
    # password at Google, short enough that an abandoned attempt cannot be resurrected later.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Set the moment the callback accepts this state. Non-null means SPENT: a second callback
    # carrying the same state is a replay and is refused.
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- second half: handing the finished session to the SPA -----------------------------------
    handoff_code: Mapped[str | None] = mapped_column(
        String(128), nullable=True, unique=True, index=True
    )
    handoff_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    handoff_consumed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # The outcome, written once the identity is verified and the account resolved. Nullable because
    # a transaction that never completes never gets one.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # Whether this sign-in MADE the account, and whether linking retired an old password. Both are
    # things the client renders (a welcome vs a return, and the password notice), and neither can be
    # recomputed at handoff time — by then the account exists and looks identical either way.
    created_account: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    password_retired: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
