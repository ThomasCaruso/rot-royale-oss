"""Eastern-Time / DST-correct window helpers (docs/architecture.md).

CRITICAL: contest windows are defined in America/New_York wall-clock time. ET shifts between
-05:00 (EST) and -04:00 (EDT) across the year, so a hardcoded UTC offset silently moves every
window by an hour for ~8 months. Always compute via zoneinfo, then convert to UTC for storage.

This module is a thin, well-tested foundation. The contest scheduler (M2) builds on it; M0 only
needs it to exist and be importable.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")

# Window open/close wall-clock times in ET. A `True` close_is_next_day flag means the close time is
# read on the *next* calendar day (so a 00:00 close is midnight at the end of the contest date).
# (slot) -> (open_time, close_time, close_is_next_day)
#
# This is the FULL computation map: it carries the legacy morning/midday/night slots so that
# window_bounds_utc still computes the correct UTC instants for old data, history, admin/debug, and
# legacy tests — and the new Daily Royale ("royale") slot. Only the legacy slots are computed for
# display/parsing; only `royale` is PROVISIONED going forward (see PROVISIONED_SLOTS).
WINDOW_SLOTS: dict[str, tuple[time, time, bool]] = {
    "morning": (time(5, 0), time(11, 0), False),
    "midday": (time(11, 0), time(16, 0), False),
    "night": (time(16, 0), time(0, 0), True),
    # Daily Royale: opens 12:00 AM ET (midnight), closes 12:00 AM ET the next day — a full 24-hour
    # window (no time limit; open all day). settle_at = close + 15min = 12:15 AM ET the next day.
    # On a DST-change date the window is 23h (spring forward) or 25h (fall back) of wall-clock day.
    "royale": (time(0, 0), time(0, 0), True),
}

# Slots actually CREATED going forward — exactly one Daily Royale per ET date. The legacy
# morning/midday/night slots remain in WINDOW_SLOTS for computation/display only; they are never
# provisioned anymore (see app.services.scheduler.create_windows_for_date).
PROVISIONED_SLOTS: tuple[str, ...] = ("royale",)


def et_wall_to_utc(d: date, t: time) -> datetime:
    """Interpret (date, time) as America/New_York wall-clock and return the UTC instant."""
    return datetime.combine(d, t, tzinfo=ET).astimezone(UTC)


def window_bounds_utc(contest_date: date, slot: str) -> tuple[datetime, datetime]:
    """Return (open_at, close_at) as UTC datetimes for a slot on a given ET calendar date.

    Computed from the ET wall-clock definition so DST is handled correctly.
    """
    open_t, close_t, close_next_day = WINDOW_SLOTS[slot]
    open_at = et_wall_to_utc(contest_date, open_t)
    close_date = contest_date + timedelta(days=1) if close_next_day else contest_date
    close_at = et_wall_to_utc(close_date, close_t)
    return open_at, close_at
