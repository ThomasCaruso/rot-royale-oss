"""identity: avatar_preset + equipped_frame on profiles; create user_cosmetics; fix default

Revision ID: d1e2f3a4b5c6
Revises: 587a74fd60f6
Create Date: 2026-06-10 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1e2f3a4b5c6"
down_revision: str | Sequence[str] | None = "587a74fd60f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add avatar identity columns to profiles.
    op.add_column(
        "profiles",
        sa.Column(
            "avatar_preset",
            sa.String(length=32),
            nullable=False,
            server_default="ninja",
        ),
    )
    op.add_column(
        "profiles",
        sa.Column("equipped_frame", sa.String(length=64), nullable=True),
    )

    # Fix the stale equipped_theme server_default ('daylight' → 'royale').
    # No data change — registration has always written 'royale' explicitly.
    op.alter_column(
        "profiles",
        "equipped_theme",
        existing_type=sa.String(length=64),
        server_default="royale",
    )

    # New cosmetics ownership table (frames and future kinds; themes keep user_themes).
    op.create_table(
        "user_cosmetics",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("item_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column(
            "acquired_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "item_id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("user_cosmetics")

    # Restore the original equipped_theme server_default.
    op.alter_column(
        "profiles",
        "equipped_theme",
        existing_type=sa.String(length=64),
        server_default="daylight",
    )

    op.drop_column("profiles", "equipped_frame")
    op.drop_column("profiles", "avatar_preset")
