"""native push (APNs device tokens) + per-user notification gate

Extends push_subscriptions to carry BOTH transports:
  - web-push: endpoint (+ p256dh/auth), platform='web'
  - native:   device_token, platform='ios'|'android'
The web-push columns become nullable (native rows have none); device_token gets a
partial-unique index (one row per token). A `platform` column defaults to 'web' so
existing rows are unchanged.

Adds `user_notifications` — the exactly-once gate for per-user daily nudges (one row
per user/date/kind), mirroring window_notifications' claim-first discipline.

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
Create Date: 2026-07-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e9f0a1b2c3d4"
down_revision: str | None = "d8e9f0a1b2c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "push_subscriptions",
        sa.Column("platform", sa.String(length=16), nullable=False, server_default="web"),
    )
    op.add_column("push_subscriptions", sa.Column("device_token", sa.Text(), nullable=True))
    # Web-push fields are absent on native rows.
    op.alter_column("push_subscriptions", "endpoint", existing_type=sa.Text(), nullable=True)
    op.alter_column("push_subscriptions", "p256dh", existing_type=sa.String(255), nullable=True)
    op.alter_column("push_subscriptions", "auth", existing_type=sa.String(255), nullable=True)
    op.create_index(
        "uq_push_device_token",
        "push_subscriptions",
        ["device_token"],
        unique=True,
        postgresql_where=sa.text("device_token IS NOT NULL"),
    )

    op.create_table(
        "user_notifications",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("notify_date", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "notify_date", "kind"),
    )


def downgrade() -> None:
    op.drop_table("user_notifications")
    op.drop_index("uq_push_device_token", table_name="push_subscriptions")
    op.alter_column("push_subscriptions", "auth", existing_type=sa.String(255), nullable=False)
    op.alter_column("push_subscriptions", "p256dh", existing_type=sa.String(255), nullable=False)
    op.alter_column("push_subscriptions", "endpoint", existing_type=sa.Text(), nullable=False)
    op.drop_column("push_subscriptions", "device_token")
    op.drop_column("push_subscriptions", "platform")
