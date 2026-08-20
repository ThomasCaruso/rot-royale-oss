"""reconcile legacy seed categories into the canonical six

Folds the nine legacy placeholder-seed categories into the locked canonical set so the picker shows
exactly six (no near-duplicates / leftovers):
  Science, Nature, Numbers   -> Science & Nature
  Music, Language            -> Arts & Literature
  Pop Culture                -> Pop Culture & Entertainment
  Geography, History, Sports -> unchanged (already canonical)

Idempotent: after one run no legacy categories remain, so re-running is a no-op. The merge is lossy,
so downgrade cannot recover the original sub-categories (intentional no-op).

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-06-09
"""

from __future__ import annotations

from alembic import op

revision = "b3c4d5e6f7a8"
down_revision = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE questions SET category = 'Science & Nature' "
        "WHERE category IN ('Science', 'Nature', 'Numbers')"
    )
    op.execute(
        "UPDATE questions SET category = 'Arts & Literature' "
        "WHERE category IN ('Music', 'Language')"
    )
    op.execute(
        "UPDATE questions SET category = 'Pop Culture & Entertainment' "
        "WHERE category = 'Pop Culture'"
    )


def downgrade() -> None:
    # The fold is lossy (three legacy categories collapsed into 'Science & Nature', two into
    # 'Arts & Literature'); the originals can't be recovered. No-op.
    pass
