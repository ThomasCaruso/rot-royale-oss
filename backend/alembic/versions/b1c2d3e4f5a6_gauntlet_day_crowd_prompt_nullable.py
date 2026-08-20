"""gauntlet_day.crowd_prompt_id → nullable (crowd dropped from the gauntlet rotation)

The gauntlet runs span → estimate → change_detection. Crowd was removed because it cannot score
honestly until there are hundreds of real responses per prompt (until then it scores against
fabricated seeds). The crowd module/endpoints/schema stay for standalone play; the gauntlet just no
longer pins a crowd prompt, so the column becomes nullable.

Revision ID: b1c2d3e4f5a6
Revises: a0b1c2d3e4f5
Create Date: 2026-08-12 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: str | Sequence[str] | None = "a0b1c2d3e4f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "cognition"


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        "gauntlet_day",
        "crowd_prompt_id",
        existing_type=sa.String(length=64),
        nullable=True,
        schema=SCHEMA,
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Backfill any NULLs before restoring NOT NULL (rows provisioned after crowd was dropped).
    op.execute(
        f"UPDATE {SCHEMA}.gauntlet_day SET crowd_prompt_id = '' WHERE crowd_prompt_id IS NULL"
    )
    op.alter_column(
        "gauntlet_day",
        "crowd_prompt_id",
        existing_type=sa.String(length=64),
        nullable=False,
        schema=SCHEMA,
    )
