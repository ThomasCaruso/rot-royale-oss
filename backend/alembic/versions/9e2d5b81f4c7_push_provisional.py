"""push_subscriptions.provisional — quiet iOS registration is reach, not consent

Revision ID: 9e2d5b81f4c7
Revises: 7c1e4a92d6b3
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9e2d5b81f4c7"
down_revision: str | Sequence[str] | None = "7c1e4a92d6b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "push_subscriptions",
        sa.Column("provisional", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("push_subscriptions", "provisional")
