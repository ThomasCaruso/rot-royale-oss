"""cognition.round_instance.scoring_version

Added BEFORE any cognition score reaches a shared leaderboard, so v1 and v2 scores can never be
silently mixed: rows that predate the column backfill to 1 via the server default; the service
stamps every new cognition round 2 (services/cognition.py::COGNITION_SCORING_VERSION).

Revision ID: e2b3c4d5f6a7
Revises: e1f2a3b4c5d6
Create Date: 2026-08-10 00:00:01.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2b3c4d5f6a7"
down_revision: str | Sequence[str] | None = "e1f2a3b4c5d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "cognition"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "round_instance",
        sa.Column("scoring_version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        schema=SCHEMA,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("round_instance", "scoring_version", schema=SCHEMA)
