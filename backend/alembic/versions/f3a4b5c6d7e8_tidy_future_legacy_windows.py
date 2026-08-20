"""tidy future SCHEDULED zero-entry legacy (morning/midday/night) windows

Daily Royale (Phase 2) provisions only the `royale` slot going forward. Any morning/midday/night
windows already SCHEDULED for FUTURE dates (e.g. tomorrow, provisioned by the old loop before this
migration deploys) would otherwise still open/close/settle. This deletes ONLY those dead future
legacy windows.

SAFETY PREDICATE (deletes a window only if ALL hold) — implemented once in
app.services.scheduler.delete_dead_future_legacy_windows_stmt and unit-tested there:
  - state = 'SCHEDULED'                  (never CLOSED/SETTLED — historical/in-flight results stay)
  - slot in ('morning','midday','night') (never the live `royale` slot)
  - open_at > now()                      (future only — never a past/today legacy window)
  - the window has NO entries            (never destroy a window a player actually entered)

Idempotent (a re-run finds nothing left to delete). Downgrade is intentionally a no-op: there is no
data to restore, and rolling back the code would re-enable the old provisioning loop which simply
recreates tomorrow's legacy windows on the next cron run.

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-06-10 13:00:00.000000

"""

from collections.abc import Sequence

from alembic import op
from app.services.scheduler import delete_dead_future_legacy_windows_stmt

# revision identifiers, used by Alembic.
revision: str = "f3a4b5c6d7e8"
down_revision: str | Sequence[str] | None = "e2f3a4b5c6d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Delete future SCHEDULED zero-entry legacy windows (predicate in the module docstring)."""
    op.execute(delete_dead_future_legacy_windows_stmt())


def downgrade() -> None:
    """No-op: nothing to restore. Rolling back the code re-enables the old provisioning loop, which
    recreates tomorrow's legacy windows on the next cron run."""
    pass
