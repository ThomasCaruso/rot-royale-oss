"""streak grace — free weekly streak-freeze

Adds profiles.streak_grace_used_date: the ET contest-date on which the player's
free weekly streak-grace was last consumed. Grace is available again once that
date falls in an earlier ISO week than the current contest date. Nullable — a
player who has never used grace has NULL (always available).

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-07-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d8e9f0a1b2c3"
down_revision: str | None = "c7d8e9f0a1b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("profiles", sa.Column("streak_grace_used_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("profiles", "streak_grace_used_date")
