"""CORS preflight behavior.

In local/dev the frontend's origin is whatever port Vite landed on — it hops 5173 → 5174 → … when
a port is taken — so any localhost origin must clear the preflight, or login fails with a 400 on the
OPTIONS request. Unknown origins are still rejected (the dev allowance is localhost-only).
"""

from __future__ import annotations

from httpx import AsyncClient

_PREFLIGHT = {
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type",
}


async def test_dev_allows_any_localhost_port(client: AsyncClient):
    r = await client.options(
        "/auth/login", headers={"Origin": "http://localhost:5174", **_PREFLIGHT}
    )
    assert r.status_code == 200, r.text
    assert r.headers["access-control-allow-origin"] == "http://localhost:5174"


async def test_unknown_origin_still_rejected(client: AsyncClient):
    r = await client.options(
        "/auth/login", headers={"Origin": "https://evil.example", **_PREFLIGHT}
    )
    assert r.status_code == 400


async def test_capacitor_native_origin_allowed(client: AsyncClient):
    # The Capacitor iOS WebView sends Origin: capacitor://localhost. It is NOT matched by the dev
    # localhost regex (capacitor:// scheme), so it must be allowed via the explicit list — which is
    # the only thing honored in production too. Always-allowed regardless of CORS_ORIGINS.
    r = await client.options(
        "/auth/login", headers={"Origin": "capacitor://localhost", **_PREFLIGHT}
    )
    assert r.status_code == 200, r.text
    assert r.headers["access-control-allow-origin"] == "capacitor://localhost"


def test_cors_origins_list_keeps_web_origins_and_adds_native():
    # The merge preserves env-driven web origins and always appends the native-app origin, deduped.
    from app.core.config import Settings

    s = Settings(cors_origins="https://rotroyale.live,https://www.rotroyale.live")
    assert s.cors_origins_list == [
        "https://rotroyale.live",
        "https://www.rotroyale.live",
        "capacitor://localhost",
    ]
    # No duplicate if an env already lists the native origin.
    s2 = Settings(cors_origins="https://rotroyale.live,capacitor://localhost")
    assert s2.cors_origins_list.count("capacitor://localhost") == 1
