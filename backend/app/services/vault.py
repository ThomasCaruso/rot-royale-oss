"""Vault service (PLAN.md §6, §11): buy/equip/list cosmetics. Coins are cosmetic-only.

A purchase is ONE transaction (the request boundary commits, this service never does):
debit through the append-only ledger (reason='<kind>_purchase', ref_type=<kind>, ref_key=<id>)
+ grant ownership (themes → user_themes, every other kind → user_cosmetics). record_coin_delta
locks the profile row FOR UPDATE, which serializes concurrent buys; the ownership tables'
composite PKs are the idempotency backstop — a concurrent duplicate rolls the whole transaction
back, so a double debit is impossible.

Requirement gating: catalog items may carry a requirement string (see core/cosmetics.py for the
format) checked against the player's campaign progress (user_campaign_progress) and the campaign
manifest's level counts. Implicit ownership ⇔ cost == 0 AND requirement met — so `frame_none` is
everyone's, while `crowned_scholar` (cost 0, "all_worlds") is owned only after full completion.

Purchases must never touch rating/division/streak/standings (tested invariant).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cosmetics import COSMETIC_CATALOG, CosmeticItem, UnknownItemError, get_item
from app.models import Profile, UserCosmetic, UserTheme, UserUnlockAck
from app.services.gem_ledger import InsufficientGemsError, record_gem_delta
from app.services.ledger import record_coin_delta
from app.services.unlocks import PlayerProgress, gather_progress, requirement_met

__all__ = [
    "AlreadyOwnedError",
    "InsufficientCoinsError",
    "InsufficientGemsError",
    "NotOwnedError",
    "RequirementNotMetError",
    "UnknownItemError",
    "VaultItemView",
    "buy_item",
    "equip_item",
    "get_vault",
]


class VaultError(Exception):
    """Base class for vault conflicts."""


class AlreadyOwnedError(VaultError):
    pass


class InsufficientCoinsError(VaultError):
    pass


class RequirementNotMetError(VaultError):
    pass


class NotOwnedError(VaultError):
    pass


@dataclass(frozen=True)
class VaultItemView:
    id: str
    kind: str
    cost: int
    currency: str
    owned: bool
    equipped: bool
    locked: bool
    coming_soon: bool
    requirement: str | None


# --- requirement engine -----------------------------------------------------------------------
# Grammar + progress snapshot live in services/unlocks.py. "Unlocked" here means the requirement is
# satisfied EITHER right now (requirement_met) OR was ever satisfied and acknowledged
# (user_unlock_acks) — the ack is the permanent high-water mark, so a later division/streak dip
# never re-locks an item. Ungated items (requirement None) are always unlocked.


def _unlocked_sync(item: CosmeticItem, progress: PlayerProgress, acked: set[str]) -> bool:
    """Unlocked check when the caller has already batched progress + the acked set (get_vault)."""
    if item.coming_soon:
        return False  # unreleased: locked for everyone, no requirement can satisfy it
    if item.requirement is None:
        return True
    return item.id in acked or requirement_met(item.requirement, progress)


async def _is_unlocked(session: AsyncSession, user_id: uuid.UUID, item: CosmeticItem) -> bool:
    """Single-item unlocked check (buy/equip). Cheap acked lookup first; only snapshots full
    progress if it isn't already acknowledged."""
    if item.coming_soon:
        return False  # unreleased — this is what makes buy_item refuse it
    if item.requirement is None:
        return True
    if await session.get(UserUnlockAck, (user_id, item.id)) is not None:
        return True
    return requirement_met(item.requirement, await gather_progress(session, user_id))


# --- ownership --------------------------------------------------------------------------------


async def _ownership_row(
    session: AsyncSession, user_id: uuid.UUID, item: CosmeticItem
) -> object | None:
    """The explicit (purchased/granted) ownership row, if any. Themes live in user_themes; every
    other kind lives in user_cosmetics."""
    if item.kind == "theme":
        return await session.get(UserTheme, (user_id, item.id))
    return await session.get(UserCosmetic, (user_id, item.id))


async def _owned(session: AsyncSession, user_id: uuid.UUID, item: CosmeticItem) -> bool:
    """Implicitly owned ⇔ cost == 0 AND unlocked (met-now or acked); otherwise owned only via an
    explicit ownership row (purchase, or an earned-free grant written at ack time)."""
    if item.cost == 0 and await _is_unlocked(session, user_id, item):
        return True
    return await _ownership_row(session, user_id, item) is not None


