"""Vault endpoints (cosmetics; coins are cosmetic-only). The item id in the path is the whole
request — buy/equip take no body, so a client can never send a price."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.cosmetics import get_item
from app.core.db import get_session
from app.models import User
from app.schemas.vault import (
    AckRequest,
    AckResponse,
    BuyResponse,
    EquipResponse,
    PendingUnlockOut,
    PendingUnlocksResponse,
    VaultItemOut,
    VaultResponse,
)
from app.services.unlocks import acknowledge_unlocks, pending_unlocks
from app.services.vault import (
    AlreadyOwnedError,
    InsufficientCoinsError,
    InsufficientGemsError,
    NotOwnedError,
    RequirementNotMetError,
    UnknownItemError,
    buy_item,
    equip_item,
    get_vault,
)

router = APIRouter(prefix="/vault", tags=["vault"])

# NOTE: services.vault.get_vault raises LookupError for a missing profile — unreachable for an
# authed user, so it is deliberately unmapped here (a 500 is correct for an impossible state).
#
# Error `detail` strings here are machine-readable codes ("already_owned", "insufficient_coins")
# the frontend switches on — a deliberate contract, not prose; don't "fix" them to sentences.


@router.get("", response_model=VaultResponse)
async def vault(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> VaultResponse:
    items, coins_balance, gems_balance = await get_vault(session, user.id)
    return VaultResponse(
        items=[VaultItemOut(**vars(i)) for i in items],
        coins_balance=coins_balance,
        gems_balance=gems_balance,
    )


@router.post("/{item_id}/buy", response_model=BuyResponse)
async def buy(
    item_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BuyResponse:
    try:
        coins_balance, gems_balance = await buy_item(session, user.id, item_id)
    except UnknownItemError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown_item") from None
    except AlreadyOwnedError:
        raise HTTPException(status.HTTP_409_CONFLICT, "already_owned") from None
    except InsufficientCoinsError:
        # 400, not 402: "Payment Required" is money-language this product deliberately avoids
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "insufficient_coins") from None
    except InsufficientGemsError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "insufficient_gems") from None
    except RequirementNotMetError:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "requirement_not_met") from None
    return BuyResponse(
        item_id=item_id,
        currency=get_item(item_id).currency,
        coins_balance=coins_balance,
        gems_balance=gems_balance,
    )


@router.get("/pending-unlocks", response_model=PendingUnlocksResponse)
async def pending(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PendingUnlocksResponse:
    """Unlocks the player has newly EARNED but not yet had revealed — the diff the results screens
    and the Home net celebrate. Read-only + idempotent: revealing is confirmed via /unlocks/ack."""
    items = await pending_unlocks(session, user.id)
    return PendingUnlocksResponse(
        items=[
            PendingUnlockOut(
                id=i.id,
                kind=i.kind,
                cost=i.cost,
                currency=i.currency,
                requirement=i.requirement,
                acquisition="earned" if i.cost == 0 else "buy",
            )
            for i in items
        ]
    )


@router.post("/unlocks/ack", response_model=AckResponse)
async def ack_unlocks(
    body: AckRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AckResponse:
    """Confirm a reveal: mark the given pending unlocks acknowledged (empty list = all pending),
    writing the once-only ack row + the earned-free ownership grant. Idempotent — re-acking a
    revealed unlock is a no-op."""
    ids = body.item_ids or [i.id for i in await pending_unlocks(session, user.id)]
    done = await acknowledge_unlocks(session, user.id, ids)
    return AckResponse(acknowledged=[i.id for i in done])


@router.post("/{item_id}/equip", response_model=EquipResponse)
async def equip(
    item_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> EquipResponse:
    try:
        profile = await equip_item(session, user.id, item_id)
    except UnknownItemError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown_item") from None
    except NotOwnedError:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not_owned") from None
    return EquipResponse(
        equipped_theme=profile.equipped_theme, equipped_frame=profile.equipped_frame
    )
