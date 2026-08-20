"""coin_ledger ref_key for string-keyed references

Revision ID: 587a74fd60f6
Revises: c4d5e6f7a8b9
Create Date: 2026-06-10 00:37:36.032080

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "587a74fd60f6"
down_revision: str | Sequence[str] | None = "c4d5e6f7a8b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("coin_ledger", sa.Column("ref_key", sa.String(length=64), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("coin_ledger", "ref_key")
