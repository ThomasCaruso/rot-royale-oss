"""daily_chest_claims: idempotent per-ET-day daily-mission chest claims

One row per (user_id, claim_date). The composite PK is the idempotency gate for the daily-mission
chest — a user can claim at most once per ET day. Because the coin ledger has no idempotency_key,
this row's existence is the source of truth for "already claimed"; grants are written only after the
row inserts (services/missions.py).

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-06-13 19:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e7f8a9b0c1d2"
down_revision: str | Sequence[str] | None = "d6e7f8a9b0c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "daily_chest_claims",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("claim_date", sa.Date(), nullable=False),
        sa.Column("coins_awarded", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("gems_awarded", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("reward_code", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "claim_date", name="pk_daily_chest_claims"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("daily_chest_claims")
