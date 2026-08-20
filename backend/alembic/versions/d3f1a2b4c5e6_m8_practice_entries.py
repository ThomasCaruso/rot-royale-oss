"""M8 practice entries: nullable window_id + is_practice flag

Practice Mode (M8) reuses the entries/round_answers tables. A practice entry belongs to no contest
window, so window_id becomes nullable; is_practice flags it so it never enters standings/settlement.

Revision ID: d3f1a2b4c5e6
Revises: bc825787e710
Create Date: 2026-06-07
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d3f1a2b4c5e6"
down_revision = "bc825787e710"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "entries",
        sa.Column(
            "is_practice",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.alter_column("entries", "window_id", existing_type=sa.Uuid(), nullable=True)


def downgrade() -> None:
    # NB: any practice rows (window_id IS NULL) must be removed before window_id can be NOT NULL.
    op.execute("DELETE FROM entries WHERE window_id IS NULL")
    op.alter_column("entries", "window_id", existing_type=sa.Uuid(), nullable=False)
    op.drop_column("entries", "is_practice")
