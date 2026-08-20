"""personalization: question_ai_metadata, user_taste_profiles, question_interaction_events

LLM question classification (batch-written), silently learned user taste profiles, and
append-only gameplay interaction events. Personalization-only tables — nothing here feeds
scores/coins/rating/standings.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "aa11bb22cc33"
down_revision: str | Sequence[str] | None = "b8c9d0e1f2a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "question_ai_metadata",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("subcategory", sa.String(length=64), nullable=True),
        sa.Column(
            "topic_tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "audience_tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "related_topics",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("difficulty_score", sa.Float(), nullable=False),
        sa.Column("knowledge_type", sa.String(length=32), nullable=False),
        sa.Column("freshness_type", sa.String(length=32), nullable=False),
        sa.Column("humor_score", sa.Float(), nullable=False),
        sa.Column("brainrot_score", sa.Float(), nullable=False),
        sa.Column("educational_score", sa.Float(), nullable=False),
        sa.Column("controversy_risk", sa.Float(), nullable=False),
        sa.Column("ambiguity_risk", sa.Float(), nullable=False),
        sa.Column("quality_score", sa.Float(), nullable=False),
        sa.Column("llm_confidence", sa.Float(), nullable=False),
        sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("model_name", sa.String(length=128), nullable=True),
        sa.Column("provider_name", sa.String(length=64), nullable=True),
        sa.Column("raw_llm_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("classification_version", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("question_id", name="uq_question_ai_metadata_question"),
    )
    op.create_index(
        op.f("ix_question_ai_metadata_question_id"),
        "question_ai_metadata",
        ["question_id"],
        unique=False,
    )

    op.create_table(
        "user_taste_profiles",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "category_affinity",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "subcategory_affinity",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "topic_affinity",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "difficulty_preference", sa.Float(), nullable=False, server_default=sa.text("0.5")
        ),
        sa.Column("humor_preference", sa.Float(), nullable=False, server_default=sa.text("0.5")),
        sa.Column("brainrot_tolerance", sa.Float(), nullable=False, server_default=sa.text("0.5")),
        sa.Column("novelty_preference", sa.Float(), nullable=False, server_default=sa.text("0.5")),
        sa.Column(
            "educational_preference", sa.Float(), nullable=False, server_default=sa.text("0.5")
        ),
        sa.Column(
            "disliked_topics",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "weak_but_interesting_topics",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "last_seen_topic_tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "last_seen_categories",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("interaction_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("confidence_score", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )

    op.create_table(
        "question_interaction_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=True),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("selected_answer", sa.Integer(), nullable=True),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
        sa.Column("response_ms", sa.Integer(), nullable=True),
        sa.Column("timed_out", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("quit_after", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "explanation_opened", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("explanation_read_ms", sa.Integer(), nullable=True),
        sa.Column("shared_after", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("replayed_after", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("streak_before", sa.Integer(), nullable=True),
        sa.Column("streak_after", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_question_interaction_events_question_id"),
        "question_interaction_events",
        ["question_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_question_interaction_events_user_id"),
        "question_interaction_events",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        op.f("ix_question_interaction_events_user_id"), table_name="question_interaction_events"
    )
    op.drop_index(
        op.f("ix_question_interaction_events_question_id"),
        table_name="question_interaction_events",
    )
    op.drop_table("question_interaction_events")
    op.drop_table("user_taste_profiles")
    op.drop_index(op.f("ix_question_ai_metadata_question_id"), table_name="question_ai_metadata")
    op.drop_table("question_ai_metadata")
