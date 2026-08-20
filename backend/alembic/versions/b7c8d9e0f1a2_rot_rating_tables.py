"""Rot Rating tables (Glicko-2 sharpness rating, CLAUDE.md §5e).

Parallel to the placement Elo on profiles (never merged). Per-verb sub-ratings +
a derived headline snapshot per user, and a shared difficulty-rating pool keyed by
a resolvable string ("estimate:hard", later "estimate:item:<uuid>").

Revision ID: b7c8d9e0f1a2
Revises: d3e4f5a6b7c8
Create Date: 2026-08-12 00:00:02.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7c8d9e0f1a2"
down_revision: str | Sequence[str] | None = "d3e4f5a6b7c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "rot_sub_ratings",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("verb", sa.String(length=16), nullable=False),
        sa.Column("rating", sa.Float(), nullable=False),
        sa.Column("rd", sa.Float(), nullable=False),
        sa.Column("vol", sa.Float(), nullable=False),
        sa.Column("rounds", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "verb"),
    )
    op.create_table(
        "rot_ratings",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("rating", sa.Float(), nullable=False),
        sa.Column("rd", sa.Float(), nullable=False),
        sa.Column("provisional", sa.Boolean(), nullable=False),
        sa.Column("rounds_played", sa.Integer(), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "rot_difficulty_ratings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("verb", sa.String(length=16), nullable=False),
        sa.Column("rating", sa.Float(), nullable=False),
        sa.Column("rd", sa.Float(), nullable=False),
        sa.Column("vol", sa.Float(), nullable=False),
        sa.Column("games", sa.Integer(), nullable=False),
        sa.Column("fixed", sa.Boolean(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("rot_difficulty_ratings")
    op.drop_table("rot_ratings")
    op.drop_table("rot_sub_ratings")
