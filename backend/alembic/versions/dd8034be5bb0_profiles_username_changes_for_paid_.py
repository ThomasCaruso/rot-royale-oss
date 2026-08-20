"""profiles.username_changes for paid handle changes

Revision ID: dd8034be5bb0
Revises: b41c9e07d3aa
Create Date: 2026-07-30

Hand-trimmed. Autogenerate additionally proposed dropping `uq_coin_ledger_idempotency`,
`uq_gem_ledger_idempotency`, `uq_entries_offline_client_id`, `ix_profiles_invite_code`,
`profiles.invite_code`, `duel_matches.rival_rating` and `duel_user_stats.duel_rating`. Those are
pre-existing drift from an orphaned migration lineage (see revision 0dca7627f74d) — and several are
real uniqueness/idempotency guarantees whose removal would allow double-spends. This migration adds
one column and nothing else.

Existing rows default to 0, which correctly grants every current player their one free change.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dd8034be5bb0"
down_revision: str | Sequence[str] | None = "b41c9e07d3aa"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column("username_changes", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("profiles", "username_changes")
