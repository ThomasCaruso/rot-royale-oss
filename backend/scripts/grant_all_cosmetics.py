"""DEV TOOL — grant every catalog cosmetic to one account, so the whole Vault can be seen at once.

This bypasses the earned-unlock requirements (founder, division, duel tier, campaign completion,
"play 7 Daily Royales") by writing the ownership rows those requirements would eventually produce.
That is the point when you are reviewing how themes and frames LOOK, and it is exactly why this must
never be pointed at production: it hands out items the ladder is supposed to gate.

It writes ONLY ownership rows:
  themes -> user_themes        (see app/models/theme.py)
  frames -> user_cosmetics     (see app/models/cosmetic.py)

It does NOT touch coins or Gems, so the append-only ledger invariant (docs/architecture.md §8) is
untouched — nothing is "bought", the balances and the ledger stay exactly as they were. It
also leaves `equipped_theme` / `equipped_frame` alone: what you are wearing is your choice,
not this script's.

Idempotent: an account that already owns something is skipped, so re-running adds only what is new.

Run (from backend/):
    uv run python scripts/grant_all_cosmetics.py T_Sniffs
"""

from __future__ import annotations

import asyncio
import sys

from app.core.cosmetics import COSMETIC_CATALOG
from app.core.db import SessionLocal, engine
from app.models import Profile, UserCosmetic, UserTheme
from sqlalchemy import func, select


async def grant_all(username: str) -> None:
    async with SessionLocal() as session:
        profile = (
            await session.execute(
                select(Profile).where(func.lower(Profile.username) == username.lower())
            )
        ).scalar_one_or_none()
        if profile is None:
            print(f"No profile with username {username!r}.")
            raise SystemExit(1)
        user_id = profile.user_id

        owned_themes = {
            t.theme_id
            for t in (
                await session.execute(select(UserTheme).where(UserTheme.user_id == user_id))
            ).scalars()
        }
        owned_cosmetics = {
            c.item_id
            for c in (
                await session.execute(select(UserCosmetic).where(UserCosmetic.user_id == user_id))
            ).scalars()
        }

        added_themes: list[str] = []
        added_cosmetics: list[str] = []
        for item in COSMETIC_CATALOG:
            if item.kind == "theme":
                if item.id in owned_themes:
                    continue
                session.add(UserTheme(user_id=user_id, theme_id=item.id))
                added_themes.append(item.id)
            else:
                if item.id in owned_cosmetics:
                    continue
                session.add(UserCosmetic(user_id=user_id, item_id=item.id, kind=item.kind))
                added_cosmetics.append(item.id)

        await session.commit()

        total = len(COSMETIC_CATALOG)
        print(f"{profile.username} ({user_id})")
        print(f"  catalog: {total} items")
        print(f"  themes  granted: {len(added_themes):2d}  (already owned: {len(owned_themes)})")
        print(
            f"  frames  granted: {len(added_cosmetics):2d}  (already owned: {len(owned_cosmetics)})"
        )
        if added_themes:
            print(f"    + {', '.join(sorted(added_themes))}")
        if added_cosmetics:
            print(f"    + {', '.join(sorted(added_cosmetics))}")
        print("  coins/Gems untouched; equipped slots untouched.")

    await engine.dispose()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(2)
    asyncio.run(grant_all(sys.argv[1]))
