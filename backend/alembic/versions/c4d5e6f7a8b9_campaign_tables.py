"""campaign tables: campaign_sessions + user_campaign_progress

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-06-09 16:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4d5e6f7a8b9"
down_revision: str | Sequence[str] | None = "b3c4d5e6f7a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "campaign_sessions",
        sa.Column("entry_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("world", sa.String(length=32), nullable=False),
        sa.Column("level_number", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["entry_id"], ["entries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("entry_id"),
    )
    op.create_index(
        op.f("ix_campaign_sessions_user_id"), "campaign_sessions", ["user_id"], unique=False
    )
    op.create_table(
        "user_campaign_progress",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("world", sa.String(length=32), nullable=False),
        sa.Column("level_number", sa.Integer(), nullable=False),
        sa.Column("best_correct", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("clear_status", sa.String(length=16), nullable=True),
        sa.Column(
            "first_clear_claimed", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("times_cleared", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint(
            "user_id", "world", "level_number", name="pk_user_campaign_progress"
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("user_campaign_progress")
    op.drop_index(op.f("ix_campaign_sessions_user_id"), table_name="campaign_sessions")
    op.drop_table("campaign_sessions")
