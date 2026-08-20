"""profiles.timezone — schedule notifications in the player's own evening

Revision ID: 7c1e4a92d6b3
Revises: 3b9f2c7a4e18
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7c1e4a92d6b3"
down_revision: str | Sequence[str] | None = "3b9f2c7a4e18"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("profiles", sa.Column("timezone", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("profiles", "timezone")
