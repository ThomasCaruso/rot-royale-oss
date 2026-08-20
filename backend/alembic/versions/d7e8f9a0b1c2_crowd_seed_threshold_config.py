"""crowd round_type config: seed_threshold default 300

The response-count threshold below which crowd scoring uses the seeded distribution is DATA
(round_type.config), not code. Set high enough that "live" means live — a few hundred responses
per prompt, not a few dozen. The merge keeps any value an operator already set (existing config
keys win over the default being added here).

Revision ID: d7e8f9a0b1c2
Revises: c6d7e8f9a0b1
Create Date: 2026-08-10 00:00:05.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7e8f9a0b1c2"
down_revision: str | Sequence[str] | None = "c6d7e8f9a0b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "cognition"


def upgrade() -> None:
    """Upgrade schema."""
    # jsonb || : right side wins, so putting the default on the LEFT preserves any existing value.
    op.execute(
        f"""
        UPDATE {SCHEMA}.round_type
        SET config = '{{"seed_threshold": 300}}'::jsonb || config
        WHERE key = 'crowd'
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(
        f"""
        UPDATE {SCHEMA}.round_type
        SET config = config - 'seed_threshold'
        WHERE key = 'crowd'
        """
    )
