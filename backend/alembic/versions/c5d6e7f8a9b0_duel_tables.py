"""duel_matches / duel_rounds / duel_user_stats (async Duel mode)

Schema foundation for the async best-of-7 trivia Duel vs a bot rival (Gem entry pools). The human's
play reuses the existing Entry/RoundAnswer/RoundResult machinery (linked via duel_matches.entry_id);
the bot rival's precomputed per-round run lives server-side in duel_matches.rival_run.

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-06-11 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c5d6e7f8a9b0"
down_revision: str | Sequence[str] | None = "b4c5d6e7f8a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "duel_matches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("entry_id", sa.Uuid(), nullable=False),
        sa.Column("duel_type", sa.String(length=16), nullable=False),
        sa.Column(
            "rival_type", sa.String(length=16), nullable=False, server_default=sa.text("'bot'")
        ),
        sa.Column("rival_user_id", sa.Uuid(), nullable=True),
        sa.Column("rival_snapshot_id", sa.Uuid(), nullable=True),
        sa.Column("bot_rival_tier", sa.String(length=16), nullable=True),
        sa.Column("entry_gems", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("pool_gems", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("rival_run", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default=sa.text("'created'")
        ),
        sa.Column("user_round_wins", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("rival_round_wins", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("winner", sa.String(length=16), nullable=True),
        sa.Column("result_reason", sa.String(length=32), nullable=True),
        sa.Column("gem_delta", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("xp_awarded", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("contest_date", sa.Date(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["entry_id"], ["entries.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("entry_id", name="uq_duel_match_entry"),
    )
    op.create_index("ix_duel_matches_user_id", "duel_matches", ["user_id"], unique=False)

    op.create_table(
        "duel_rounds",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("match_id", sa.Uuid(), nullable=False),
        sa.Column("round_index", sa.Integer(), nullable=False),
        sa.Column("phase", sa.String(length=12), nullable=False),
        sa.Column("user_answer", sa.Integer(), nullable=True),
        sa.Column("user_correct", sa.Boolean(), nullable=False),
        sa.Column("user_time_ms", sa.Integer(), nullable=False),
        sa.Column("rival_correct", sa.Boolean(), nullable=False),
        sa.Column("rival_time_ms", sa.Integer(), nullable=False),
        sa.Column("outcome", sa.String(length=12), nullable=False),
        sa.Column("outcome_reason", sa.String(length=24), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["match_id"], ["duel_matches.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("match_id", "round_index", name="uq_duel_round_match_index"),
    )
    op.create_index("ix_duel_rounds_match_id", "duel_rounds", ["match_id"], unique=False)

    op.create_table(
        "duel_user_stats",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("wins", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("losses", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("training_wins", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("training_losses", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("current_streak", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("best_streak", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("perfect_wins", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("comeback_wins", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("total_gems_won", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("total_gems_lost", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("duel_xp", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "duel_tier", sa.String(length=16), nullable=False, server_default=sa.text("'bronze'")
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("duel_user_stats")
    op.drop_index("ix_duel_rounds_match_id", table_name="duel_rounds")
    op.drop_table("duel_rounds")
    op.drop_index("ix_duel_matches_user_id", table_name="duel_matches")
    op.drop_table("duel_matches")
