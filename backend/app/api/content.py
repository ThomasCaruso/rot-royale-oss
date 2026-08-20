"""Serve gameplay content FILES out of the active content package.

Change-detection imagery is the only gameplay content that is files rather than JSON. It used to be
served by the web host out of `frontend/public/assets/change/`, which meant the production images
lived in the application repo while every other production input — questions, answers, Fermi items,
campaign manifests — sat behind ROT_CONTENT_DIR. This router closes that gap, so the invariant is
simply:

    production gameplay material == ROT_CONTENT_DIR

The alternative was copying private assets into `frontend/public/` during a production build. That
makes the web build depend on an overlay step contributors do not have, CI cannot reproduce, and a
future deploy can silently skip — and a silently skipped image is the worst failure this round type
has, because a blank frame is indistinguishable from a hard change and scores as a guaranteed miss.

UNAUTHENTICATED, deliberately. These URLs are consumed by `<img src>`, which sends no Authorization
header, so requiring a token would break rendering on every client. This is the same exposure the
files had as public static assets — anyone holding a URL could already fetch them. What changes is
that the filenames and the images no longer need to exist in public SOURCE, which is what a public
release requires; it is not, and is not claimed to be, an access-control boundary.
"""

from __future__ import annotations

from content import change_assets
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from app.core.config import settings

router = APIRouter(prefix="/content", tags=["content"])

# The files are immutable per name (a replacement gets a new name, same as the `?v=` rule for
# frontend art in CLAUDE.md §7), and a change round fetches two of them under a 30s timer, so a long
# cache is both safe and worth having on a replay.
_CACHE_CONTROL = "public, max-age=86400"


@router.get("/change/{asset_id}")
async def change_asset(asset_id: str) -> FileResponse:
    """One change-detection image from `<content_root>/change/assets/`.

    Every rejection is the SAME flat 404 — malformed name, traversal attempt, unsupported
    extension, unknown asset, not-a-file. Distinguishing them would turn this into an oracle for
    what the private package contains, and the client has no use for the difference. There is no
    route for the directory itself, so the package cannot be listed.
    """
    path = change_assets.resolve(settings.content_root, asset_id)
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "asset not found")
    media_type = change_assets.media_type_for(asset_id)
    assert media_type is not None  # resolve() already rejected unsupported extensions
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": _CACHE_CONTROL})
