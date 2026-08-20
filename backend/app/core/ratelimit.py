"""Tiny in-process, per-key rolling-window rate limiter.

Purpose-built for the guest-create abuse cap (§ viral share loop): guest accounts are free and
form-less, so a single IP could otherwise mint them en masse. This is deliberately simple — an
in-memory dict of key → recent hit timestamps, pruned on each call — NOT a distributed limiter. It
is per-process, so behind multiple Render instances the effective cap is (instances × limit); that
is an acceptable soft ceiling for an anti-abuse speed bump (not a security boundary). Reset by a
process restart. Thread-safety is not required under the asyncio single-loop model.
"""

from __future__ import annotations

import time
from collections import defaultdict

from fastapi import Request

# key -> monotonically-increasing wall-clock timestamps (seconds) of recent allowed hits.
_hits: dict[str, list[float]] = defaultdict(list)


def _prune(key: str, window_seconds: float, now: float) -> None:
    cutoff = now - window_seconds
    kept = [t for t in _hits[key] if t > cutoff]
    if kept:
        _hits[key] = kept
    else:  # drop empty buckets so the dict can't grow unbounded across many one-off IPs
        _hits.pop(key, None)


def check_rate_limit(
    key: str, *, limit: int, window_seconds: float = 3600.0, now: float | None = None
) -> bool:
    """Record + test one hit for `key`. Returns True if allowed, False if the limit is exceeded.

    Allows up to `limit` hits per rolling `window_seconds`. A rejected hit is NOT recorded (so the
    caller returning 429 doesn't itself consume budget / extend the window).
    """
    ts = time.monotonic() if now is None else now
    _prune(key, window_seconds, ts)
    if len(_hits.get(key, ())) >= limit:
        return False
    _hits[key].append(ts)
    return True


def reset_rate_limits() -> None:
    """Clear all limiter state (tests)."""
    _hits.clear()


def client_ip(request: Request) -> str:
    """The client IP used to key rate limits, resistant to X-Forwarded-For spoofing.

    XFF is a chain: each proxy APPENDS the address it received the request from, so the entries to
    the LEFT are whatever the client (and any hop before our trusted proxies) chose to send — fully
    forgeable. The only trustworthy value is the one our OUTERMOST trusted proxy added, at a fixed
    offset from the RIGHT: `xff[-trusted_proxy_count]`.

    The previous implementation returned `xff[0]` — the leftmost, client-controlled value — so an
    attacker rotated `X-Forwarded-For: 9.9.9.<n>` to get a fresh limiter bucket per request and the
    guest cap (the app's one rate limit) was fully bypassable. Verified: rotating XFF created 40/40
    guests against a 30/hr cap; with this fix that same rotation keys on the real proxy hop instead.

    `trusted_proxy_count = 0` (no proxy in front) ignores XFF entirely and uses the socket peer.
    """
    from app.core.config import settings

    n = settings.trusted_proxy_count
    if n > 0:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            parts = [p.strip() for p in xff.split(",") if p.strip()]
            if len(parts) >= n:
                return parts[-n]
            # Fewer hops than expected → the chain was tampered with (or misconfigured); use the
            # peer rather than trusting a short, attacker-shaped header.
    return request.client.host if request.client else "unknown"
