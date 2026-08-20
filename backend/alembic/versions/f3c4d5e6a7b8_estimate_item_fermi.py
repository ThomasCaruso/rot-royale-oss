"""estimate_item goes Fermi: components / reveal_explanation / intuition_note / difficulty /
acceptable_pct (replaces close_threshold_pct)

Estimation questions are now Fermi-style — answers DERIVED from 2–3 everyday quantities, not fact
recall. The table has never carried content (created earlier in this same feature branch of work),
so the column swap is loss-free; server defaults exist only so the ALTERs stay valid should any
environment have rows.

Revision ID: f3c4d5e6a7b8
Revises: e2b3c4d5f6a7
Create Date: 2026-08-10 00:00:02.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "f3c4d5e6a7b8"
down_revision: str | Sequence[str] | None = "e2b3c4d5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "cognition"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "estimate_item",
        sa.Column(
            "components",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "estimate_item",
        sa.Column("reveal_explanation", sa.Text(), nullable=False, server_default=sa.text("''")),
        schema=SCHEMA,
    )
    op.add_column(
        "estimate_item",
        sa.Column("intuition_note", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "estimate_item",
        sa.Column(
            "difficulty", sa.String(length=20), nullable=False, server_default=sa.text("'direct'")
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "estimate_item",
        sa.Column(
            "acceptable_pct",
            sa.Numeric(precision=6, scale=3),
            nullable=False,
            server_default=sa.text("20"),
        ),
        schema=SCHEMA,
    )
    op.drop_column("estimate_item", "close_threshold_pct", schema=SCHEMA)


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "estimate_item",
        sa.Column(
            "close_threshold_pct",
            sa.Numeric(precision=6, scale=3),
            nullable=False,
            server_default=sa.text("10"),
        ),
        schema=SCHEMA,
    )
    op.drop_column("estimate_item", "acceptable_pct", schema=SCHEMA)
    op.drop_column("estimate_item", "difficulty", schema=SCHEMA)
    op.drop_column("estimate_item", "intuition_note", schema=SCHEMA)
    op.drop_column("estimate_item", "reveal_explanation", schema=SCHEMA)
    op.drop_column("estimate_item", "components", schema=SCHEMA)
