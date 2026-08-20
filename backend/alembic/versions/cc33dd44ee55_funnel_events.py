"""funnel_events — append-only onboarding-conversion analytics

Tiny write-once rows (event name + optional user + source + timestamp). user_id is nullable —
the top of the funnel (intro viewed, start check clicked) happens before any account exists.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cc33dd44ee55"
down_revision: str | Sequence[str] | None = "bb22cc33dd44"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "funnel_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("event", sa.String(length=40), nullable=False),
        sa.Column("source", sa.String(length=24), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_funnel_events_user_id"), "funnel_events", ["user_id"], unique=False)
    op.create_index(op.f("ix_funnel_events_event"), "funnel_events", ["event"], unique=False)
    op.create_index(
        op.f("ix_funnel_events_created_at"), "funnel_events", ["created_at"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_funnel_events_created_at"), table_name="funnel_events")
    op.drop_index(op.f("ix_funnel_events_event"), table_name="funnel_events")
    op.drop_index(op.f("ix_funnel_events_user_id"), table_name="funnel_events")
    op.drop_table("funnel_events")
