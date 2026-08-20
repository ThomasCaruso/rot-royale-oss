"""categories milestone: question difficulty enum + status + explanation

Widens the question schema so categories are central and content is review-gated:
- `difficulty` int -> enum question_difficulty (easy/medium/hard)
- `status` enum question_status (draft/approved/live), default 'draft'
- `explanation` text (nullable)
Only status='approved'/'live' rows are ever served. Existing rows were already served, so they are
backfilled to 'approved'.

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-06-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a2b3c4d5e6f7"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Create the enum types explicitly first (don't rely on alter_column to autocreate them).
    op.execute("CREATE TYPE question_difficulty AS ENUM ('easy', 'medium', 'hard')")
    op.execute("CREATE TYPE question_status AS ENUM ('draft', 'approved', 'live')")

    # 2) Convert difficulty int -> enum. Drop the integer server_default FIRST (Postgres can't cast
    #    default of `1` to the new type during the TYPE change), convert with a USING map, then set
    #    the new default.
    op.execute("ALTER TABLE questions ALTER COLUMN difficulty DROP DEFAULT")
    op.execute(
        "ALTER TABLE questions ALTER COLUMN difficulty TYPE question_difficulty "
        "USING (CASE difficulty "
        "WHEN 1 THEN 'easy' WHEN 2 THEN 'medium' WHEN 3 THEN 'hard' "
        "ELSE 'medium' END)::question_difficulty"
    )
    op.execute("ALTER TABLE questions ALTER COLUMN difficulty SET DEFAULT 'medium'")

    # 3) status: add with default 'draft', then backfill existing rows to 'approved' (they were
    #    already being served before review-gating existed).
    op.add_column(
        "questions",
        sa.Column(
            "status",
            sa.Enum("draft", "approved", "live", name="question_status", create_type=False),
            nullable=False,
            server_default=sa.text("'draft'"),
        ),
    )
    op.execute("UPDATE questions SET status = 'approved'")
    op.create_index("ix_questions_status", "questions", ["status"])

    # explanation: nullable review aid / post-answer reveal.
    op.add_column("questions", sa.Column("explanation", sa.Text(), nullable=True))

    # category gains an index (category filtering is now a hot path).
    op.create_index("ix_questions_category", "questions", ["category"])


def downgrade() -> None:
    op.drop_index("ix_questions_category", table_name="questions")
    op.drop_column("questions", "explanation")
    op.drop_index("ix_questions_status", table_name="questions")
    op.drop_column("questions", "status")

    op.execute("ALTER TABLE questions ALTER COLUMN difficulty DROP DEFAULT")
    op.execute(
        "ALTER TABLE questions ALTER COLUMN difficulty TYPE integer "
        "USING (CASE difficulty "
        "WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 WHEN 'hard' THEN 3 "
        "ELSE 1 END)"
    )
    op.execute("ALTER TABLE questions ALTER COLUMN difficulty SET DEFAULT 1")

    op.execute("DROP TYPE question_status")
    op.execute("DROP TYPE question_difficulty")
