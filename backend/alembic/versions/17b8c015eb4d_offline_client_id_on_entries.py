"""offline_client_id on entries

Revision ID: 17b8c015eb4d
Revises: f5a6b7c8d9e0
Create Date: 2026-07-11 17:00:24.545722

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "17b8c015eb4d"
down_revision: str | Sequence[str] | None = "f5a6b7c8d9e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("entries", sa.Column("offline_client_id", sa.String(length=64), nullable=True))
    op.create_index(
        "uq_entries_offline_client_id",
        "entries",
        ["offline_client_id"],
        unique=True,
        postgresql_where=sa.text("offline_client_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_entries_offline_client_id", table_name="entries")
    op.drop_column("entries", "offline_client_id")
