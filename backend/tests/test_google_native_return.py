"""Where a finished Google sign-in is returned to, and why the client cannot choose it.

The fragment these build carries a one-time handoff code — a credential that trades for a real
session. So the property that matters is not "native works", it is that a REQUEST can only name a
platform, never a destination: the URLs are assembled from server configuration, and anything
unrecognised falls back to the web rather than erroring or, far worse, being honoured.
"""

import pytest
from app.core.config import settings
from app.services.google_oauth import (
    PLATFORM_NATIVE,
    PLATFORM_WEB,
    normalize_platform,
    return_url,
)


class TestNormalizePlatform:
    def test_known_platforms_pass_through(self) -> None:
        assert normalize_platform("web") == PLATFORM_WEB
        assert normalize_platform("native") == PLATFORM_NATIVE

    def test_case_and_whitespace_are_forgiven(self) -> None:
        assert normalize_platform("  NATIVE ") == PLATFORM_NATIVE

    def test_absent_platform_is_web(self) -> None:
        # Every client shipped before native sign-in sends nothing, and must keep working (§7c).
        assert normalize_platform(None) == PLATFORM_WEB
        assert normalize_platform("") == PLATFORM_WEB

    @pytest.mark.parametrize(
        "hostile",
        [
            "https://evil.example",
            "//evil.example",
            "javascript:alert(1)",
            "desktop",
            "web native",
        ],
    )
    def test_anything_else_becomes_web_rather_than_being_honoured(self, hostile: str) -> None:
        # The whole security argument in one assertion: an unrecognised value can only ever degrade
        # to the web flow. It is never echoed, never used to build a URL, and never an error the
        # caller can use to probe.
        assert normalize_platform(hostile) == PLATFORM_WEB


class TestReturnUrl:
    def test_web_returns_into_the_spa(self) -> None:
        url = return_url(PLATFORM_WEB, "handoff=abc")
        assert url.startswith(settings.web_base_url.rstrip("/"))
        assert url.endswith("/#handoff=abc")

    def test_native_returns_to_the_configured_scheme(self) -> None:
        assert return_url(PLATFORM_NATIVE, "handoff=abc") == (
            f"{settings.native_auth_scheme}://auth#handoff=abc"
        )

    def test_the_payload_is_always_in_the_fragment(self) -> None:
        # Fragments are never sent to a server. A handoff code in a query string would reach access
        # logs, proxies and Referer headers on its way back — which is the reason it is a fragment
        # on the web too, not a native-only nicety.
        for platform in (PLATFORM_WEB, PLATFORM_NATIVE):
            url = return_url(platform, "handoff=secret")
            assert "#handoff=secret" in url
            assert "?handoff" not in url

    def test_an_unknown_platform_builds_a_web_url(self) -> None:
        assert return_url("https://evil.example", "handoff=abc") == return_url(
            PLATFORM_WEB, "handoff=abc"
        )

    def test_nothing_from_the_caller_reaches_the_host(self) -> None:
        # `return_url` takes a platform and a fragment; neither can introduce a host. If this ever
        # stops holding, the callback becomes an open redirect that hands out sessions.
        url = return_url("native", "auth_error=google")
        assert url.startswith(f"{settings.native_auth_scheme}://")
