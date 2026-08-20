"""add hot-path indexes

Three read-path indexes for queries that run on every screen open (audited 2026-08-06):

- coin_ledger (user_id, created_at): the campaign daily-coin-cap sum, run on every ladder load
  and level completion, scanned a user's whole ledger history.
- entries (window_id, total_score): the leaderboard field query's top-N sort and rank counts had
  only the plain window_id index to work with.
- profiles (rating): /me computes global rank as COUNT(*) WHERE rating > mine on every bootstrap;
  this was a sequential scan.

Trimmed from autogenerate output, which (as usual) also proposed unrelated drops of partial
unique indexes and legacy columns — those are deliberately NOT included.

Revision ID: 48c0ea92d1d8
Revises: d436ac3583c1
Create Date: 2026-08-06 09:50:31.049289

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "48c0ea92d1d8"
down_revision: str | Sequence[str] | None = "d436ac3583c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(
        "ix_coin_ledger_user_created", "coin_ledger", ["user_id", "created_at"], unique=False
    )
    op.create_index(
        "ix_entries_window_score", "entries", ["window_id", "total_score"], unique=False
    )
    op.create_index(op.f("ix_profiles_rating"), "profiles", ["rating"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_profiles_rating"), table_name="profiles")
    op.drop_index("ix_entries_window_score", table_name="entries")
    op.drop_index("ix_coin_ledger_user_created", table_name="coin_ledger")
