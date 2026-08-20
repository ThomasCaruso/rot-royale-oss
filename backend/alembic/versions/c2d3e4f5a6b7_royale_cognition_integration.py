"""Daily Royale × cognition integration: window round_plan pin, entry scoring_version, and
binding a cognition round_instance to (entry_id, round_idx).

- contest_windows.round_plan (jsonb, nullable): the day's pinned round plan (type sequence +
  cognition content refs). NULL = a legacy/trivia-only window that uses the unchanged build path.
- entries.scoring_version (int, nullable): stamped on Royale entries that contain cognition rounds
  so historical leaderboards stay distinguishable. NULL = legacy trivia-only entry.
- cognition.round_instance.entry_id / round_idx: bind an INTERACTIVE Royale round's instance to its
  (entry, round index). The unique constraint means a round maps to exactly one instance (no
  replay for a better result) and an instance started outside a Royale can't be submitted into one.

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-08-12 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c2d3e4f5a6b7"
down_revision: str | Sequence[str] | None = "b1c2d3e4f5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COG = "cognition"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "contest_windows",
        sa.Column("round_plan", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column("entries", sa.Column("scoring_version", sa.Integer(), nullable=True))

    op.add_column(
        "round_instance",
        sa.Column("entry_id", sa.Uuid(), nullable=True),
        schema=COG,
    )
    op.add_column(
        "round_instance",
        sa.Column("round_idx", sa.Integer(), nullable=True),
        schema=COG,
    )
    op.create_foreign_key(
        "fk_round_instance_entry_id",
        "round_instance",
        "entries",
        ["entry_id"],
        ["id"],
        source_schema=COG,
        referent_schema=None,
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_round_instance_entry_round",
        "round_instance",
        ["entry_id", "round_idx"],
        schema=COG,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "uq_round_instance_entry_round", "round_instance", schema=COG, type_="unique"
    )
    op.drop_constraint(
        "fk_round_instance_entry_id", "round_instance", schema=COG, type_="foreignkey"
    )
    op.drop_column("round_instance", "round_idx", schema=COG)
    op.drop_column("round_instance", "entry_id", schema=COG)
    op.drop_column("entries", "scoring_version")
    op.drop_column("contest_windows", "round_plan")
