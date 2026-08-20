"""M9 web push: push_subscriptions + window_notifications

push_subscriptions: per-browser Web Push endpoint + keys (endpoint globally unique).
window_notifications: one row per window = the exactly-once 'window open' push gate.

Revision ID: e7c9a1b2d3f4
Revises: d3f1a2b4c5e6
Create Date: 2026-06-07
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e7c9a1b2d3f4"
down_revision = "d3f1a2b4c5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.String(length=255), nullable=False),
        sa.Column("auth", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint", name="uq_push_endpoint"),
    )
    op.create_index(
        op.f("ix_push_subscriptions_user_id"), "push_subscriptions", ["user_id"], unique=False
    )
    op.create_table(
        "window_notifications",
        sa.Column("window_id", sa.Uuid(), nullable=False),
        sa.Column(
            "sent_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["window_id"], ["contest_windows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("window_id"),
    )


def downgrade() -> None:
    op.drop_table("window_notifications")
    op.drop_index(op.f("ix_push_subscriptions_user_id"), table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