def _equipped(item: CosmeticItem, profile: Profile) -> bool:
    if item.kind == "theme":
        return item.id == profile.equipped_theme
    if item.kind == "frame":
        # frame_none is the "no frame" sentinel: equipped when nothing is equipped.
        return item.id == profile.equipped_frame or (
            item.id == "frame_none" and profile.equipped_frame is None
        )
    return False


# --- list / buy / equip -----------------------------------------------------------------------


async def get_vault(
    session: AsyncSession, user_id: uuid.UUID
) -> tuple[list[VaultItemView], int, int]:
    profile = await session.get(Profile, user_id)
    if profile is None:
        raise LookupError(f"No profile for user {user_id}")
    owned_theme_ids = {
        t.theme_id
        for t in (
            await session.execute(select(UserTheme).where(UserTheme.user_id == user_id))
        ).scalars()
    }
    owned_cosmetic_ids = {
        c.item_id
        for c in (
            await session.execute(select(UserCosmetic).where(UserCosmetic.user_id == user_id))
        ).scalars()
    }
    # Batched once per request: the progress snapshot + the acknowledged-unlock set.
    progress = await gather_progress(session, user_id)
    acked = {
        r
        for r in (
            await session.execute(
                select(UserUnlockAck.item_id).where(UserUnlockAck.user_id == user_id)
            )
        ).scalars()
    }

    items: list[VaultItemView] = []
    for item in COSMETIC_CATALOG:
        unlocked = _unlocked_sync(item, progress, acked)
        owned_ids = owned_theme_ids if item.kind == "theme" else owned_cosmetic_ids
        items.append(
            VaultItemView(
                id=item.id,
                kind=item.kind,
                cost=item.cost,
                currency=item.currency,
                owned=(item.cost == 0 and unlocked) or item.id in owned_ids,
                equipped=_equipped(item, profile),
                locked=not unlocked,
                coming_soon=item.coming_soon,
                requirement=item.requirement,
            )
        )
    return items, profile.coins_balance, profile.gems_balance


async def buy_item(session: AsyncSession, user_id: uuid.UUID, item_id: str) -> tuple[int, int]:
    """Buy a catalog item. Returns (coins_balance, gems_balance) after the debit. The item's
    `currency` decides which wallet pays: gem-priced items debit the gem ledger, everything else
    the coin ledger. Raises on every non-happy path (InsufficientCoinsError / InsufficientGemsError
    by currency)."""
    item = get_item(item_id)
    if await _owned(session, user_id, item):
        raise AlreadyOwnedError(item_id)
    if not await _is_unlocked(session, user_id, item):
        raise RequirementNotMetError(item_id)

    profile = (
        await session.execute(select(Profile).where(Profile.user_id == user_id).with_for_update())
    ).scalar_one()

    if item.currency == "gems":
        if profile.gems_balance < item.cost:
            raise InsufficientGemsError(item_id)
        # No idempotency_key: the ownership-row PK is the double-buy backstop (same as coins).
        await record_gem_delta(
            session,
            user_id,
            -item.cost,
            f"{item.kind}_purchase",
            ref_type=item.kind,
            ref_key=item.id,
        )
    else:
        if profile.coins_balance < item.cost:
            raise InsufficientCoinsError(item_id)
        await record_coin_delta(
            session,
            user_id,
            -item.cost,
            f"{item.kind}_purchase",
            ref_type=item.kind,
            ref_key=item.id,
        )

    if item.kind == "theme":
        session.add(UserTheme(user_id=user_id, theme_id=item.id))
    else:
        session.add(UserCosmetic(user_id=user_id, item_id=item.id, kind=item.kind))
    try:
        await session.flush()
    except IntegrityError as exc:  # concurrent duplicate buy lost the race → whole tx rolls back
        raise AlreadyOwnedError(item_id) from exc
    return profile.coins_balance, profile.gems_balance


async def equip_item(session: AsyncSession, user_id: uuid.UUID, item_id: str) -> Profile:
    """Equip an owned (explicitly or implicitly) item. Kind-aware: themes set equipped_theme,
    frames set equipped_frame (frame_none clears it to NULL). Returns the updated profile so the
    API can report both equipped slots."""
    item = get_item(item_id)
    if item.kind not in ("theme", "frame"):
        raise UnknownItemError(item_id)  # no other kinds are equippable
    if not await _owned(session, user_id, item):
        raise NotOwnedError(item_id)
    profile = await session.get(Profile, user_id)
    if profile is None:
        raise NotOwnedError(item_id)
    if item.kind == "theme":
        profile.equipped_theme = item.id
    else:
        profile.equipped_frame = None if item.id == "frame_none" else item.id
    await session.flush()
    return profile
