"""coin_ledger idempotency_key (parity with gem_ledger)

Adds an idempotency_key column + PARTIAL unique index (non-null keys only) to coin_ledger, so a
one-time coin grant (e.g. a streak-milestone reward) inserts at most one row even if settlement is
ever re-run for a window — matching the once-guarantee the gem ledger already has.

Revision ID: c1d2e3f4a5b6
Revises: f0a1b2c3d4e5
Create Date: 2026-07-05 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c1d2e3f4a5b6"
down_revision: str | Sequence[str] | None = "f0a1b2c3d4e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "coin_ledger",
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
    )
    # Partial unique index: at most one row per non-null idempotency_key (one-time grant guarantee).
    op.create_index(
        "uq_coin_ledger_idempotency",
        "coin_ledger",
        ["idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_coin_ledger_idempotency", table_name="coin_ledger")
    op.drop_column("coin_ledger", "idempotency_key")
