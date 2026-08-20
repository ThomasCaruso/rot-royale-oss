"""Funnel analytics: append-only onboarding-conversion events (docs/analytics-funnel.md).

Product events only (intro viewed → check started → reveal → profile saved → ranked gate) — never
gameplay-authoritative data. Rows are tiny and write-once; user_id is nullable because the top of
the funnel happens BEFORE any account exists (SET NULL keeps history if an account is deleted).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# Server-side allowlist — the funnel stays queryable because names can't drift per-client.
FUNNEL_EVENTS: tuple[str, ...] = (
    "intro_viewed",
    "start_check_clicked",
    "guest_created",
    "starter_check_completed",
    "profile_reveal_viewed",
    "save_profile_clicked",
    "upgrade_completed",
    "keep_playing_clicked",
    "ranked_save_gate_viewed",
    "ranked_save_completed",
    # Acquisition funnel for the public /download page (the canonical external link used in
    # Instagram/Facebook/TikTok bios). Anonymous by nature — user_id is almost always NULL — and
    # `source` carries only the coarse in-app-browser bucket, never a user agent.
    "download_page_view",
    "download_cta_tap",
    "download_meta_escape_attempt",
    "download_meta_escape_signal",
    "download_fallback_shown",
    "download_retry_tap",
    "download_link_copied",
    # Meta WebViews block the App Store outright, so /download offers browser play instead.
    "download_play_now_tap",
)


class FunnelEvent(Base):
    __tablename__ = "funnel_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    event: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    # Where the event fired from (e.g. "reveal" | "home_banner" | "ranked_gate") — optional.
    source: Mapped[str | None] = mapped_column(String(24), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
