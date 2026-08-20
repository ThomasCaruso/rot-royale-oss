"""change_item: base_url/altered_url -> base_asset/altered_asset

Phase 2Q moved change-detection imagery out of `frontend/public/assets/change/` and into the private
content package, so these columns stopped holding web paths and started holding ASSET IDS resolved
under `<content_root>/change/assets/` (content/change_assets.py). The columns are renamed with the
meaning rather than left as `base_url` holding "gym_rack_base.jpg", which is exactly the kind of
stale name that gets trusted later.

The data step matters as much as the rename. Live rows hold v1 values like
"/assets/change/gym_rack_base.jpg"; the migration rewrites them to their basename, which IS the new
asset id because the files moved without being renamed. That makes the migration self-sufficient:
Change mode keeps working on the deploy's `alembic upgrade head` alone, before `ingest-change` runs
later in the same startCommand chain, and it still works if that ingest is ever skipped.

Revision ID: a1b2c3d4e5f6
Revises: 9e2d5b81f4c7
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a1b2c3d4e5f6"
down_revision = "9e2d5b81f4c7"
branch_labels = None
depends_on = None

SCHEMA = "cognition"
TABLE = "change_item"


def upgrade() -> None:
    op.alter_column(TABLE, "base_url", new_column_name="base_asset", schema=SCHEMA)
    op.alter_column(TABLE, "altered_url", new_column_name="altered_asset", schema=SCHEMA)

    # "/assets/change/x.jpg" -> "x.jpg". Anything already bare is left alone by the LIKE guard.
    for col in ("base_asset", "altered_asset"):
        op.execute(
            sa.text(
                f"UPDATE {SCHEMA}.{TABLE} "
                f"SET {col} = regexp_replace({col}, '^.*/', '') "
                f"WHERE {col} LIKE '%/%'"
            )
        )

    rows = op.get_bind().execute(sa.text(f"SELECT count(*) FROM {SCHEMA}.{TABLE}")).scalar()
    print(f"change_assets: normalized {rows} change_item row(s) to bare asset ids")


def downgrade() -> None:
    # Restore the v1 web paths the old code resolved against web_base_url.
    for col in ("base_asset", "altered_asset"):
        op.execute(
            sa.text(
                f"UPDATE {SCHEMA}.{TABLE} "
                f"SET {col} = '/assets/change/' || {col} "
                f"WHERE {col} NOT LIKE '%/%'"
            )
        )
    op.alter_column(TABLE, "base_asset", new_column_name="base_url", schema=SCHEMA)
    op.alter_column(TABLE, "altered_asset", new_column_name="altered_url", schema=SCHEMA)
