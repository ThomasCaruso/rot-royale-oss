"""Path safety for content-package media, shared by every asset kind.

This is the ONLY place a request-supplied string becomes a filesystem path, for change images and
video clips alike. It was written for the change images and lived in `change_assets.py`; the video
round needed exactly the same rule with a different directory and a different media whitelist, and
a second copy of security-critical path handling is the kind of duplication that ages badly — one
copy gets a fix and the other does not.

It is an ALLOWLIST, deliberately, rather than a blocklist of traversal spellings: a name must look
like an asset id, carry a supported extension, and land directly inside the expected directory. A
blocklist has to anticipate every encoding; an allowlist does not.
"""

from __future__ import annotations

import re
from pathlib import Path

ASSETS_SUBDIR = "assets"

# One path segment: starts alphanumeric (so no dotfiles and no bare ".."), then alphanumerics and
# the three punctuation marks real asset names use. No slash, no backslash, no NUL, no spaces.
_ASSET_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def assets_dir(content_root: Path, kind: str) -> Path:
    """<content_root>/<kind>/assets — where one kind of media lives in the content package."""
    return content_root / kind / ASSETS_SUBDIR


def is_valid_asset_id(asset_id: str, media_types: dict[str, str]) -> bool:
    """Whether a string is SHAPED like an asset id of this kind. Says nothing about the file."""
    if not isinstance(asset_id, str) or ".." in asset_id:
        return False
    if not _ASSET_ID.fullmatch(asset_id):
        return False
    return Path(asset_id).suffix.lower() in media_types


def resolve(
    content_root: Path, kind: str, asset_id: str, media_types: dict[str, str]
) -> Path | None:
    """The asset file for `asset_id`, or None if it is unusable for ANY reason.

    One return value for malformed, traversing, unsupported, absent and not-a-file, on purpose: the
    caller turns None into a flat 404, so the endpoint cannot be used to probe which names exist on
    disk versus which are merely rejected.
    """
    if not is_valid_asset_id(asset_id, media_types):
        return None
    base = assets_dir(content_root, kind)
    try:
        resolved_base = base.resolve()
        candidate = (base / asset_id).resolve()
    except OSError:  # unresolvable path (broken link, bad mount, name too long for the OS)
        return None
    if candidate.parent != resolved_base:  # must sit DIRECTLY in the assets dir, not below it
        return None
    if not candidate.is_file():
        return None
    return candidate


__all__ = ["ASSETS_SUBDIR", "assets_dir", "is_valid_asset_id", "resolve"]
