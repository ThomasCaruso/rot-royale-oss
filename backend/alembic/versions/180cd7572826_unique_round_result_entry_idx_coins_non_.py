"""unique round_result (entry_id, idx) + coins non-negative check

Hand-trimmed: autogenerate proposed a raft of unrelated drops (the idempotency partial indexes it
keeps mis-detecting — see dd8034be5bb0 — plus invite_code, duel_rating, push/ai indexes). NONE of
those are intended. This migration contains only the two security-hardening changes.

Revision ID: 180cd7572826
Revises: dd8034be5bb0
Create Date: 2026-08-01 15:51:49.079262

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "180cd7572826"
down_revision: str | Sequence[str] | None = "dd8034be5bb0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # L-1: one result row per (entry, round). The DB backstop for the /answer sequence guard's
    # read-then-insert TOCTOU. Dedup any pre-existing duplicates FIRST (keep the lowest id per
    # group) so the constraint can be added on a live DB that may already hold duplicate rows.
    op.execute(
        """
        DELETE FROM round_results a
        USING round_results b
        WHERE a.entry_id = b.entry_id AND a.idx = b.idx AND a.id > b.id
        """
    )
    op.create_unique_constraint("uq_round_result_entry_idx", "round_results", ["entry_id", "idx"])

    # C-2 defense-in-depth: the coin ledger already refuses a debit that would go negative (parity
    # with gems). This is the DB-level backstop. Added NOT VALID so the deploy never fails scanning
    # legacy rows — it enforces every write from now on; a VALIDATE can follow once balances are
    # confirmed clean.
    op.execute(
        "ALTER TABLE profiles ADD CONSTRAINT ck_profiles_coins_nonneg "
        "CHECK (coins_balance >= 0) NOT VALID"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE profiles DROP CONSTRAINT IF EXISTS ck_profiles_coins_nonneg")
    op.drop_constraint("uq_round_result_entry_idx", "round_results", type_="unique")
