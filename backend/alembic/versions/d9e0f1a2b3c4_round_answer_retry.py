"""Daily Royale trivia second-chance: round_answers.retry (docs/architecture.md §11).

Pending retry state for a trivia round whose first pick was wrong — {choice, at}. NULL for a normal
one-shot round. Set when the retry is offered, cleared when the second pick resolves the round.

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-08-12 00:00:04.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "d9e0f1a2b3c4"
down_revision: str | Sequence[str] | None = "c8d9e0f1a2b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("round_answers", sa.Column("retry", JSONB(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("round_answers", "retry")
