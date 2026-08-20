"""retire the 'sigil' avatar preset — remap equipped ones to the default

The 'sigil' preset was removed from AVATAR_PRESETS (and identity.ts / cosmeticIds.json). Any profile
still equipping it would validate against a preset that no longer exists (the frontend already falls
back to the default, but the stored value should be clean), so remap those rows to the default
avatar. Data-only; idempotent (a no-op once no 'sigil' rows remain).

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-07-05 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2e3f4a5b6c7"
down_revision: str | Sequence[str] | None = "c1d2e3f4a5b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("UPDATE profiles SET avatar_preset = 'knight' WHERE avatar_preset = 'sigil'")


def downgrade() -> None:
    """Downgrade schema."""
    # The 'sigil' preset no longer exists; the remap is not reversible. No-op.
    pass
