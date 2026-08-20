"""Default theme flips to starter (the ivory/purple/gold Rot Royale identity).

Column-default only: `profiles.equipped_theme` server_default 'blank_light' → 'starter' so raw
inserts match the app-level DEFAULT_THEME_ID (registration sets the value explicitly; this keeps
the schema honest). Existing rows are deliberately untouched — accounts already wearing
blank_light (or anything else) keep their choice.

Revision ID: e4f5a6b7c8d9
Revises: d2e3f4a5b6c7
Create Date: 2026-07-06
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e4f5a6b7c8d9"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "profiles",
        "equipped_theme",
        existing_type=sa.String(length=64),
        server_default="starter",
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "profiles",
        "equipped_theme",
        existing_type=sa.String(length=64),
        server_default="blank_light",
        existing_nullable=False,
    )
