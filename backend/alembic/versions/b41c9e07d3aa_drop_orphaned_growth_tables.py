"""drop orphaned referral/challenge-participation tables

Revision ID: b41c9e07d3aa
Revises: 0dca7627f74d
Create Date: 2026-07-30

`referrals`, `challenge_participations` and `challenge_first_beats` were created by revision
d2f3a4b5c6e7 ("challenge_rivalry"), whose migration file is no longer in alembic/versions — the work
was superseded by e4f5a6b7c8d9 ("Challenge snapshots"). The tables survived; the code did not.

They are dropped rather than left alone because they are a PRIVACY liability, not merely clutter:
each carries a foreign key to `users`, so they are shaped to hold personal data, but no ORM model
maps them. Nothing in the application can read them, which means they cannot appear in a
data-subject access request or a data export, and nobody would think to describe them in the
privacy policy. A
table that can hold personal data but is invisible to every process meant to govern personal data is
exactly the wrong thing to keep.

Verified before writing this migration: all three are EMPTY (0 rows) and no file under app/, tests/
or content/ references them. No data is lost.

The downgrade recreates the structures so the revision is reversible, but not the rows — there are
none to restore.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b41c9e07d3aa"
down_revision: str | Sequence[str] | None = "0dca7627f74d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # IF EXISTS: environments provisioned after the orphan lineage was dropped never had these.
    op.execute("DROP TABLE IF EXISTS challenge_first_beats CASCADE")
    op.execute("DROP TABLE IF EXISTS challenge_participations CASCADE")
    op.execute("DROP TABLE IF EXISTS referrals CASCADE")


def downgrade() -> None:
    op.create_table(
        "referrals",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("referrer_user_id", sa.UUID(), nullable=False),
        sa.Column("referred_user_id", sa.UUID(), nullable=False),
        sa.Column("vector", sa.VARCHAR(length=16), nullable=False),
        sa.Column("source_challenge_id", sa.VARCHAR(length=16), nullable=True),
        sa.Column(
            "status",
            sa.VARCHAR(length=16),
            server_default=sa.text("'pending'::character varying"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("activated_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint(
            "referrer_user_id <> referred_user_id", name="ck_referrals_no_self_referral"
        ),
        sa.ForeignKeyConstraint(["referred_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["referrer_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_challenge_id"], ["challenges.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("referred_user_id", name="uq_referrals_referred_user"),
    )
    op.create_index("ix_referrals_referrer_user_id", "referrals", ["referrer_user_id"])
    op.create_index("ix_referrals_referrer_status", "referrals", ["referrer_user_id", "status"])

    op.create_table(
        "challenge_participations",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("challenge_id", sa.VARCHAR(length=16), nullable=False),
        sa.Column("participant_user_id", sa.UUID(), nullable=False),
        sa.Column("entry_id", sa.UUID(), nullable=False),
        sa.Column("participant_score", sa.INTEGER(), nullable=True),
        sa.Column("beat_creator", sa.BOOLEAN(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["challenge_id"], ["challenges.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["entry_id"], ["entries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["participant_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("entry_id", name="uq_challenge_participation_entry"),
    )
    op.create_index(
        "ix_challenge_participations_participant_user_id",
        "challenge_participations",
        ["participant_user_id"],
    )
    op.create_index(
        "ix_challenge_participations_challenge_id", "challenge_participations", ["challenge_id"]
    )
    op.create_index(
        "ix_challenge_participation_challenge_beat",
        "challenge_participations",
        ["challenge_id", "beat_creator"],
    )

    op.create_table(
        "challenge_first_beats",
        sa.Column("challenge_id", sa.VARCHAR(length=16), nullable=False),
        sa.Column("winner_user_id", sa.UUID(), nullable=False),
        sa.Column("winner_score", sa.INTEGER(), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("notified_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["challenge_id"], ["challenges.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["winner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("challenge_id"),
    )
    op.create_index(
        "ix_challenge_first_beats_unsent",
        "challenge_first_beats",
        ["challenge_id"],
        postgresql_where=sa.text("notified_at IS NULL"),
    )
