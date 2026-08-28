"""Resolution + path safety for the video round's clips.

The sibling of `change_assets.py`; both bind the shared allowlist in `asset_paths.py` to their own
directory and media whitelist. Everything the live game needs still crosses ONE boundary:

    <content_root>/video/manifest.json    items name clips by IDENTIFIER
    <content_root>/video/assets/<id>      the file itself

**MP4/H.264 only, and that is a compatibility rule rather than a preference.** `ios/App` pins
IPHONEOS_DEPLOYMENT_TARGET 13.0, and a container or codec that WKWebView cannot decode renders as a
blank frame — which in this round is an unanswerable question with nothing in any log to notice.
WebM and HEVC are excluded for exactly the reason WebP is excluded from the change images.
"""

from __future__ import annotations

from pathlib import Path

from content import asset_paths

VIDEO_KIND = "video"

# Deliberately one entry. Widening this is a device-compatibility decision, not a convenience.
MEDIA_TYPES: dict[str, str] = {".mp4": "video/mp4"}


def assets_dir(content_root: Path) -> Path:
    return asset_paths.assets_dir(content_root, VIDEO_KIND)


def is_valid_asset_id(asset_id: str) -> bool:
    """Whether a string is SHAPED like a clip id. Says nothing about the file existing."""
    return asset_paths.is_valid_asset_id(asset_id, MEDIA_TYPES)


def media_type_for(asset_id: str) -> str | None:
    return MEDIA_TYPES.get(Path(asset_id).suffix.lower())


def resolve(content_root: Path, asset_id: str) -> Path | None:
    """The clip file for `asset_id`, or None if it is unusable for ANY reason.

    One return value for every rejection reason, so the endpoint cannot be used to probe which
    names exist on disk versus which are merely refused.
    """
    return asset_paths.resolve(content_root, VIDEO_KIND, asset_id, MEDIA_TYPES)


__all__ = [
    "MEDIA_TYPES",
    "VIDEO_KIND",
    "assets_dir",
    "is_valid_asset_id",
    "media_type_for",
    "resolve",
]
