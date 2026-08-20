"""cognition.gauntlet_day + cognition.gauntlet_run — the daily gauntlet

gauntlet_day snapshots the day's drawn content once at provisioning (unique per ET date) so a
mid-day content deploy can't split the field; gauntlet_run's unique (day, user) IS the
one-attempt-per-day rule, DB-enforced.

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-08-10 00:00:06.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e8f9a0b1c2d3"
down_revision: str | Sequence[str] | None = "d7e8f9a0b1c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "cognition"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "gauntlet_day",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("gauntlet_date", sa.Date(), nullable=False),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("estimate_item_id", sa.Uuid(), nullable=False),
        sa.Column("change_item_id", sa.Uuid(), nullable=False),
        sa.Column("crowd_prompt_id", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["estimate_item_id"], [f"{SCHEMA}.estimate_item.id"]),
        sa.ForeignKeyConstraint(["change_item_id"], [f"{SCHEMA}.change_item.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gauntlet_date", name="uq_gauntlet_day_date"),
        schema=SCHEMA,
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
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["gauntlet_day_id"], [f"{SCHEMA}.gauntlet_day.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["span_instance_id"], [f"{SCHEMA}.round_instance.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["estimate_instance_id"], [f"{SCHEMA}.round_instance.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["change_instance_id"], [f"{SCHEMA}.round_instance.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["crowd_instance_id"], [f"{SCHEMA}.round_instance.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gauntlet_day_id", "user_id", name="uq_gauntlet_run_day_user"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_cognition_gauntlet_run_gauntlet_day_id",
        "gauntlet_run",
        ["gauntlet_day_id"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_cognition_gauntlet_run_user_id",
        "gauntlet_run",
        ["user_id"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_cognition_gauntlet_run_user_id", table_name="gauntlet_run", schema=SCHEMA)
    op.drop_index(
        "ix_cognition_gauntlet_run_gauntlet_day_id", table_name="gauntlet_run", schema=SCHEMA
    )
    op.drop_table("gauntlet_run", schema=SCHEMA)
    op.drop_table("gauntlet_day", schema=SCHEMA)
