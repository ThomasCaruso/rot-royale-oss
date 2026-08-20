"""question_translations: localized bank content

Revision ID: 0dca7627f74d
Revises: a82f7d37047f
Create Date: 2026-07-30 13:22:23.305296

Hand-trimmed. Autogenerate additionally proposed dropping `profiles.invite_code`,
`duel_matches.rival_rating`, `duel_user_stats.duel_rating`, the `referrals` /
`challenge_participations` / `challenge_first_beats` tables and several unique indexes. Those are
NOT drift this migration should act on — they exist in the local dev DB from an orphaned migration
lineage (revision d2f3a4b5c6e7, whose file is no longer in alembic/versions) and have no ORM models.
Dropping them here would destroy data on any environment that does have them. This migration creates
one table and nothing else.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0dca7627f74d"
down_revision: str | Sequence[str] | None = "a82f7d37047f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the localized-question table. English stays canonical in `questions.payload`."""
    op.create_table(
        "question_translations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("locale", sa.Enum("es", "fr", "tr", name="translation_locale"), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("draft", "approved", "rejected", name="translation_status"),
            server_default=sa.text("'draft'"),
            nullable=False,
        ),
        sa.Column(
            "source",
            sa.Enum("machine", "human", name="translation_source"),
            server_default=sa.text("'machine'"),
            nullable=False,
        ),
        sa.Column(
            "flags",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("question_id", "locale", name="uq_question_translation_locale"),
    )
    op.create_index(
        "ix_question_translations_locale_status",
        "question_translations",
        ["locale", "status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_question_translations_question_id"),
        "question_translations",
        ["question_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_question_translations_status"), "question_translations", ["status"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_question_translations_status"), table_name="question_translations")
    op.drop_index(op.f("ix_question_translations_question_id"), table_name="question_translations")
    op.drop_index("ix_question_translations_locale_status", table_name="question_translations")
    op.drop_table("question_translations")
    # Enums are created implicitly by create_table; drop them so a re-upgrade doesn't collide.
    for enum in ("translation_locale", "translation_status", "translation_source"):
        op.execute(sa.text(f"DROP TYPE IF EXISTS {enum}"))
