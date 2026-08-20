"""user_prompt_acks — one-time in-app prompt answers

Revision ID: 3b9f2c7a4e18
Revises: a3f4b5c6d7e8
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "3b9f2c7a4e18"
down_revision: str | Sequence[str] | None = "a3f4b5c6d7e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_prompt_acks",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("prompt_id", sa.String(length=32), nullable=False),
        sa.Column("outcome", sa.String(length=16), server_default="dismissed", nullable=False),
        sa.Column(
            "acked_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "prompt_id", name="pk_user_prompt_acks"),
    )


def downgrade() -> None:
    op.drop_table("user_prompt_acks")
