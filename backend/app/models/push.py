"""Push subscriptions (M9 web-push + iOS native APNs) + the fire-once notification ledgers.

`push_subscriptions` stores each device's transport: web-push carries an `endpoint` (+ p256dh/auth,
`platform='web'`); a native iOS/Android app carries a `device_token` (`platform='ios'|'android'`).
`window_notifications` gates the once-per-window 'open' push; `user_notifications` gates the
once-per-day per-user nudges (streak-at-risk, streak-saved) so the heartbeat never double-sends.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    # endpoint is unique for web rows; native rows have NULL endpoint (NULLs are distinct in PG) and
    # are deduped by the partial-unique index on device_token (created in the migration).
    __table_args__ = (UniqueConstraint("endpoint", name="uq_push_endpoint"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # "web" | "ios" | "android" — picks the delivery transport in the dispatcher.
    platform: Mapped[str] = mapped_column(String(16), nullable=False, server_default="web")
    # Web-push transport (null on native rows).
    endpoint: Mapped[str | None] = mapped_column(Text, nullable=True)
    p256dh: Mapped[str | None] = mapped_column(String(255), nullable=True)  # client public key
    auth: Mapped[str | None] = mapped_column(String(255), nullable=True)  # client auth secret
    # Native APNs/FCM transport (null on web rows).
    device_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    # True when this token was registered under iOS PROVISIONAL authorization: the player never saw
    # a prompt and delivery is quiet (Notification Center only). It makes them REACHABLE but is not
    # consent, so it must not suppress the in-app ask that upgrades them to prominent delivery —
    # see services/prompts.py, which counts only non-provisional rows.
    provisional: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class UserNotification(Base):
    """Exactly-once gate for per-user daily nudges: one row per (user, ET date, kind)."""

    __tablename__ = "user_notifications"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    notify_date: Mapped[date] = mapped_column(Date, primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class WindowNotification(Base):
    """One row per window that has been notified — the exactly-once 'open' push gate (M9)."""

    __tablename__ = "window_notifications"

    window_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("contest_windows.id", ondelete="CASCADE"), primary_key=True
    )
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
