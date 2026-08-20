"""Change-detection items carry an authored difficulty (easy | medium | hard).

Two things depended on this and silently could not work: the Royale draw had no way to open on an
easy pair and close on a hard one, and Rot Rating banded every change round as `notice:medium`
(the band is read from the round's `server_answer["difficulty"]`, which change detection never
set) — so the `notice` sub-rating could not distinguish a gimme from a needle in a haystack.

NULL means unbanded and is treated as medium, so existing rows stay valid.

Revision ID: a3f4b5c6d7e8
Revises: e0f1a2b3c4d5
Create Date: 2026-08-13 00:00:01.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3f4b5c6d7e8"
down_revision: str | Sequence[str] | None = "e0f1a2b3c4d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "change_item",
        sa.Column("difficulty", sa.String(length=16), nullable=True),
        schema="cognition",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("change_item", "difficulty", schema="cognition")
