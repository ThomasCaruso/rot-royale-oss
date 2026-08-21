"""Validation for client-supplied Web Push endpoint URLs.

A web-push subscription carries an `endpoint` chosen by the BROWSER and relayed by the client. The
server later POSTs to it from inside its own network, which makes an unvalidated endpoint a
server-side request forgery primitive: register a subscription pointing at a cloud metadata service
or an internal host, wait for the daily reminder, and the server makes the request for you.

It is blind — the response body never reaches the subscriber — but it is not harmless. Delivery
outcome is observable: a 404 or 410 retires the subscription (`PushExpired`) and anything else keeps
it, so the caller gets a one-bit oracle about internal endpoints. And on a platform like Render the
internal network includes the database host and every sibling service.

The rule here is deliberately a DENY of private destinations rather than an ALLOW of known push
services. An allowlist of `fcm.googleapis.com`, `updates.push.services.mozilla.com` and friends
would be tighter, but it silently breaks the moment a browser vendor moves a hostname — and a push
subscription that fails closed is indistinguishable, to the player, from notifications being broken.
Denying the destinations that matter keeps the forgery unreachable without coupling us to a list
that changes outside our control.
"""

from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

# Longest legitimate push endpoint seen in the wild is a few hundred characters; the cap stops a
# multi-kilobyte string being stored and replayed on every send.
MAX_ENDPOINT_LENGTH = 2048


class InvalidPushEndpoint(ValueError):
    """The endpoint is not a destination we are willing to make requests to."""


def _host_is_private(host: str) -> bool:
    """True when the host names something on a private or otherwise non-public network."""
    h = (host or "").strip().lower().strip("[]")
    if not h:
        return True
    if h in ("localhost", "localhost.localdomain"):
        return True
    # Single-label hostnames are internal service names by construction — this is exactly how
    # Render addresses its own Postgres and sibling services (see _is_internal_db_host in config).
    if "." not in h:
        return True
    if h.endswith((".internal", ".local", ".localdomain", ".localhost")):
        return True
    try:
        ip = ipaddress.ip_address(h)
    except ValueError:
        return False  # a normal public-looking DNS name
    # An IP literal gets checked directly. This does NOT resolve DNS names: a resolve-then-fetch
    # check is defeated by rebinding between the check and the send, so it would buy confidence
    # rather than safety. Literals are where the cheap, reliable win is.
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def validate_push_endpoint(endpoint: str) -> str:
    """Return the endpoint unchanged, or raise InvalidPushEndpoint.

    Checks, in order: length, parseable, https only, has a host, host is not private.
    """
    if not isinstance(endpoint, str) or not endpoint.strip():
        raise InvalidPushEndpoint("endpoint must be a non-empty string")
    endpoint = endpoint.strip()
    if len(endpoint) > MAX_ENDPOINT_LENGTH:
        raise InvalidPushEndpoint(f"endpoint exceeds {MAX_ENDPOINT_LENGTH} characters")

    try:
        parts = urlsplit(endpoint)
    except ValueError as exc:
        raise InvalidPushEndpoint("endpoint is not a valid URL") from exc

    # https only. Every real push service is https, and allowing other schemes would admit
    # http:// to an internal host, and file:// / gopher:// style tricks against the client library.
    if parts.scheme != "https":
        raise InvalidPushEndpoint(f"endpoint must use https, got {parts.scheme or 'no'} scheme")
    if not parts.hostname:
        raise InvalidPushEndpoint("endpoint has no host")
    if "@" in parts.netloc:
        # userinfo in the authority is never legitimate here and is a classic way to make a URL
        # read as one host to a human and resolve as another.
        raise InvalidPushEndpoint("endpoint must not contain credentials")
    if _host_is_private(parts.hostname):
        raise InvalidPushEndpoint("endpoint resolves to a private or internal host")
    return endpoint
