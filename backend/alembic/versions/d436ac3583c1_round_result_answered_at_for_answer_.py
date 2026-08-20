"""round_result answered_at for answer-time verification

Adds the per-round server timestamp the answer-time anti-cheat measures gaps against
(services/answer_timing.py). Nullable: existing rows predate it and never need it (they are already
scored history); every new play sets it explicitly. Hand-written to add only this column.

Revision ID: d436ac3583c1
Revises: 180cd7572826
Create Date: 2026-08-01 16:55:11.150868

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d436ac3583c1"
down_revision: str | Sequence[str] | None = "180cd7572826"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "round_results",
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("round_results", "answered_at")
