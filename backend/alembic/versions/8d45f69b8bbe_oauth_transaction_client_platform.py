"""oauth transaction client_platform

Records whether a Google sign-in was started by the website or by the native app, so the callback
knows where to send the browser back to. See models/oauth_transaction.py for why it is a platform
NAME and never a URL.

TRIMMED BY HAND, and that mattered here more than usual. Autogenerate produced this one change plus
a pile of unrelated destruction: dropping `profiles.invite_code`, dropping the partial UNIQUE
indexes that enforce idempotency on BOTH ledgers (CLAUDE.md invariant 2 — those are what stop a
re-settle double-granting), dropping `duel_matches.rival_rating` and `duel_user_stats.duel_rating`,
and re-CREATING the whole `cognition` schema, which exists and is full of live data. Autogenerate
does not see those tables (they live in a non-default Postgres schema) and reads their absence as a
removal. Everything except the add_column below was discarded.

Revision ID: 8d45f69b8bbe
Revises: d4e5f6a7b8c9
Create Date: 2026-09-12 21:21:05.919986
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8d45f69b8bbe"
down_revision: str | Sequence[str] | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the return-target platform to in-flight OAuth transactions.

    NOT NULL with a server_default of "web": every existing row predates native sign-in and was, by
    definition, a web round trip, so the default is the truth rather than a placeholder. It also
    means an older client that sends no platform keeps working unchanged (§7c — widen inputs, never
    narrow them).
    """
    op.add_column(
        "oauth_transactions",
        sa.Column("client_platform", sa.String(length=16), server_default="web", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("oauth_transactions", "client_platform")
