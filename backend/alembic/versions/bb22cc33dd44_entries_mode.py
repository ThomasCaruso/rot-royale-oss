"""entries.mode — which play mode created a practice entry

Nullable String(16): "practice" | "quick" | "category" | "starter" (set by start_practice);
NULL for ranked/duel/legacy rows. Lets the Brain Boost surface find "today's check" (the latest
submitted quick/starter entry on the ET date) without guessing from round counts.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bb22cc33dd44"
down_revision: str | Sequence[str] | None = "aa11bb22cc33"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("entries", sa.Column("mode", sa.String(length=16), nullable=True))
    op.create_index(op.f("ix_entries_mode"), "entries", ["mode"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_entries_mode"), table_name="entries")
    op.drop_column("entries", "mode")
