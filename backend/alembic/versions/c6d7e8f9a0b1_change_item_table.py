"""cognition.change_item — change-detection image pairs from the asset manifest

Bounding boxes are stored in NORMALIZED 0–1 image coordinates and tap tolerance is a fraction of
image dimension, so screen size never changes difficulty. Content lands via the manifest ingest
(content/change_manifest.py); URLs are stubs until real image pairs arrive.

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
Create Date: 2026-08-10 00:00:04.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c6d7e8f9a0b1"
down_revision: str | Sequence[str] | None = "b5c6d7e8f9a0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "cognition"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "change_item",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("base_url", sa.Text(), nullable=False),
        sa.Column("altered_url", sa.Text(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("bbox_x", sa.Numeric(precision=8, scale=6), nullable=False),
        sa.Column("bbox_y", sa.Numeric(precision=8, scale=6), nullable=False),
        sa.Column("bbox_w", sa.Numeric(precision=8, scale=6), nullable=False),
        sa.Column("bbox_h", sa.Numeric(precision=8, scale=6), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_change_item_key"),
        schema=SCHEMA,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("change_item", schema=SCHEMA)
