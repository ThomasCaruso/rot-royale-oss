"""Resolution + path safety for change-detection imagery held in the content package.

Change rounds are the one round type whose content is FILES, not JSON. Those files used to sit in
`frontend/public/assets/change/` and be served by the web host, which split production gameplay
material across two places: questions, answers, Fermi items and campaign manifests behind
ROT_CONTENT_DIR, but the challenge imagery inside the application repo. That split is why replacing
the artwork for a public release would have broken Change mode in production — the live manifest
would still have named files that had become placeholders.

Everything the live game needs now crosses ONE boundary:

    production gameplay material == ROT_CONTENT_DIR

so the manifest and the images it names travel together, and the sample package's synthetic pairs
are served by the identical code path.

    <content_root>/change/manifest.json     items name assets by IDENTIFIER
    <content_root>/change/assets/<id>       the file itself

`resolve()` is the ONLY way a request-supplied string becomes a filesystem path. It is deliberately
an allowlist — a name must look like an asset id, carry a supported extension, and land directly
inside the assets directory — rather than a blocklist of traversal spellings, because a blocklist
has to anticipate every encoding and an allowlist does not.
"""

from __future__ import annotations

from pathlib import Path

from content import asset_paths

ASSETS_SUBDIR = "assets"

# Supported image types. WebP is deliberately ABSENT: ios/App pins IPHONEOS_DEPLOYMENT_TARGET 13.0
# and WKWebView only gained WebP in iOS 14 (docs/architecture.md §13), so a .webp pair would
# render as a blank frame — an unfindable change and a guaranteed miss — on those devices.
# Serving is where that rule has to be enforced, because the manifest is private content that no
# public test can inspect.
MEDIA_TYPES: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}

# The path-safety rule itself now lives in `content/asset_paths.py`, shared with the video clips —
# a second copy of security-critical path handling is how one copy gets a fix and the other does
# not. This module keeps the CHANGE-specific bindings: which directory, which media types.
CHANGE_KIND = "change"


def assets_dir(content_root: Path) -> Path:
    return asset_paths.assets_dir(content_root, CHANGE_KIND)


def is_valid_asset_id(asset_id: str) -> bool:
    """Whether a string is SHAPED like an asset id. Says nothing about the file existing."""
    return asset_paths.is_valid_asset_id(asset_id, MEDIA_TYPES)


def media_type_for(asset_id: str) -> str | None:
    return MEDIA_TYPES.get(Path(asset_id).suffix.lower())


def resolve(content_root: Path, asset_id: str) -> Path | None:
    """The asset file for `asset_id`, or None if it is unusable for ANY reason.

    One return value for malformed, traversing, unsupported, absent and not-a-file, on purpose: the
    caller turns None into a flat 404, so the endpoint cannot be used to probe which names exist on
    disk versus which are merely rejected.
    """
    return asset_paths.resolve(content_root, CHANGE_KIND, asset_id, MEDIA_TYPES)
