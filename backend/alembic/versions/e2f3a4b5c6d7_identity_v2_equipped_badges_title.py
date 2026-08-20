"""identity v2: equipped_badges + equipped_title on profiles

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-06-10 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e2f3a4b5c6d7"
down_revision: str | Sequence[str] | None = "d1e2f3a4b5c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Up to 3 equipped badge ids (JSON array of strings; order = display order). Badges/titles are
    # earned achievements (computed on read) — only the player's PICK is stored here.
    op.add_column(
        "profiles",
        sa.Column(
            "equipped_badges",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "profiles",
        sa.Column("equipped_title", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("profiles", "equipped_title")
    op.drop_column("profiles", "equipped_badges")
