"""cognition schema: round_type / round_instance / attempt / span_result / crowd_response /
estimate_item

Foundation for the four cognitive round types (span, estimate, change_detection, crowd) and the
daily gauntlet. Lives in its own `cognition` Postgres schema; existing question/trivia/contest
tables are untouched. Seeds one round_type registry row per module (config carries per-type
tunables so they are data, not constants — e.g. the crowd seed-mode threshold lands in step 5).

Revision ID: e1f2a3b4c5d6
Revises: 48c0ea92d1d8
Create Date: 2026-08-10 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e1f2a3b4c5d6"
down_revision: str | Sequence[str] | None = "48c0ea92d1d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "cognition"


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")

    op.create_table(
        "round_type",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=32), nullable=False),
        sa.Column("display_name", sa.String(length=64), nullable=False),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_round_type_key"),
        schema=SCHEMA,
    )

    op.create_table(
        "round_instance",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("round_type_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("final_score", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["round_type_id"], [f"{SCHEMA}.round_type.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_cognition_round_instance_round_type_id",
        "round_instance",
        ["round_type_id"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_cognition_round_instance_user_id",
        "round_instance",
        ["user_id"],
        unique=False,
        schema=SCHEMA,
    )

    op.create_table(
        "attempt",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("round_instance_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_index", sa.Integer(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
        sa.Column("points_awarded", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["round_instance_id"], [f"{SCHEMA}.round_instance.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("round_instance_id", "attempt_index", name="uq_attempt_instance_index"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_cognition_attempt_round_instance_id",
        "attempt",
        ["round_instance_id"],
        unique=False,
        schema=SCHEMA,
    )

    op.create_table(
        "span_result",
        sa.Column("round_instance_id", sa.Uuid(), nullable=False),
        sa.Column("max_span", sa.Integer(), nullable=False),
        sa.Column("break_level", sa.Integer(), nullable=False),
        sa.Column("modality", sa.String(length=16), nullable=False),
        sa.ForeignKeyConstraint(
            ["round_instance_id"], [f"{SCHEMA}.round_instance.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("round_instance_id"),
        schema=SCHEMA,
    )

    op.create_table(
        "crowd_response",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("round_instance_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("prompt_id", sa.String(length=64), nullable=False),
        sa.Column("raw_answer", sa.Text(), nullable=False),
        sa.Column("predicted_modal_answer", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["round_instance_id"], [f"{SCHEMA}.round_instance.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_cognition_crowd_response_round_instance_id",
        "crowd_response",
        ["round_instance_id"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_cognition_crowd_response_user_id",
        "crowd_response",
        ["user_id"],
        unique=False,
        schema=SCHEMA,
    )
    # The live modal-answer count groups by (prompt_id, raw_answer) at every crowd submission.
    op.create_index(
        "ix_crowd_response_prompt_answer",
        "crowd_response",
        ["prompt_id", "raw_answer"],
        unique=False,
        schema=SCHEMA,
    )

    op.create_table(
        "estimate_item",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("answer", sa.Numeric(precision=20, scale=6), nullable=False),
        sa.Column("unit", sa.String(length=32), nullable=True),
        sa.Column("magnitude_band", sa.String(length=16), nullable=True),
        sa.Column(
            "close_threshold_pct",
            sa.Numeric(precision=6, scale=3),
            nullable=False,
            server_default=sa.text("10"),
        ),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("source_name", sa.String(length=128), nullable=True),
        sa.Column("stability", sa.String(length=16), nullable=True),
        sa.Column("category", sa.String(length=32), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.PrimaryKeyConstraint("id"),
        schema=SCHEMA,
    )

    # Seed the round-type registry. Keys are the module `type` strings; config tunables land with
    # their steps (crowd's seed threshold, span's cadence, …) and modules carry code defaults, so
    # an empty config is always valid.
    op.execute(
        f"""
        INSERT INTO {SCHEMA}.round_type (id, key, display_name, config, active) VALUES
          (gen_random_uuid(), 'span', 'Digit Span', '{{}}', true),
          (gen_random_uuid(), 'estimate', 'Estimation', '{{}}', true),
          (gen_random_uuid(), 'change_detection', 'Change Detection', '{{}}', true),
          (gen_random_uuid(), 'crowd', 'Crowd Prediction', '{{}}', true)
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("estimate_item", schema=SCHEMA)
    op.drop_index("ix_crowd_response_prompt_answer", table_name="crowd_response", schema=SCHEMA)
    op.drop_index("ix_cognition_crowd_response_user_id", table_name="crowd_response", schema=SCHEMA)
    op.drop_index(
        "ix_cognition_crowd_response_round_instance_id",
        table_name="crowd_response",
        schema=SCHEMA,
    )
    op.drop_table("crowd_response", schema=SCHEMA)
    op.drop_table("span_result", schema=SCHEMA)
    op.drop_index("ix_cognition_attempt_round_instance_id", table_name="attempt", schema=SCHEMA)
    op.drop_table("attempt", schema=SCHEMA)
    op.drop_index("ix_cognition_round_instance_user_id", table_name="round_instance", schema=SCHEMA)
    op.drop_index(
        "ix_cognition_round_instance_round_type_id", table_name="round_instance", schema=SCHEMA
    )
    op.drop_table("round_instance", schema=SCHEMA)
    op.drop_table("round_type", schema=SCHEMA)
    op.execute(f"DROP SCHEMA IF EXISTS {SCHEMA}")
