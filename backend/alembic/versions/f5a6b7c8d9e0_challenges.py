"""Challenge snapshots (viral share loop) — the `challenges` table.

A shareable, spoiler-free snapshot of one finished Daily-Royale entry (see models/challenge.py).
Display metadata only (handle/score/provisional place-field) — never questions or answers.

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-07-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "f5a6b7c8d9e0"
down_revision = "e4f5a6b7c8d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "challenges",
        sa.Column("id", sa.String(length=16), nullable=False),
        sa.Column("entry_id", sa.Uuid(), nullable=False),
        sa.Column("creator_user_id", sa.Uuid(), nullable=False),
        sa.Column("window_id", sa.Uuid(), nullable=False),
        sa.Column("contest_date", sa.Date(), nullable=False),
        sa.Column("contest_no", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=32), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("place", sa.Integer(), nullable=True),
        sa.Column("field_size", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["entry_id"], ["entries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["creator_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["window_id"], ["contest_windows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("entry_id", name="uq_challenge_entry"),
    )
    op.create_index(
        op.f("ix_challenges_creator_user_id"),
        "challenges",
        ["creator_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_challenges_creator_user_id"), table_name="challenges")
    op.drop_table("challenges")
