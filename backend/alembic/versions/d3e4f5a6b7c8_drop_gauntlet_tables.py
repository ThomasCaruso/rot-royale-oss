"""Drop the standalone gauntlet tables.

The daily gauntlet was removed as a player-facing surface — its sequencing/pinning/share-grid logic
moved into the Daily Royale (services/royale_sequencing + services/royale_rounds), which is now the
single daily competitive object. gauntlet_run / gauntlet_day / gauntlet_streak are unused.

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-08-12 00:00:01.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3e4f5a6b7c8"
down_revision: str | Sequence[str] | None = "c2d3e4f5a6b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COG = "cognition"


def upgrade() -> None:
    """Upgrade schema."""
    # gauntlet_run references gauntlet_day + round_instance, so drop it first.
    op.drop_table("gauntlet_run", schema=COG)
    op.drop_table("gauntlet_streak", schema=COG)
    op.drop_table("gauntlet_day", schema=COG)


def downgrade() -> None:
    """Downgrade schema — recreate the (now unused) gauntlet tables."""
    op.create_table(
        "gauntlet_day",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("gauntlet_date", sa.Date(), nullable=False),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("estimate_item_id", sa.Uuid(), nullable=False),
        sa.Column("change_item_id", sa.Uuid(), nullable=False),
        sa.Column("crowd_prompt_id", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["estimate_item_id"], [f"{COG}.estimate_item.id"]),
        sa.ForeignKeyConstraint(["change_item_id"], [f"{COG}.change_item.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gauntlet_date", name="uq_gauntlet_day_date"),
        schema=COG,
    )
    op.create_table(
        "gauntlet_streak",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("current_streak", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("best_streak", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_completed_date", sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
        schema=COG,
    )
    op.create_table(
        "gauntlet_run",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("gauntlet_day_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "state", sa.String(length=16), nullable=False, server_default=sa.text("'active'")
        ),
        sa.Column("stage", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("span_instance_id", sa.Uuid(), nullable=True),
        sa.Column("estimate_instance_id", sa.Uuid(), nullable=True),
        sa.Column("change_instance_id", sa.Uuid(), nullable=True),
        sa.Column("crowd_instance_id", sa.Uuid(), nullable=True),
        sa.Column("composite_score", sa.Integer(), nullable=True),
        sa.Column("streak_after", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["gauntlet_day_id"], [f"{COG}.gauntlet_day.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gauntlet_day_id", "user_id", name="uq_gauntlet_run_day_user"),
        schema=COG,
    )
