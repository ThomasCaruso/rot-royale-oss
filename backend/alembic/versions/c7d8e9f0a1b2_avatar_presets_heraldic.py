"""avatar presets: heraldic portrait set (knight default)

The free avatar preset catalog changed from the 8 emoji ids
(ninja/fox/robot/owl/bolt/brain/octopus/alien) to 5 illustrated heraldic
portraits (knight/sigil/crescent/rook/bishop). The default moves from
'ninja' to 'knight'. This migration:

  1. flips the profiles.avatar_preset server_default 'ninja' -> 'knight', and
  2. remaps every existing row whose preset is no longer in the catalog to
     'knight' (the frontend already falls back to knight for unknown ids, but
     this keeps /me returning a servable id and PATCH re-set working).

Revision ID: c7d8e9f0a1b2
Revises: d7947da0506d
Create Date: 2026-07-04

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7d8e9f0a1b2"
down_revision: str | None = "d7947da0506d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NEW_PRESETS = ("knight", "sigil", "crescent", "rook", "bishop")


def upgrade() -> None:
    op.alter_column("profiles", "avatar_preset", server_default="knight")
    in_list = ", ".join(f"'{p}'" for p in _NEW_PRESETS)
    op.execute(
        f"UPDATE profiles SET avatar_preset = 'knight' WHERE avatar_preset NOT IN ({in_list})"
    )


def downgrade() -> None:
    # Data remap is one-way (the old ids are gone); only the default is reverted.
    op.alter_column("profiles", "avatar_preset", server_default="ninja")
