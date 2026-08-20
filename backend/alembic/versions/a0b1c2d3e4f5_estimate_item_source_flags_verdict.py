"""estimate_item: source_id (upsert key) + flags (diagnostic) + playtest verdict capture

source_id is the content file's stable id ("fer_0001"), the upsert key for the estimate ingest and
the id used by the admin verdict/export paths; the PK stays a generated UUID. flags holds the
file's `_flags` diagnostic metadata (never runtime/client-facing). playtest_verdict/note/rated_at
are admin-write only, set through POST .../items/{id}/verdict, never ingested from the file.

Revision ID: a0b1c2d3e4f5
Revises: f9a0b1c2d3e4
Create Date: 2026-08-11 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a0b1c2d3e4f5"
down_revision: str | Sequence[str] | None = "f9a0b1c2d3e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "cognition"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "estimate_item",
        sa.Column("source_id", sa.String(length=64), nullable=True),
        schema=SCHEMA,
    )
    op.create_unique_constraint(
        "uq_estimate_item_source_id", "estimate_item", ["source_id"], schema=SCHEMA
    )
    op.add_column(
        "estimate_item",
        sa.Column("flags", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "estimate_item",
        sa.Column("playtest_verdict", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "estimate_item",
        sa.Column("playtest_note", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "estimate_item",
        sa.Column("playtest_rated_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("estimate_item", "playtest_rated_at", schema=SCHEMA)
    op.drop_column("estimate_item", "playtest_note", schema=SCHEMA)
    op.drop_column("estimate_item", "playtest_verdict", schema=SCHEMA)
    op.drop_column("estimate_item", "flags", schema=SCHEMA)
    op.drop_constraint("uq_estimate_item_source_id", "estimate_item", schema=SCHEMA, type_="unique")
    op.drop_column("estimate_item", "source_id", schema=SCHEMA)
