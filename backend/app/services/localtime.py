"""Per-player local time — the basis for scheduling a notification in THEIR evening.

Until now every send was anchored to ET, which is right for the contest (the window genuinely opens
and closes on ET wall-clock) and wrong for a reminder. 8 PM ET is 5 PM in California and 1 AM in
London: the same push is either premature or a wake-up call.

Everything here is defensive about the zone string, because it arrives from a device and a bad one
must never take the notifier down for everyone else — an unknown zone falls back to ET, which is
the behaviour we had before and is never worse than not sending at all.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.timezone import ET

# A zone string is a device-supplied identifier, cached so a per-user loop doesn't re-parse the
# tzdata file for every row.
_ZONE_CACHE: dict[str, ZoneInfo] = {}


def resolve_zone(tz_name: str | None) -> ZoneInfo:
    """The player's zone, or ET when unknown/unparseable. Never raises."""
    if not tz_name:
        return ET
    cached = _ZONE_CACHE.get(tz_name)
    if cached is not None:
        return cached
    try:
        zone = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError, KeyError, OSError):
        return ET
    _ZONE_CACHE[tz_name] = zone
    return zone


def local_hour(tz_name: str | None, now: datetime) -> int:
    """Hour of the day (0-23) as the player sees it right now."""
    return now.astimezone(resolve_zone(tz_name)).hour


def is_valid_zone(tz_name: str) -> bool:
    """True iff this string names a real IANA zone — the API rejects anything else rather than
    storing junk that would silently degrade every future send to the ET fallback."""
    if not tz_name or len(tz_name) > 64:
        return False
    try:
        ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError, KeyError, OSError):
        return False
    return True
