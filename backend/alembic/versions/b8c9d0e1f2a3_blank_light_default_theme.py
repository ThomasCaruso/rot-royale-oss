"""Default theme flips to blank_light (the Blank pair is the product's standard look).

Column-default only: `profiles.equipped_theme` server_default 'royale' → 'blank_light' so raw
inserts match the app-level DEFAULT_THEME_ID (registration sets the value explicitly; this keeps
the schema honest). Existing rows are deliberately untouched — accounts equipped with `royale`
(now "Rot Champion", the first-200 founder exclusive) keep wearing it.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-07-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "profiles",
        "equipped_theme",
        existing_type=sa.String(length=64),
        server_default="blank_light",
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "profiles",
        "equipped_theme",
        existing_type=sa.String(length=64),
        server_default="royale",
        existing_nullable=False,
    )
