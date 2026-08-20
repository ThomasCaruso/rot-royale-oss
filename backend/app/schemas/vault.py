"""Vault API shapes. Prices come FROM the server only — no request body ever carries a price."""

from __future__ import annotations

from pydantic import BaseModel


class VaultItemOut(BaseModel):
    id: str
    kind: str
    cost: int
    currency: str  # "coins" | "gems" — which wallet a purchase debits
    owned: bool
    equipped: bool
    locked: bool
    coming_soon: bool  # unreleased — shown under the Vault's "Coming soon" divider
    requirement: str | None


class VaultResponse(BaseModel):
    items: list[VaultItemOut]
    coins_balance: int
    gems_balance: int


class BuyResponse(BaseModel):
    item_id: str
    currency: str  # the wallet that was debited for this purchase
    coins_balance: int
    gems_balance: int


class EquipResponse(BaseModel):
    """Both equipped slots, reflecting the profile AFTER the equip (whatever kind was equipped)."""

    equipped_theme: str
    equipped_frame: str | None


class PendingUnlockOut(BaseModel):
    """One newly-earned, not-yet-revealed unlock. The frontend maps `id` → name/visual (the display
    catalog lives client-side, tokens.ts/identity.ts). `acquisition` is 'earned' (cost 0 → granted)
    or 'buy' (unlock-then-buy → now purchasable)."""

    id: str
    kind: str
    cost: int
    currency: str
    requirement: str | None
    acquisition: str  # "earned" | "buy"


class PendingUnlocksResponse(BaseModel):
    items: list[PendingUnlockOut]


class AckRequest(BaseModel):
    """Which pending unlocks the client has now revealed. Empty list = acknowledge all pending."""

    item_ids: list[str] = []


class AckResponse(BaseModel):
    acknowledged: list[str]
