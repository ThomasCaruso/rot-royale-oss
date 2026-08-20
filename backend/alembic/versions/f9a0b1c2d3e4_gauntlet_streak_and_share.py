"""cognition.gauntlet_streak + gauntlet_run.streak_after — streak & share payload

Streak: +1 per completed gauntlet on consecutive ET days, reset on a missed day, no grace.
streak_after freezes the streak on the run at completion so a share rendered days later shows the
streak the result earned, not today's.

Revision ID: f9a0b1c2d3e4
Revises: e8f9a0b1c2d3
Create Date: 2026-08-10 00:00:07.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f9a0b1c2d3e4"
down_revision: str | Sequence[str] | None = "e8f9a0b1c2d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "cognition"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "gauntlet_streak",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("current_streak", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("best_streak", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_completed_date", sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
        schema=SCHEMA,
    )
    op.add_column(
        "gauntlet_run",
        sa.Column("streak_after", sa.Integer(), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("gauntlet_run", "streak_after", schema=SCHEMA)
    op.drop_table("gauntlet_streak", schema=SCHEMA)
