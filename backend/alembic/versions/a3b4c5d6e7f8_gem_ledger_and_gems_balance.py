"""gem ledger + profiles.gems_balance (the scarce second currency)

Adds the gems_balance cache column on profiles and the append-only gem_ledger table (a parallel
mirror of coin_ledger). gem_ledger additionally carries an idempotency_key with a PARTIAL unique
index (non-null keys only) so a one-time gem grant inserts at most one row — the once-guarantee.

Revision ID: a3b4c5d6e7f8
Revises: f3a4b5c6d7e8
Create Date: 2026-06-11 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3b4c5d6e7f8"
down_revision: str | Sequence[str] | None = "f3a4b5c6d7e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "profiles",
        sa.Column("gems_balance", sa.BigInteger(), nullable=False, server_default="0"),
    )

    op.create_table(
        "gem_ledger",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("delta", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.String(length=64), nullable=False),
        sa.Column("ref_type", sa.String(length=64), nullable=True),
        sa.Column("ref_id", sa.Uuid(), nullable=True),
        sa.Column("ref_key", sa.String(length=128), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("balance_after", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_gem_ledger_user_id", "gem_ledger", ["user_id"], unique=False)
    # Partial unique index: at most one row per non-null idempotency_key (one-time grant guarantee).
    op.create_index(
        "uq_gem_ledger_idempotency",
        "gem_ledger",
        ["idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_gem_ledger_idempotency", table_name="gem_ledger")
    op.drop_index("ix_gem_ledger_user_id", table_name="gem_ledger")
    op.drop_table("gem_ledger")
    op.drop_column("profiles", "gems_balance")
