"""Android push routing (FCM HTTP v1).

Before this transport existed, `build_sender` matched `platform == "android"` against nothing and
fell through to the skip branch: the device registered, the row was kept, and the notification was
silently dropped. Nothing errored, so the failure was invisible — the same shape as the
service-worker race in push.ts. These pin that an Android row actually reaches FCM, that a dead
token prunes, and that a transient failure does NOT.
"""

from __future__ import annotations

import json

import httpx
import pytest
from app.core.config import Settings
from app.services.push import PushExpired, build_sender

# A throwaway RS256 key generated for this test only — never a real credential.
_TEST_PRIVATE_KEY = """-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDBn2Qm5Yx0kFVh
-----END PRIVATE KEY-----"""


def _settings(**over: object) -> Settings:
    """FCM-only settings. `_env_file=None` is load-bearing: without it pydantic-settings reads the
    developer's real backend/.env, which has VAPID/APNs credentials — the web transport would then
    exist and these tests would silently exercise the wrong branch."""
    base: dict[str, object] = {
        "_env_file": None,
        "fcm_project_id": "rot-royale-test",
        "fcm_client_email": "push@rot-royale-test.iam.gserviceaccount.com",
        "fcm_private_key": _TEST_PRIVATE_KEY,
    }
    base.update(over)
    return Settings(**base)  # type: ignore[arg-type]


def test_fcm_enabled_requires_all_three_credentials() -> None:
    assert _settings().fcm_enabled
    assert not _settings(fcm_project_id="").fcm_enabled
    assert not _settings(fcm_client_email="").fcm_enabled
    assert not _settings(fcm_private_key="").fcm_enabled


def test_pem_newlines_are_restored_from_env_var_form() -> None:
    """Secret UIs store one line, so a pasted PEM arrives with literal backslash-n."""
    escaped = _TEST_PRIVATE_KEY.replace("\n", "\\n")
    assert "\\n" in escaped
    restored = _settings(fcm_private_key=escaped).fcm_private_key
    assert "\\n" not in restored
    assert restored == _TEST_PRIVATE_KEY
    # Idempotent: a PEM that already has real newlines is untouched.
    assert _settings(fcm_private_key=_TEST_PRIVATE_KEY).fcm_private_key == _TEST_PRIVATE_KEY


def test_build_sender_returns_none_when_nothing_is_configured() -> None:
    assert build_sender(Settings(_env_file=None)) is None  # type: ignore[call-arg]


class _FakeAsyncClient:
    """Captures the FCM request and replays a scripted response."""

    calls: list[dict[str, object]] = []
    response_status = 200
    response_body: dict[str, object] = {}

    def __init__(self, *_a: object, **_kw: object) -> None:
        pass

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, *_a: object) -> None:
        return None

    async def post(self, url: str, **kw: object) -> httpx.Response:
        type(self).calls.append({"url": url, **kw})
        # A real request must be attached or `raise_for_status()` refuses to evaluate.
        request = httpx.Request("POST", url)
        # The OAuth token exchange comes first; hand back a token so the send can proceed.
        if "oauth2.googleapis.com" in url:
            return httpx.Response(200, json={"access_token": "ya29.test-token"}, request=request)
        return httpx.Response(
            type(self).response_status, json=type(self).response_body, request=request
        )


@pytest.fixture(autouse=True)
def _reset_fake() -> None:
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.response_status = 200
    _FakeAsyncClient.response_body = {}


async def test_android_subscription_is_sent_to_fcm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr("app.services.push.jwt.encode", lambda *a, **kw: "signed.jwt")

    send = build_sender(_settings())
    assert send is not None
    await send(
        {"platform": "android", "device_token": "device-abc"},
        {"title": "Daily Royale", "body": "Your window closes soon", "url": "https://x/y"},
    )

    sends = [c for c in _FakeAsyncClient.calls if "fcm.googleapis.com" in str(c["url"])]
    assert len(sends) == 1, "an android row must reach FCM, not the silent skip branch"
    assert "projects/rot-royale-test/messages:send" in str(sends[0]["url"])
    body = json.loads(str(sends[0]["content"]))["message"]
    assert body["token"] == "device-abc"
    assert body["notification"]["title"] == "Daily Royale"
    assert body["android"]["priority"] == "high", "a dozing device needs high priority to wake"
    assert body["data"]["url"] == "https://x/y", "the deep link must survive for tap routing"


async def test_unregistered_token_raises_push_expired(monkeypatch: pytest.MonkeyPatch) -> None:
    """App uninstalled / token rotated → the row is dead and must be pruned."""
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr("app.services.push.jwt.encode", lambda *a, **kw: "signed.jwt")
    _FakeAsyncClient.response_status = 404
    _FakeAsyncClient.response_body = {"error": {"status": "UNREGISTERED"}}

    send = build_sender(_settings())
    assert send is not None
    with pytest.raises(PushExpired):
        await send({"platform": "android", "device_token": "gone"}, {"title": "t", "body": "b"})


async def test_invalid_argument_does_NOT_prune(monkeypatch: pytest.MonkeyPatch) -> None:
    """FCM returns INVALID_ARGUMENT for a malformed REQUEST too, not just a bad token.

    Treating it as fatal would let one bad payload delete every Android subscription, and those
    players would have to reinstall to re-register. A retained dead row costs one no-op send.
    """
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr("app.services.push.jwt.encode", lambda *a, **kw: "signed.jwt")
    _FakeAsyncClient.response_status = 400
    _FakeAsyncClient.response_body = {"error": {"status": "INVALID_ARGUMENT"}}

    send = build_sender(_settings())
    assert send is not None
    with pytest.raises(RuntimeError) as exc:
        await send({"platform": "android", "device_token": "maybe-ok"}, {"title": "t", "body": "b"})
    assert not isinstance(exc.value, PushExpired), "a malformed request must never prune devices"


async def test_transient_failure_does_not_prune(monkeypatch: pytest.MonkeyPatch) -> None:
    """A 503 is Google's problem, not a dead device — the subscription must survive."""
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr("app.services.push.jwt.encode", lambda *a, **kw: "signed.jwt")
    _FakeAsyncClient.response_status = 503
    _FakeAsyncClient.response_body = {"error": {"status": "UNAVAILABLE"}}

    send = build_sender(_settings())
    assert send is not None
    with pytest.raises(RuntimeError) as exc:
        await send({"platform": "android", "device_token": "ok"}, {"title": "t", "body": "b"})
    assert not isinstance(exc.value, PushExpired)


async def test_no_google_call_when_there_are_no_android_devices(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The OAuth token is fetched lazily, so an all-iOS run never talks to Google."""
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr("app.services.push.jwt.encode", lambda *a, **kw: "signed.jwt")

    send = build_sender(_settings())
    assert send is not None
    # A web row with no web transport configured → skipped, and nothing is sent anywhere.
    await send({"platform": "web", "endpoint": "https://example/x"}, {"title": "t", "body": "b"})
    assert _FakeAsyncClient.calls == []
