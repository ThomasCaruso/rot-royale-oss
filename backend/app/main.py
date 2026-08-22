"""FastAPI application entrypoint.

Boots, connects to Postgres, serves the API, and (when scheduler_enabled) runs the window
scheduler daemon in-process via the app lifespan (docs/architecture.md).
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import (
    analytics,
    auth,
    brain_boost,
    campaign,
    categories,
    challenges,
    cognition,
    content,
    contests,
    duel,
    entries,
    friend_challenge,
    friend_duel,
    friends,
    health,
    identity,
    me,
    missions,
    personalization,
    practice,
    push,
    vault,
)
from app.core.config import PRODUCTION_ENVS, settings

# Largest request body the API will accept. Every endpoint here trades small JSON (the biggest is an
# 8-round submit or a push subscription — a few KB); nothing legitimately approaches this. The cap
# stops an oversized body from being buffered into memory on any route (L-2).
_log = logging.getLogger(__name__)

MAX_BODY_BYTES = 256 * 1024


def _content_revision() -> str:
    """The content package's own revision, written by scripts/fetch_private_content.py.

    Absent locally (the sample corpus is committed, not fetched) and absent on a deploy that was
    never given a private package — both report "unset" rather than failing, because a missing
    revision marker is a reporting gap, not a reason to refuse to serve.
    """
    try:
        return (settings.content_root / ".content-revision").read_text(encoding="utf-8").strip()
    except OSError:
        return "unset (sample corpus or unfetched)"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Production cannot reach here on a dev key — Settings refuses to construct (config.py). This
    # covers the other direction: a non-production deployment running on the committed default
    # should be impossible to mistake for a real one when reading logs.
    if settings.secret_key_is_insecure:
        _log.warning(
            "SECRET_KEY is the committed development default (or too short). Tokens signed with "
            "it are forgeable by anyone with the source. APP_ENV=%s — never use this in "
            "production.",
            settings.app_env,
        )
    # Release identity: a deploy is an APPLICATION revision paired with a CONTENT revision, and the
    # two move independently — a content release can ship without an application release, and a
    # rollback restores the content that was packaged with that build. Neither is derivable from
    # the other, so both are logged, and this is the only place they appear together.
    #
    # Revisions only — never the content path. The path is Render's to choose and says nothing
    # useful in a log, while a filesystem layout in an aggregator is free reconnaissance.
    #
    # basicConfig first, because the app has NO logging configuration of its own: uvicorn configures
    # only its own loggers, so an app INFO record reaches a root logger with no handler and Python
    # drops it through lastResort, which is WARNING-only. The secret-key warning above survived that
    # and hid the gap. basicConfig is a no-op when handlers already exist, so it defers to whatever
    # a host or the test runner has set up.
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    _log.info(
        "Application revision: %s | Content revision: %s",
        settings.app_revision or "unknown",
        _content_revision(),
    )

    scheduler = None
    if settings.scheduler_enabled:
        from app.jobs.daemon import start_scheduler

        scheduler = await start_scheduler()
    try:
        yield
    finally:
        if scheduler is not None:
            scheduler.shutdown(wait=False)


# MEDIUM-2: the interactive schema enumerates every route and model to anonymous callers. That is
# reconnaissance rather than a vulnerability — and its value drops once the source is public — but a
# LIVE schema is what drives automated scanners, so production serves none of it. Development keeps
# all three, where they are genuinely useful.
_DOCS_ENABLED = settings.app_env not in PRODUCTION_ENVS

app = FastAPI(
    title="Rot Royale API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if _DOCS_ENABLED else None,
    redoc_url="/redoc" if _DOCS_ENABLED else None,
    openapi_url="/openapi.json" if _DOCS_ENABLED else None,
)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Reject over-large request bodies before they are read into memory (L-2).

    Checks the declared Content-Length — every real client sends it, and it stops the buffered-body
    memory hit on any route. (A client lying about Content-Length or streaming chunked is bounded by
    uvicorn's own limits; this is the app-level guard, not the only one.)
    """
    cl = request.headers.get("content-length")
    if cl is not None:
        try:
            if int(cl) > MAX_BODY_BYTES:
                return JSONResponse(
                    {"detail": "Request body too large"},
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                )
        except ValueError:
            return JSONResponse(
                {"detail": "Invalid Content-Length"},
                status_code=status.HTTP_400_BAD_REQUEST,
            )
    return await call_next(request)


# In dev, the frontend origin is whatever port Vite landed on (it hops 5173 → 5174 → … when a port
# is taken), so allow any localhost/127.0.0.1 origin — otherwise login fails with a 400 on the CORS
# preflight whenever Vite isn't on the one hardcoded port. Production stays LOCKED to the explicit
# cors_origins (the deployed web origin); the regex is disabled there (docs/architecture.md).
# PRODUCTION_ENVS, not `== "production"`. The docs gate above already uses the full set, and the
# two disagreeing meant APP_ENV=staging or APP_ENV=prod hid the API schema while still allowing
# any localhost origin to make CREDENTIALED requests. Same question, same answer, one constant.
_dev_origin_regex = (
    None if settings.app_env in PRODUCTION_ENVS else r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=_dev_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(me.router)
app.include_router(identity.router)
app.include_router(contests.router)
app.include_router(entries.router)
app.include_router(practice.router)
app.include_router(cognition.router)
app.include_router(content.router)
app.include_router(categories.router)
app.include_router(campaign.router)
app.include_router(missions.router)
app.include_router(vault.router)
app.include_router(duel.router)
app.include_router(friends.router)
app.include_router(friend_duel.router)
app.include_router(friend_challenge.router)
app.include_router(push.router)
app.include_router(personalization.router)
app.include_router(brain_boost.router)
app.include_router(analytics.router)
app.include_router(challenges.router)
app.include_router(challenges.public_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "rot-royale", "status": "ok"}
