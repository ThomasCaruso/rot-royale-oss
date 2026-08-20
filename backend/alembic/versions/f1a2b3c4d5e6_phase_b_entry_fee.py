"""Phase B: contest_windows.entry_fee (money gate for cold-start bots)

entry_fee = 0 means a free contest (the only kind in v1). The cold-start bot field-fill is gated on
this: a paid / real-money contest (entry_fee > 0) never shows synthetic bots. The seam exists now so
bots can never leak into a money contest once money lands (mirrors the coin_ledger seam philosophy).

Revision ID: f1a2b3c4d5e6
Revises: e7c9a1b2d3f4
Create Date: 2026-06-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f1a2b3c4d5e6"
down_revision = "e7c9a1b2d3f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "contest_windows",
        sa.Column("entry_fee", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("contest_windows", "entry_fee")
