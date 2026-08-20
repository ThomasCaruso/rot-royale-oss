"""Funnel analytics schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

FunnelEventName = Literal[
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
    # /download acquisition funnel — see app.models.analytics.FUNNEL_EVENTS (kept in sync).
    "download_page_view",
    "download_cta_tap",
    "download_meta_escape_attempt",
    "download_meta_escape_signal",
    "download_fallback_shown",
    "download_retry_tap",
    "download_link_copied",
    "download_play_now_tap",
]


class FunnelEventIn(BaseModel):
    event: FunnelEventName
    source: str | None = Field(default=None, max_length=24)


class FunnelAck(BaseModel):
    recorded: bool
