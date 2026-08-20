"""user_unlock_acks: once-only reveal ledger + permanent unlock high-water mark

Revision ID: a7b8c9d0e1f2
Revises: 5c402b74891e
Create Date: 2026-07-02 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7b8c9d0e1f2"
down_revision: str | Sequence[str] | None = "5c402b74891e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "user_unlock_acks",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("item_id", sa.String(length=64), nullable=False),
        sa.Column(
            "acked_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "item_id", name="pk_user_unlock_acks"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("user_unlock_acks")
