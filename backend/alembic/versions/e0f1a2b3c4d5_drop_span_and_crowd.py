"""Drop the span and crowd cognitive round types (pre-launch removal, CLAUDE.md §5d).

`crowd` cannot score honestly below a few hundred responses per prompt, so at launch scale every
round would have been graded against a seeded distribution rather than a real crowd — the one thing
Invariant 6 forbids. `span` reads as clinical brain-training rather than as this game; it was never
in the Royale pool and had no player-facing route once the pre-launch playtest harness goes.

Drops `cognition.span_result` and `cognition.crowd_response`, and deletes the two `round_type`
registry rows. Round INSTANCES of these types are removed too — they are unreachable once the code
is gone, and leaving them would strand rows whose round_type_id no longer resolves. Each destructive
step reports the row count it is removing, so a prod run says what it destroyed rather than doing it
silently.

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-08-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e0f1a2b3c4d5"
down_revision: str | Sequence[str] | None = "d9e0f1a2b3c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DEAD_TYPES = ("span", "crowd")


def _report(conn, label: str, sql: str, params: dict | None = None) -> int:
    count = conn.execute(sa.text(sql), params or {}).scalar_one()
    print(f"drop_span_and_crowd: {label} = {count}")
    return int(count)


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()

    # Say out loud what is being destroyed — this is irreversible on a real database.
    _report(conn, "span_result rows", "select count(*) from cognition.span_result")
    _report(conn, "crowd_response rows", "select count(*) from cognition.crowd_response")
    _report(
        conn,
        "round_instance rows of the dead types",
        "select count(*) from cognition.round_instance ri "
        "join cognition.round_type rt on rt.id = ri.round_type_id "
        "where rt.key = any(:keys)",
        {"keys": list(_DEAD_TYPES)},
    )

    op.drop_table("span_result", schema="cognition")
    op.drop_table("crowd_response", schema="cognition")

    # Attempts cascade from round_instance; instances are deleted before the registry rows they
    # reference (round_instance.round_type_id is ON DELETE CASCADE, but being explicit keeps the
    # intent readable and the ordering independent of the FK's cascade rule).
    conn.execute(
        sa.text(
            "delete from cognition.round_instance where round_type_id in "
            "(select id from cognition.round_type where key = any(:keys))"
        ),
        {"keys": list(_DEAD_TYPES)},
    )
    conn.execute(
        sa.text("delete from cognition.round_type where key = any(:keys)"),
        {"keys": list(_DEAD_TYPES)},
    )


def downgrade() -> None:
    """Downgrade schema.

    Recreates the two tables and their registry rows. The DATA is not recoverable — this is a
    structural rollback only, which is the honest limit of undoing a drop.
    """
    op.create_table(
        "span_result",
        sa.Column("round_instance_id", sa.Uuid(), nullable=False),
        sa.Column("max_span", sa.Integer(), nullable=False),
        sa.Column("break_level", sa.Integer(), nullable=False),
        sa.Column("modality", sa.String(length=16), nullable=False),
        sa.ForeignKeyConstraint(
            ["round_instance_id"], ["cognition.round_instance.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("round_instance_id"),
        schema="cognition",
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
            ["round_instance_id"], ["cognition.round_instance.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="cognition",
    )
    op.create_index(
        "ix_crowd_response_prompt_answer",
        "crowd_response",
        ["prompt_id", "raw_answer"],
        unique=False,
        schema="cognition",
    )
    op.create_index(
        op.f("ix_cognition_crowd_response_round_instance_id"),
        "crowd_response",
        ["round_instance_id"],
        unique=False,
        schema="cognition",
    )
    op.create_index(
        op.f("ix_cognition_crowd_response_user_id"),
        "crowd_response",
        ["user_id"],
        unique=False,
        schema="cognition",
    )
    op.execute(
        sa.text(
            "insert into cognition.round_type (id, key, display_name, config, active) values "
            "(gen_random_uuid(), 'span', 'Digit Span', '{}'::jsonb, true), "
            "(gen_random_uuid(), 'crowd', 'Crowd Prediction', '{}'::jsonb, true) "
            "on conflict (key) do nothing"
        )
    )
