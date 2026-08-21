"""A push endpoint is a URL the SERVER will request. It cannot be arbitrary.

`SubscribeRequest.endpoint` is chosen by the client, stored, and later POSTed to by the server from
inside its own network. Unvalidated, that is a server-side request forgery primitive with a delayed
trigger: subscribe pointing at a metadata service or an internal host, wait for the daily reminder,
and the server makes the request.

Blind, but not harmless — delivery outcome is observable. A 404 or 410 retires the subscription and
anything else keeps it, which is a one-bit oracle about internal endpoints. On Render the internal
network includes the database host and every sibling service.

These tests are the attack, written down.
"""

from __future__ import annotations

import pytest
from app.core.pushurl import InvalidPushEndpoint, validate_push_endpoint
from httpx import AsyncClient
from pydantic import ValidationError

pytestmark = pytest.mark.anyio

# Real push services. If a change here starts rejecting these, notifications break silently for
# every player on that browser — which is why the rule denies private destinations rather than
# allowlisting hostnames that vendors can move without telling us.
LEGITIMATE = [
    "https://fcm.googleapis.com/fcm/send/abcDEF123:APA91bHxyz-0_9",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk",
    "https://web.push.apple.com/QF3aB2c9",
    "https://par02p.notify.windows.com/w/?token=BQYAAAB",
]

HOSTILE = [
    # Cloud metadata — the classic SSRF target.
    "https://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "https://[fd00:ec2::254]/latest/meta-data/",
    # Loopback and private ranges.
    "https://127.0.0.1/admin",
    "https://127.0.0.1:8000/internal",
    "https://[::1]/admin",
    "https://10.0.0.5/",
    "https://192.168.1.1/",
    "https://172.16.0.1/",
    "https://0.0.0.0/",
    # Internal names. Render addresses its own Postgres and sibling services as single-label
    # hosts, so a bare name is an internal destination by construction.
    "https://localhost/",
    "https://dpg-d8igjajtqb8s73b4plq0-a/",
    "https://rot-royale-api/",
    "https://redis.internal/",
    "https://something.local/",
    # Non-https schemes: the only reason to want one is to reach something https cannot.
    "http://fcm.googleapis.com/fcm/send/x",
    "gopher://127.0.0.1:11211/",
    "file:///etc/passwd",
    # Credentials in the authority read as one host to a human and resolve as another.
    "https://fcm.googleapis.com@169.254.169.254/",
]


@pytest.mark.parametrize("url", LEGITIMATE)
def test_real_push_services_are_accepted(url):
    assert validate_push_endpoint(url) == url


@pytest.mark.parametrize("url", HOSTILE)
def test_hostile_endpoints_are_refused(url):
    with pytest.raises(InvalidPushEndpoint):
        validate_push_endpoint(url)


@pytest.mark.parametrize("bad", ["", "   ", "not a url", "https://", "https:///path"])
def test_malformed_endpoints_are_refused(bad):
    with pytest.raises(InvalidPushEndpoint):
        validate_push_endpoint(bad)


def test_absurdly_long_endpoints_are_refused():
    """Stored and replayed on every send, so length is a cost as well as a smell."""
    with pytest.raises(InvalidPushEndpoint, match="characters"):
        validate_push_endpoint("https://fcm.googleapis.com/" + "a" * 4000)


def test_the_schema_rejects_it_before_anything_is_stored():
    """Enforced at the API boundary: an invalid endpoint should never reach the database."""
    from app.schemas.push import SubscribeRequest

    with pytest.raises(ValidationError):
        SubscribeRequest(
            endpoint="https://169.254.169.254/latest/meta-data/",
            keys={"p256dh": "x", "auth": "y"},
        )
    ok = SubscribeRequest(endpoint=LEGITIMATE[0], keys={"p256dh": "x", "auth": "y"})
    assert ok.endpoint == LEGITIMATE[0]


async def test_subscribe_endpoint_returns_422_for_an_internal_url(client: AsyncClient):
    """End to end, through the real route."""
    r = await client.post(
        "/auth/register",
        json={"email": "ssrf@example.com", "password": "Sup3rSecret!pw", "username": "ssrfcheck"},
    )
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    bad = await client.post(
        "/push/subscribe",
        headers=headers,
        json={
            "endpoint": "https://169.254.169.254/latest/meta-data/",
            "keys": {"p256dh": "BPub", "auth": "AAuth"},
        },
    )
    assert bad.status_code == 422, bad.text

    good = await client.post(
        "/push/subscribe",
        headers=headers,
        json={"endpoint": LEGITIMATE[0], "keys": {"p256dh": "BPub", "auth": "AAuth"}},
    )
    assert good.status_code == 200, good.text
