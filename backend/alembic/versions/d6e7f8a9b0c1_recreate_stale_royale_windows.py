"""recreate stale royale windows (old template_id / 12h bounds → current 8q / 24h)

The Daily Royale definition changed twice (24-hour window, then 8 questions). A `royale` window
stores its `template_id` and open/close bounds at PROVISION time, and an entry's round-set resolves
from that STORED template_id — so any `royale` window provisioned before those changes keeps serving
the OLD 20-question / 12-hour format. create_windows_for_date is idempotent (ON CONFLICT DO
NOTHING) and will NOT overwrite an existing row, so the stale window must be deleted for the
scheduler (cron + the lazy provision on GET /contests/current) to recreate it with the current
8-question / 24-hour definition.

SAFETY PREDICATE (deletes a window only if ALL hold) — implemented once in
app.services.scheduler.delete_stale_royale_windows_stmt and unit-tested there:
  - slot = 'royale'                          (only the live ranked slot)
  - state in ('SCHEDULED','OPEN')            (never CLOSED/SETTLED — history/in-flight results stay)
  - template_id != current royale template   (only stale, non-current rows — i.e. dr_20_trivia)
  - the window has NO entries                (never destroy a window a player actually entered)

A non-current template_id is a reliable proxy for BOTH issues: the current template (dr_8_trivia)
only exists after the 24-hour switch, so recreating a stale window fixes the question count AND the
12h→24h bounds at once. Deleting an OPEN zero-entry window is safe (no entries/standings to lose)
and self-heals — the next /contests/current read re-provisions and re-opens it.

Idempotent (a re-run finds nothing left — recreated rows carry the current template_id). The
downgrade is a no-op: nothing to restore, and the scheduler recreates the window on its next run.

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-06-13 17:30:00.000000

"""

from collections.abc import Sequence

from alembic import op
from app.services.scheduler import delete_stale_royale_windows_stmt

# revision identifiers, used by Alembic.
revision: str = "d6e7f8a9b0c1"
down_revision: str | Sequence[str] | None = "c5d6e7f8a9b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Delete stale zero-entry SCHEDULED/OPEN royale windows (predicate in the module docstring) so
    the scheduler recreates them with the current 8-question / 24-hour definition."""
    op.execute(delete_stale_royale_windows_stmt())


def downgrade() -> None:
    """No-op: nothing to restore. The scheduler recreates the royale window on its next run."""
    pass
