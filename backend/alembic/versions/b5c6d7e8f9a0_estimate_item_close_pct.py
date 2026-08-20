"""estimate_item.close_pct — split the proximity band from the correctness threshold

acceptable_pct stays the correctness threshold (20/30/40 by difficulty); close_pct is the
proximity band a wrong guess is judged against ("close" within it, "far" beyond). NULL means
2× acceptable_pct (40/60/80), applied in code — a near-miss should feel different from a wild
miss.

Revision ID: b5c6d7e8f9a0
Revises: f3c4d5e6a7b8
Create Date: 2026-08-10 00:00:03.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5c6d7e8f9a0"
down_revision: str | Sequence[str] | None = "f3c4d5e6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "cognition"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "estimate_item",
        sa.Column("close_pct", sa.Numeric(precision=6, scale=3), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("estimate_item", "close_pct", schema=SCHEMA)
