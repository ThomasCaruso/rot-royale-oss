"""Rot Rating difficulty-convergence exactly-once marker (CLAUDE.md §5e).

One row per converged ET date. The daily difficulty batch is NOT idempotent (per-difficulty game
counts accumulate), so it claims the day via INSERT ... ON CONFLICT DO NOTHING on this table's PK —
a redundant daemon/cron fire is then a safe no-op.

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-08-12 00:00:03.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8d9e0f1a2b3"
down_revision: str | Sequence[str] | None = "b7c8d9e0f1a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "rot_difficulty_batches",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column(
            "converged_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("day"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("rot_difficulty_batches")
