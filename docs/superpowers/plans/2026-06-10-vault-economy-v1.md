# Vault Economy V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make coins real: ranked stops paying coins (campaign is the only faucet), and a themes-only Vault becomes the sink — server-authoritative catalog, buy/equip endpoints through the existing coin ledger, and a Vault screen.

**Architecture:** Phase 0 zeros the ranked payout constants and guards the two settlement ledger writes (rating/division/streak untouched). Phase 1 adds a code-defined cosmetic catalog (`app/core/cosmetics.py`), one additive migration (`coin_ledger.ref_key`), a vault service that spends via `record_coin_delta` + grants via the existing `user_themes` table, and three endpoints. Phase 2 ports three priced themes into `tokens.ts` and builds the Vault screen wired from the coin pill and ProfileMenu. **Decision already made:** keep `user_themes` (no generic cosmetics table, no `equipped_frame` column, no frame UI in V1).

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic (uv), Vite + React + TS (vitest), no new dependencies.

**Branch:** all work on `feat/vault-economy-v1` (created from `main`). Commit per task. Do not push or merge without the user asking.

**Hard constraints (every task):** coins are cosmetic-only; no purchasable/redeemable coins; no gacha/rotation/fake scarcity; no cash/prize/bet/wager/jackpot/casino/gambling/"payout"/"player" in player-facing strings (the i18n + component copy-guard tests enforce this — keep them green); services never commit (request boundary does); never `create_all` — Alembic only.

**Backend test prerequisite:** `cd backend && uv run alembic upgrade head` must have been run against the dev DB; tests use the dedicated `rot_royale_test` DB and migrate it automatically (see `tests/conftest.py`). Backend on this machine runs on **:8001 only — never touch :8000 or kill processes by name** (see CLAUDE.md ops rules).

---

### Task 1: Land the in-progress leaderboard work

The working tree has uncommitted leaderboard work (new `frontend/src/screens/leaderboard/` + modified `App.tsx`, `Home.tsx`, `BottomNav.tsx`, `Campaign.tsx`, `CampaignWorlds.tsx`, i18n files, `LeaderboardPreview.test.tsx`). It must be committed first because later tasks edit the same files.

**Files:**
- Commit (no edits): everything `git status` shows as modified/untracked under `frontend/`

- [ ] **Step 1: Verify the WIP is green**

Run (from `frontend/`): `npm run typecheck; npm run lint; npx vitest run`
Expected: all pass. If anything fails, STOP and report — do not fix-and-commit someone else's WIP silently.

- [ ] **Step 2: Create the feature branch**

```bash
git checkout -b feat/vault-economy-v1
```

- [ ] **Step 3: Commit the leaderboard work as its own commit**

```bash
git add frontend/src/app/App.tsx frontend/src/i18n/en.ts frontend/src/i18n/es.ts frontend/src/i18n/tr.ts frontend/src/screens/Home.tsx frontend/src/screens/campaign/Campaign.tsx frontend/src/screens/campaign/CampaignWorlds.tsx frontend/src/screens/home/BottomNav.tsx frontend/src/screens/home/LeaderboardPreview.test.tsx frontend/src/screens/leaderboard
git commit -m "feat(leaderboard): full leaderboard screen + bottom-nav slot"
```

---

### Task 2 (Phase 0): Ranked settlement stops paying coins

**Files:**
- Modify: `backend/app/core/constants.py:15-19`
- Modify: `backend/app/services/settlement.py:1-8` (docstring), `:140-148` (payout writes)
- Test: `backend/tests/test_settlement.py`

- [ ] **Step 1: Rewrite the settlement tests to express the new behavior**

In `backend/tests/test_settlement.py`:

(a) Replace `test_coins_by_placement_brackets` (lines 22-28) with:

```python
def test_ranked_placement_pays_no_coins():
    # Ranked gives rank/status only — coins come from campaign/practice, never settlement.
    for place in (1, 2, 3, 4, 5, 12):
        assert coins_for_place(place, 12) == 0
```

(b) In `test_settle_ranks_pays_and_marks_settled` (lines 101-130): rename to `test_settle_ranks_and_marks_settled`; keep the placement/field-size/rating asserts; replace the three coin asserts (lines 123-126) with:

```python
    # ranked is coin-free: standings record 0 and the ledger stays empty
    assert standings[winner.id].coins_awarded == 0
    assert standings[runner.id].coins_awarded == 0
    assert await _balance(db_session, winner.id) == 0
    ledger_rows = (await db_session.execute(select(func.count()).select_from(CoinLedger))).scalar_one()
    assert ledger_rows == 0
```

(c) Replace the body of `test_settle_is_exactly_once` (lines 133-143) — coin balance can no longer observe exactly-once; use rating + standings instead:

```python
async def test_settle_is_exactly_once(db_session: AsyncSession):
    w = await _closed_window(db_session)
    u = await _user(db_session, "u")
    await _entry(db_session, w, u, 500)

    assert await settle_window(db_session, w.id) is True
    profile = await db_session.get(Profile, u.id)
    assert profile is not None
    rating_after_first = profile.rating
    assert rating_after_first != 1000  # rating applied once

    # second settle must be a no-op (window already SETTLED) — no double rating, no extra standing
    assert await settle_window(db_session, w.id) is False
    await db_session.refresh(profile)
    assert profile.rating == rating_after_first
    standings = (
        (await db_session.execute(select(Standing).where(Standing.window_id == w.id))).scalars().all()
    )
    assert len(standings) == 1
```

(d) In `test_bots_are_never_persisted_to_profiles_rank_or_ledger` (lines 251-269): replace the ledger assert (lines 264-266) with:

```python
    # Settlement pays nobody — the ledger is empty (and bots could never have touched it anyway).
    ledger_users = (await db_session.execute(select(CoinLedger.user_id))).scalars().all()
    assert ledger_users == []
```

(e) Add a new explicit guard test at the end of the settle_window section:

```python
async def test_settlement_writes_no_ledger_rows(db_session: AsyncSession):
    """The Phase-0 economy contract: ranked settlement NEVER creates coin movements."""
    w = await _closed_window(db_session)
    users = [await _user(db_session, f"p{i}") for i in range(3)]
    for i, u in enumerate(users):
        await _entry(db_session, w, u, 900 - i * 100)

    await settle_window(db_session, w.id)
    ledger_rows = (await db_session.execute(select(func.count()).select_from(CoinLedger))).scalar_one()
    assert ledger_rows == 0
    for u in users:
        profile = await db_session.get(Profile, u.id)
        assert profile is not None and profile.coins_balance == 0
    standings = (
        (await db_session.execute(select(Standing).where(Standing.window_id == w.id))).scalars().all()
    )
    assert len(standings) == 3 and all(s.coins_awarded == 0 for s in standings)
```

Leave `test_settle_updates_streak_and_division`, `test_only_submitted_entries_are_settled`, `test_settle_due_windows_*`, `test_settle_skips_non_closed_window`, `test_strong_real_entry_beats_all_bots_and_field_is_padded`, `test_money_contest_gets_no_bots` untouched.

- [ ] **Step 2: Run the settlement tests — expect the rewritten ones to FAIL**

Run (from `backend/`): `uv run pytest tests/test_settlement.py -v`
Expected: `test_ranked_placement_pays_no_coins`, `test_settle_ranks_and_marks_settled`, `test_settlement_writes_no_ledger_rows`, `test_bots_are_never_persisted_to_profiles_rank_or_ledger` FAIL (coins are still paid); the untouched ones pass.

- [ ] **Step 3: Zero the constants**

In `backend/app/core/constants.py` replace lines 15-19 with:

```python
# --- Settlement & rating (PLAN.md §7). Ranked pays NO coins — it grants rating/division/streak
# (status); coins are earned in campaign/practice and spent in the Vault. The constants stay as the
# documented tuning seam; settlement skips the ledger write entirely when an amount is 0, so the
# append-only ledger never carries zero-value rows. ---
COINS_BY_PLACE: dict[int, int] = {1: 0, 2: 0, 3: 0}  # exact placements
COINS_TOP_THIRD: int = 0  # placed in the top third (but not 1st–3rd)
COINS_PARTICIPATION: int = 0  # everyone else who submitted
STREAK_BONUS_PER_DAY: int = 0  # streak bonus coins = (streak + 1) * STREAK_BONUS_PER_DAY
RATING_K: int = 64  # Elo sensitivity
```

- [ ] **Step 4: Guard the settlement ledger writes**

In `backend/app/services/settlement.py` replace lines 143-148 with:

```python
        if base:
            await record_coin_delta(
                session, user_id, base, "contest_payout", ref_type="window", ref_id=window_id
            )
        if bonus:
            await record_coin_delta(
                session, user_id, bonus, "streak_bonus", ref_type="window", ref_id=window_id
            )
```

Update the module docstring (line 1): `"""Settlement (PLAN.md §7). Runs once per window at/after close: rank the field, apply Elo rating + division, advance the daily streak, write standings, mark SETTLED. Ranked pays no coins (coins are campaign/practice-earned, Vault-spent); the coin constants are a tuning seam and zero-value ledger writes are skipped.` — keep the rest of the docstring (exactly-once paragraph) as is.

- [ ] **Step 5: Run the full backend suite + linters**

Run: `uv run pytest` then `uv run ruff check .` then `uv run mypy app`
Expected: all green — including `tests/test_campaign.py` (campaign coins still work) and `tests/test_ledger.py`, both untouched.

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/constants.py backend/app/services/settlement.py backend/tests/test_settlement.py
git commit -m "feat(economy): ranked settlement pays no coins - campaign is the faucet"
```

---

### Task 3 (Phase 0): Results modal hides the zero-coin stat + ranked-coin copy sweep

**Files:**
- Modify: `frontend/src/screens/results/RoyaleResultsModal.tsx:471-477`
- Test: `frontend/src/screens/results/RoyaleResultsModal.test.tsx`
- Possibly modify: `frontend/src/i18n/en.ts`, `es.ts`, `tr.ts` (only if the sweep finds offenders)

- [ ] **Step 1: Write the failing test**

In `RoyaleResultsModal.test.tsx`, follow the file's existing render-helper pattern (it builds a settled result and asserts on rendered HTML — reuse the existing helper/fixtures in that file). Add:

```tsx
it("hides the coins stat when a settled result awarded 0 coins (ranked pays none)", () => {
  // render with coins_awarded: 0, advance past the reveal stages as existing tests do
  // assert: rendered HTML does NOT contain the coins label
  expect(html).not.toContain(en.results.coins);
});

it("still shows the coins stat for historical results with coins_awarded > 0", () => {
  // render with coins_awarded: 42
  expect(html).toContain(en.results.coins);
});
```

(Adapt to the file's actual render helper — the assertions above are the contract.)

- [ ] **Step 2: Run to verify the first new test fails**

Run (from `frontend/`): `npx vitest run src/screens/results`
Expected: "hides the coins stat…" FAILS (the stat renders unconditionally today).

- [ ] **Step 3: Implement the conditional**

In `RoyaleResultsModal.tsx`, wrap the coins `RewardStat` and its divider (lines 473-477) so they only render when coins were actually awarded:

```tsx
              <div style={{ display: "flex", gap: 12 }}>
                {coins > 0 && (
                  <>
                    <RewardStat label={t.results.coins} color="var(--amber)">
                      +<CountUp value={coins} />
                    </RewardStat>
                    <div aria-hidden style={{ width: 1, background: "var(--line)" }} />
                  </>
                )}
```

(The rating `RewardStat` that follows stays unconditional.)

- [ ] **Step 4: Sweep i18n for ranked-coin promises**

Search `en.ts`/`es.ts`/`tr.ts` for strings that promise coins **specifically for ranked/contest play** (e.g. "win coins in today's window"). Generic "earn coins" copy (e.g. the home tagline — campaign still pays coins) stays. Known borderline: `es.ts:24` tagline "gana monedas, sube en la clasificación" — generic, KEEP. Only change a string if it explicitly ties coins to contests/windows/placement. If changed, mirror in all three locales (the key-parity test enforces this).

- [ ] **Step 5: Run frontend checks**

Run: `npm run typecheck; npm run lint; npx vitest run`
Expected: all green, including the banned-word and key-parity i18n tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/results frontend/src/i18n
git commit -m "feat(results): hide coins stat for coin-free ranked results"
```

---

### Task 4 (Phase 1): `coin_ledger.ref_key` column (the one migration)

String-keyed references (theme ids) can't fit the UUID `ref_id`; purchases need an audit reference per CLAUDE.md §8.

**Files:**
- Modify: `backend/app/models/ledger.py`
- Modify: `backend/app/services/ledger.py` (`record_coin_delta` signature)
- Create: `backend/alembic/versions/<generated>_coin_ledger_ref_key.py`
- Test: `backend/tests/test_ledger.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_ledger.py` (match the file's existing helper style for creating a user/profile):

```python
async def test_ref_key_stores_string_references(db_session: AsyncSession):
    user = await _user(db_session)  # reuse the file's existing user/profile helper
    row = await record_coin_delta(
        db_session, user.id, -150, "theme_purchase", ref_type="theme", ref_key="midnight"
    )
    assert row.ref_key == "midnight"
    assert row.ref_id is None
```

- [ ] **Step 2: Run it — expect FAIL** (`TypeError: unexpected keyword argument 'ref_key'`)

Run: `uv run pytest tests/test_ledger.py -v`

- [ ] **Step 3: Add the column + thread the kwarg**

In `backend/app/models/ledger.py`, after the `ref_id` column (line 29) add:

```python
    # String-keyed reference for non-UUID refs (e.g. theme ids: ref_type='theme', ref_key='midnight')
    ref_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
```

In `backend/app/services/ledger.py`, add a keyword-only `ref_key: str | None = None` parameter to `record_coin_delta` and pass it into the `CoinLedger(...)` construction. All existing call sites are keyword-based and unaffected.

- [ ] **Step 4: Write the migration**

Run: `uv run alembic revision -m "coin_ledger ref_key for string-keyed references"` (NOT autogenerate — hand-write the one op; verify `down_revision` equals the current head from `uv run alembic heads`, expected `c4d5e6f7a8b9`). Body:

```python
def upgrade() -> None:
    op.add_column("coin_ledger", sa.Column("ref_key", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("coin_ledger", "ref_key")
```

Apply to dev DB: `uv run alembic upgrade head`

- [ ] **Step 5: Run tests — expect PASS** (conftest migrates the test DB to head automatically)

Run: `uv run pytest tests/test_ledger.py -v` then the full `uv run pytest`, `uv run ruff check .`, `uv run mypy app`

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/ledger.py backend/app/services/ledger.py backend/alembic/versions backend/tests/test_ledger.py
git commit -m "feat(ledger): additive ref_key column for string-keyed references"
```

---

### Task 5 (Phase 1): Server-authoritative cosmetic catalog

**Files:**
- Create: `backend/app/core/cosmetics.py`
- Test: `backend/tests/test_cosmetics.py`

- [ ] **Step 1: Write the failing test**

```python
"""Catalog sanity: the server is the source of truth for prices and gating."""

from __future__ import annotations

import pytest
from app.core.cosmetics import CATALOG_BY_ID, COSMETIC_CATALOG, get_item
from app.core.constants import DEFAULT_THEME_ID


def test_catalog_ids_are_unique_and_indexed():
    ids = [item.id for item in COSMETIC_CATALOG]
    assert len(ids) == len(set(ids))
    assert set(CATALOG_BY_ID) == set(ids)


def test_default_theme_is_free_and_present():
    item = get_item(DEFAULT_THEME_ID)
    assert item.kind == "theme" and item.cost == 0 and item.requirement is None


def test_v1_catalog_shape():
    # exactly the five v1 themes; all ungated; paid ones cost what the product decided
    assert {i.id: i.cost for i in COSMETIC_CATALOG} == {
        "royale": 0, "daylight": 0, "bubblegum": 120, "forest": 120, "midnight": 150,
    }
    assert all(i.kind == "theme" and i.requirement is None for i in COSMETIC_CATALOG)


def test_get_item_raises_on_unknown():
    from app.services.vault import UnknownItemError
    with pytest.raises(UnknownItemError):
        get_item("nope")
```

NOTE: `UnknownItemError` lives in `app/services/vault.py` (Task 6). To keep this task self-contained, define the exception in `app/core/cosmetics.py` instead and have Task 6 re-export it: `from app.core.cosmetics import UnknownItemError`. Adjust the test import to `from app.core.cosmetics import UnknownItemError`.

- [ ] **Step 2: Run — expect FAIL** (`ModuleNotFoundError`)

Run: `uv run pytest tests/test_cosmetics.py -v`

- [ ] **Step 3: Implement the catalog**

`backend/app/core/cosmetics.py`:

```python
"""Cosmetic catalog (server-authoritative; PLAN.md §6, §11, DESIGN.md §6).

The SERVER owns prices and unlock gating — the frontend's theme list (tokens.ts) is visuals only
and never sends a price. Catalog is code, not DB (same pattern as services/templates.py): versioned,
reviewable, no admin tooling. V1 is themes-only; `kind` is the forward seam for frames (Phase 3).

Coins are cosmetic-only (CLAUDE.md §8): items never grant any competitive advantage.
"""

from __future__ import annotations

from dataclasses import dataclass


class UnknownItemError(Exception):
    """Item id not in the catalog."""


@dataclass(frozen=True)
class CosmeticItem:
    id: str
    kind: str  # "theme" (v1); "frame" later
    cost: int  # coins; 0 = free (implicitly owned by everyone)
    # None = always purchasable. A non-None requirement is LOCKED until a checker exists (Phase 4
    # wires campaign-progress checks); v1 ships no gated items.
    requirement: str | None = None


COSMETIC_CATALOG: tuple[CosmeticItem, ...] = (
    CosmeticItem(id="royale", kind="theme", cost=0),
    CosmeticItem(id="daylight", kind="theme", cost=0),
    CosmeticItem(id="bubblegum", kind="theme", cost=120),
    CosmeticItem(id="forest", kind="theme", cost=120),
    CosmeticItem(id="midnight", kind="theme", cost=150),
)

CATALOG_BY_ID: dict[str, CosmeticItem] = {item.id: item for item in COSMETIC_CATALOG}


def get_item(item_id: str) -> CosmeticItem:
    try:
        return CATALOG_BY_ID[item_id]
    except KeyError as exc:
        raise UnknownItemError(item_id) from exc
```

- [ ] **Step 4: Run — expect PASS**, then `ruff check` + `mypy app`

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/cosmetics.py backend/tests/test_cosmetics.py
git commit -m "feat(vault): server-authoritative cosmetic catalog"
```

---

### Task 6 (Phase 1): Vault service — buy / equip / list

**Files:**
- Create: `backend/app/services/vault.py`
- Test: `backend/tests/test_vault.py` (service-level half)

- [ ] **Step 1: Write the failing service tests**

`backend/tests/test_vault.py`:

```python
"""Vault service + API: purchases spend through the ledger, grant user_themes, never touch rank."""

from __future__ import annotations

import uuid

import pytest
from app.models import CoinLedger, Profile, Standing, User, UserTheme
from app.services.ledger import record_coin_delta
from app.services.vault import (
    AlreadyOwnedError,
    InsufficientCoinsError,
    NotOwnedError,
    RequirementNotMetError,
    buy_item,
    equip_item,
    get_vault,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def _user(session: AsyncSession, *, coins: int = 0) -> User:
    user = User(email=f"{uuid.uuid4().hex}@t.test", password_hash="x")
    session.add(user)
    await session.flush()
    session.add(
        Profile(
            user_id=user.id, username=f"u{uuid.uuid4().hex[:10]}", division="Bronze", rating=1000
        )
    )
    session.add(UserTheme(user_id=user.id, theme_id="royale"))  # mirrors registration
    await session.flush()
    if coins:
        await record_coin_delta(session, user.id, coins, "signup_bonus")
    return user


async def _ledger_rows(session: AsyncSession, user_id: uuid.UUID) -> list[CoinLedger]:
    return list(
        (await session.execute(select(CoinLedger).where(CoinLedger.user_id == user_id))).scalars()
    )


async def test_buy_spends_through_ledger_and_grants_ownership(db_session: AsyncSession):
    user = await _user(db_session, coins=200)
    balance = await buy_item(db_session, user.id, "midnight")
    assert balance == 50

    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.coins_balance == 50
    assert await db_session.get(UserTheme, (user.id, "midnight")) is not None

    rows = await _ledger_rows(db_session, user.id)
    purchase = [r for r in rows if r.reason == "theme_purchase"]
    assert len(purchase) == 1
    assert purchase[0].delta == -150
    assert purchase[0].ref_type == "theme" and purchase[0].ref_key == "midnight"
    # invariant: cache equals ledger sum
    total = sum(r.delta for r in rows)
    assert profile.coins_balance == total


async def test_buy_insufficient_coins_changes_nothing(db_session: AsyncSession):
    user = await _user(db_session, coins=100)
    with pytest.raises(InsufficientCoinsError):
        await buy_item(db_session, user.id, "midnight")
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.coins_balance == 100
    assert await db_session.get(UserTheme, (user.id, "midnight")) is None
    assert all(r.reason != "theme_purchase" for r in await _ledger_rows(db_session, user.id))


async def test_buy_twice_raises_already_owned_and_never_double_debits(db_session: AsyncSession):
    user = await _user(db_session, coins=400)
    await buy_item(db_session, user.id, "midnight")
    with pytest.raises(AlreadyOwnedError):
        await buy_item(db_session, user.id, "midnight")
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.coins_balance == 250  # debited exactly once


async def test_free_items_are_implicitly_owned_not_buyable(db_session: AsyncSession):
    user = await _user(db_session, coins=100)
    with pytest.raises(AlreadyOwnedError):
        await buy_item(db_session, user.id, "daylight")


async def test_gated_item_raises_requirement_not_met(db_session: AsyncSession, monkeypatch):
    from app.core import cosmetics

    gated = cosmetics.CosmeticItem(id="gated", kind="theme", cost=10, requirement="world:Science")
    monkeypatch.setitem(cosmetics.CATALOG_BY_ID, "gated", gated)
    user = await _user(db_session, coins=100)
    with pytest.raises(RequirementNotMetError):
        await buy_item(db_session, user.id, "gated")


async def test_equip_owned_and_free_themes(db_session: AsyncSession):
    user = await _user(db_session, coins=200)
    await buy_item(db_session, user.id, "midnight")
    assert await equip_item(db_session, user.id, "midnight") == "midnight"
    profile = await db_session.get(Profile, user.id)
    assert profile is not None and profile.equipped_theme == "midnight"
    # free theme equips without an ownership row
    assert await equip_item(db_session, user.id, "daylight") == "daylight"


async def test_equip_unowned_paid_theme_raises(db_session: AsyncSession):
    user = await _user(db_session)
    with pytest.raises(NotOwnedError):
        await equip_item(db_session, user.id, "midnight")


async def test_purchase_never_touches_rank_or_standings(db_session: AsyncSession):
    """The fairness contract: buying cosmetics changes coins_balance and nothing else."""
    user = await _user(db_session, coins=200)
    before = await db_session.get(Profile, user.id)
    assert before is not None
    rating, division, streak = before.rating, before.division, before.streak_count

    await buy_item(db_session, user.id, "midnight")

    after = await db_session.get(Profile, user.id)
    assert after is not None
    assert (after.rating, after.division, after.streak_count) == (rating, division, streak)
    standings = (await db_session.execute(select(func.count()).select_from(Standing))).scalar_one()
    assert standings == 0


async def test_get_vault_reports_owned_equipped_and_locked(db_session: AsyncSession):
    user = await _user(db_session, coins=200)
    await buy_item(db_session, user.id, "midnight")

    items, balance = await get_vault(db_session, user.id)
    assert balance == 50
    by_id = {i.id: i for i in items}
    assert by_id["royale"].owned and by_id["royale"].equipped  # registration default
    assert by_id["daylight"].owned and not by_id["daylight"].equipped  # free = implicitly owned
    assert by_id["midnight"].owned and not by_id["midnight"].equipped
    assert not by_id["bubblegum"].owned and by_id["bubblegum"].cost == 120
    assert all(not i.locked for i in items)  # no gated items in the v1 catalog
```

- [ ] **Step 2: Run — expect FAIL** (`ModuleNotFoundError: app.services.vault`)

Run: `uv run pytest tests/test_vault.py -v`

- [ ] **Step 3: Implement the service**

`backend/app/services/vault.py`:

```python
"""Vault service (PLAN.md §6, §11): buy/equip/list cosmetics. Coins are cosmetic-only.

A purchase is ONE transaction (the request boundary commits, this service never does):
debit through the append-only ledger (reason='theme_purchase', ref_type='theme', ref_key=<id>)
+ grant ownership in user_themes. record_coin_delta locks the profile row FOR UPDATE, which
serializes concurrent buys; the user_themes composite PK is the idempotency backstop — a
concurrent duplicate rolls the whole transaction back, so a double debit is impossible.

Purchases must never touch rating/division/streak/standings (tested invariant).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cosmetics import COSMETIC_CATALOG, CosmeticItem, UnknownItemError, get_item
from app.models import Profile, UserTheme
from app.services.ledger import record_coin_delta

__all__ = [
    "AlreadyOwnedError",
    "InsufficientCoinsError",
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
    owned: bool
    equipped: bool
    locked: bool
    requirement: str | None


def _requirement_met(item: CosmeticItem) -> bool:
    # V1: no gated items ship; ANY requirement is unmet until the campaign-progress checker
    # lands (Phase 4). Correct-by-construction: a gated item can never be bought early.
    return item.requirement is None


async def _owned(session: AsyncSession, user_id: uuid.UUID, item: CosmeticItem) -> bool:
    if item.cost == 0:
        return True  # free items are implicitly owned by everyone (no row needed; signup untouched)
    return await session.get(UserTheme, (user_id, item.id)) is not None


async def get_vault(
    session: AsyncSession, user_id: uuid.UUID
) -> tuple[list[VaultItemView], int]:
    profile = await session.get(Profile, user_id)
    if profile is None:
        raise UnknownItemError("profile")  # unreachable for an authed user; defensive
    owned_ids = {
        t.theme_id
        for t in (
            await session.execute(select(UserTheme).where(UserTheme.user_id == user_id))
        ).scalars()
    }
    items = [
        VaultItemView(
            id=item.id,
            kind=item.kind,
            cost=item.cost,
            owned=item.cost == 0 or item.id in owned_ids,
            equipped=item.id == profile.equipped_theme,
            locked=not _requirement_met(item),
            requirement=item.requirement,
        )
        for item in COSMETIC_CATALOG
    ]
    return items, profile.coins_balance


async def buy_item(session: AsyncSession, user_id: uuid.UUID, item_id: str) -> int:
    """Buy a catalog item. Returns the new coin balance. Raises on every non-happy path."""
    item = get_item(item_id)
    if item.cost == 0 or await session.get(UserTheme, (user_id, item.id)) is not None:
        raise AlreadyOwnedError(item_id)
    if not _requirement_met(item):
        raise RequirementNotMetError(item_id)

    profile = (
        await session.execute(
            select(Profile).where(Profile.user_id == user_id).with_for_update()
        )
    ).scalar_one()
    if profile.coins_balance < item.cost:
        raise InsufficientCoinsError(item_id)

    await record_coin_delta(
        session, user_id, -item.cost, "theme_purchase", ref_type="theme", ref_key=item.id
    )
    session.add(UserTheme(user_id=user_id, theme_id=item.id))
    try:
        await session.flush()
    except IntegrityError as exc:  # concurrent duplicate buy lost the race → whole tx rolls back
        raise AlreadyOwnedError(item_id) from exc
    return profile.coins_balance


async def equip_item(session: AsyncSession, user_id: uuid.UUID, item_id: str) -> str:
    """Equip an owned (or free) theme. Returns the equipped theme id."""
    item = get_item(item_id)
    if item.kind != "theme":
        raise UnknownItemError(item_id)  # v1: only themes are equippable
    if not await _owned(session, user_id, item):
        raise NotOwnedError(item_id)
    profile = await session.get(Profile, user_id)
    if profile is None:
        raise NotOwnedError(item_id)
    profile.equipped_theme = item.id
    await session.flush()
    return item.id
```

- [ ] **Step 4: Run — expect PASS**, then full `uv run pytest`, `ruff check .`, `mypy app`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/vault.py backend/tests/test_vault.py
git commit -m "feat(vault): buy/equip/list service - coins spent through the ledger"
```

---

### Task 7 (Phase 1): Vault schemas + API endpoints

**Files:**
- Create: `backend/app/schemas/vault.py`
- Create: `backend/app/api/vault.py`
- Modify: `backend/app/main.py` (router registration, after `campaign.router`)
- Test: `backend/tests/test_vault.py` (append the API half)

- [ ] **Step 1: Write the failing API tests**

Append to `backend/tests/test_vault.py`. Authentication: reuse the exact register-then-login helper pattern from `backend/tests/test_campaign.py` (read it first; it registers via the auth endpoints and returns an authed header/client). The contract to assert:

```python
# --- API half (httpx client; reuse test_campaign.py's auth helper pattern) ---

async def test_vault_endpoints_full_flow(client, db_session: AsyncSession):
    headers = await _register_and_login(client)  # copy helper from test_campaign.py
    user_id = await _user_id_from_me(client, headers)  # GET /me → user_id

    # seed coins (campaign would normally pay these)
    await record_coin_delta(db_session, user_id, 200, "campaign_first_clear")

    # GET /vault
    r = await client.get("/vault", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["coins_balance"] == 200
    by_id = {i["id"]: i for i in body["items"]}
    assert by_id["midnight"] == {
        "id": "midnight", "kind": "theme", "cost": 150,
        "owned": False, "equipped": False, "locked": False, "requirement": None,
    }

    # buy
    r = await client.post("/vault/midnight/buy", headers=headers)
    assert r.status_code == 200
    assert r.json() == {"item_id": "midnight", "coins_balance": 50}

    # buy again → 409
    r = await client.post("/vault/midnight/buy", headers=headers)
    assert r.status_code == 409

    # insufficient for another paid theme → 400 with machine-readable detail
    r = await client.post("/vault/bubblegum/buy", headers=headers)
    assert r.status_code == 400
    assert r.json()["detail"] == "insufficient_coins"

    # unknown ids → 404
    assert (await client.post("/vault/nope/buy", headers=headers)).status_code == 404
    assert (await client.post("/vault/nope/equip", headers=headers)).status_code == 404

    # equip owned → 200 and /me reflects it
    r = await client.post("/vault/midnight/equip", headers=headers)
    assert r.status_code == 200 and r.json() == {"equipped_theme": "midnight"}
    me = (await client.get("/me", headers=headers)).json()
    assert me["equipped_theme"] == "midnight" and me["coins_balance"] == 50

    # equip an unowned paid theme → 403
    r = await client.post("/vault/forest/equip", headers=headers)
    assert r.status_code == 403 and r.json()["detail"] == "not_owned"
```

(If `test_campaign.py`'s helpers have different names/shape, mirror them faithfully — the asserted status codes/bodies above are the contract.)

- [ ] **Step 2: Run — expect FAIL** (404s: routes don't exist)

Run: `uv run pytest tests/test_vault.py -v`

- [ ] **Step 3: Implement schemas + router**

`backend/app/schemas/vault.py`:

```python
"""Vault API shapes. Prices come FROM the server only — no request body ever carries a price."""

from __future__ import annotations

from pydantic import BaseModel


class VaultItemOut(BaseModel):
    id: str
    kind: str
    cost: int
    owned: bool
    equipped: bool
    locked: bool
    requirement: str | None


class VaultResponse(BaseModel):
    items: list[VaultItemOut]
    coins_balance: int


class BuyResponse(BaseModel):
    item_id: str
    coins_balance: int


class EquipResponse(BaseModel):
    equipped_theme: str
```

`backend/app/api/vault.py`:

```python
"""Vault endpoints (cosmetics; coins are cosmetic-only). The item id in the path is the whole
request — buy/equip take no body, so a client can never send a price."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_session
from app.models import User
from app.schemas.vault import BuyResponse, EquipResponse, VaultItemOut, VaultResponse
from app.services.vault import (
    AlreadyOwnedError,
    InsufficientCoinsError,
    NotOwnedError,
    RequirementNotMetError,
    UnknownItemError,
    buy_item,
    equip_item,
    get_vault,
)

router = APIRouter(prefix="/vault", tags=["vault"])


@router.get("", response_model=VaultResponse)
async def vault(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> VaultResponse:
    items, balance = await get_vault(session, user.id)
    return VaultResponse(
        items=[VaultItemOut(**vars(i)) for i in items], coins_balance=balance
    )


@router.post("/{item_id}/buy", response_model=BuyResponse)
async def buy(
    item_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BuyResponse:
    try:
        balance = await buy_item(session, user.id, item_id)
    except UnknownItemError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown_item") from None
    except AlreadyOwnedError:
        raise HTTPException(status.HTTP_409_CONFLICT, "already_owned") from None
    except InsufficientCoinsError:
        # 400, not 402: "Payment Required" is money-language this product deliberately avoids
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "insufficient_coins") from None
    except RequirementNotMetError:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "requirement_not_met") from None
    return BuyResponse(item_id=item_id, coins_balance=balance)


@router.post("/{item_id}/equip", response_model=EquipResponse)
async def equip(
    item_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> EquipResponse:
    try:
        equipped = await equip_item(session, user.id, item_id)
    except UnknownItemError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown_item") from None
    except NotOwnedError:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not_owned") from None
    return EquipResponse(equipped_theme=equipped)
```

In `backend/app/main.py`: import `vault` alongside the other api modules and add `app.include_router(vault.router)` after the `campaign.router` line (main.py:59).

- [ ] **Step 4: Run — expect PASS**, then full `uv run pytest`, `ruff check .`, `mypy app`

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/vault.py backend/app/api/vault.py backend/app/main.py backend/tests/test_vault.py
git commit -m "feat(vault): GET /vault + buy/equip endpoints"
```

---

### Task 8 (Phase 2): Theme catalog port + "Vault"→"Daylight" rename + tokens test

**Files:**
- Modify: `frontend/src/theme/tokens.ts`
- Create: `frontend/src/theme/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

`frontend/src/theme/tokens.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, THEMES, getTheme } from "@/theme/tokens";

// Every theme must carry the full var contract — a missing var renders broken surfaces app-wide
// the moment the theme is equipped (tokens.ts header: every theme carries --brand/--brand-2/--faint).
const REQUIRED_VARS = [
  "--bg", "--panel", "--panel2", "--line", "--brand", "--brand-2",
  "--cyan", "--lime", "--amber", "--pink", "--text", "--muted", "--faint", "--btnText",
];

describe("theme tokens", () => {
  it("has unique ids and includes the v1 vault catalog", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["royale", "daylight", "bubblegum", "forest", "midnight"]) {
      expect(ids).toContain(id);
    }
  });

  it("every theme carries the full CSS var contract", () => {
    for (const theme of THEMES) {
      for (const key of REQUIRED_VARS) {
        expect(theme.vars[key], `${theme.id} missing ${key}`).toBeTruthy();
      }
    }
  });

  it("renamed the daylight theme so it cannot be confused with the Vault page", () => {
    expect(getTheme("daylight").name).toBe("Daylight");
    expect(THEMES.some((t) => t.name.toLowerCase() === "vault")).toBe(false);
  });

  it("falls back to the default theme for unknown ids", () => {
    expect(getTheme("nope").id).toBe(DEFAULT_THEME_ID);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (new themes missing; name still "Vault")

Run: `npx vitest run src/theme`

- [ ] **Step 3: Implement**

In `frontend/src/theme/tokens.ts`:
(a) Change `daylight`'s `name: "Vault"` → `name: "Daylight"` and blurb to `"Calm daylight green & gold (light mode)"`. **Do NOT change the id** — `daylight` exists in prod `equipped_theme` values.
(b) Append three themes, vars copied verbatim from `RotRoyale.jsx:39-53` plus the brand/faint vars the JSX versions lack (values below chosen to match each palette):

```typescript
  {
    id: "bubblegum",
    name: "Bubblegum",
    cost: 120,
    style: "soft",
    blurb: "Candy pink & violet, extra bouncy",
    vars: {
      "--bg":
        "radial-gradient(820px 460px at 84% -12%, rgba(255,120,190,.36), transparent 60%), radial-gradient(760px 560px at -10% 112%, rgba(150,120,255,.30), transparent 58%), #fff0f8",
      "--panel": "#ffffff",
      "--panel2": "#ffe9f5",
      "--line": "#f6d9ec",
      "--brand": "#a06bff",
      "--brand-2": "#c08bff",
      "--cyan": "#ff9ad1",
      "--lime": "#ff5fa2",
      "--pink": "#a06bff",
      "--amber": "#ffc94d",
      "--text": "#4a2a44",
      "--muted": "#bf93b3",
      "--faint": "#d9b8d0",
      "--btnText": "#ffffff",
    },
  },
  {
    id: "forest",
    name: "Evergreen",
    cost: 120,
    style: "soft",
    blurb: "Mossy greens & amber, easy on the eyes",
    vars: {
      "--bg":
        "radial-gradient(820px 460px at 84% -12%, rgba(70,200,150,.30), transparent 60%), radial-gradient(760px 560px at -10% 112%, rgba(245,180,60,.22), transparent 58%), #f3f8f1",
      "--panel": "#ffffff",
      "--panel2": "#e9f5ec",
      "--line": "#d6ebda",
      "--brand": "#27c08a",
      "--brand-2": "#4fd6a6",
      "--cyan": "#9a7b4f",
      "--lime": "#27c08a",
      "--pink": "#ff7a59",
      "--amber": "#f5b53d",
      "--text": "#1f3a2e",
      "--muted": "#7e9587",
      "--faint": "#a8bfb0",
      "--btnText": "#ffffff",
    },
  },
  {
    id: "midnight",
    name: "Midnight Arcade",
    cost: 150,
    style: "soft",
    blurb: "Neon glow on black (the old look)",
    vars: {
      "--bg":
        "radial-gradient(900px 500px at 80% -10%, rgba(255,46,136,.20), transparent 60%), radial-gradient(800px 600px at -10% 110%, rgba(255,176,46,.16), transparent 55%), #08070f",
      "--panel": "#14121f",
      "--panel2": "#1d1a2c",
      "--line": "#2a2740",
      "--brand": "#a06bff",
      "--brand-2": "#c08bff",
      "--cyan": "#a06bff",
      "--lime": "#c7f73a",
      "--pink": "#ff2e88",
      "--amber": "#ffb02e",
      "--text": "#f5f2ff",
      "--muted": "#8e89ad",
      "--faint": "#6f6a8a",
      "--btnText": "#08070f",
    },
  },
```

Note: `cost` in tokens.ts is now **display-irrelevant** (the Vault prices from the API) but is kept in sync with the server catalog for honesty. Add this comment to the `cost` field doc in the `Theme` interface: `// kept in sync with the server catalog (app/core/cosmetics.py) but NEVER used for purchases — the server price is the source of truth.`

- [ ] **Step 4: Run — expect PASS**, then `npm run typecheck` + the full `npx vitest run` (the `daylight` rename can't break tests that reference ids, but verify nothing referenced the display name)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theme
git commit -m "feat(theme): port bubblegum/evergreen/midnight; rename Vault theme to Daylight"
```

---

### Task 9 (Phase 2): API client — vault methods + types

**Files:**
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Add types + methods**

In `client.ts`, follow the existing interface/method style. Types (near the other response interfaces):

```typescript
export interface VaultItem {
  id: string;
  kind: string; // "theme" in v1
  cost: number;
  owned: boolean;
  equipped: boolean;
  locked: boolean;
  requirement: string | null;
}

export interface VaultResponse {
  items: VaultItem[];
  coins_balance: number;
}

export interface BuyVaultResponse {
  item_id: string;
  coins_balance: number;
}

export interface EquipVaultResponse {
  equipped_theme: string;
}
```

Methods (in the `api` object, near `me`):

```typescript
  vault: () => authedRequest<VaultResponse>("/vault"),

  buyVaultItem: (itemId: string) =>
    authedRequest<BuyVaultResponse>(`/vault/${itemId}/buy`, { method: "POST" }),

  equipVaultItem: (itemId: string) =>
    authedRequest<EquipVaultResponse>(`/vault/${itemId}/equip`, { method: "POST" }),
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: clean. (No unit test for the client wrapper — it's pure plumbing over `authedRequest`, consistent with the file's existing untested methods; behavior is covered by the screen test in Task 11.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat(api): vault client methods"
```

---

### Task 10 (Phase 2): i18n — vault strings (en/es/tr)

**Files:**
- Modify: `frontend/src/i18n/en.ts`, `frontend/src/i18n/es.ts`, `frontend/src/i18n/tr.ts`

- [ ] **Step 1: Add the `vault` section to all three locales**

The key-parity + banned-word tests in `src/i18n/i18n.test.ts` will fail the build if a locale is missed or a banned word slips in (banned includes "payout" — never use it). Match each file's existing style/terminology (`coins`→"monedas"/"jeton").

`en.ts`:

```typescript
  vault: {
    title: "THE VAULT",
    subtitle: "SPEND COINS ON STYLE — NEVER ON RANK",
    balance: "Your coins",
    themes: "Themes",
    equip: "Equip",
    equipped: "Equipped",
    owned: "Owned",
    unlockFor: "Unlock", // shown next to a CoinIcon + price
    shortfall: "Earn {n} more coins",
    confirmTitle: "Unlock {name}?",
    confirmBody: "Spend {cost} coins on this theme. Coins are cosmetic — they never affect rank.",
    confirmUnlock: "Unlock",
    cancel: "Cancel",
    lockedLabel: "Locked",
    back: "Back",
    menuLabel: "The Vault",
    openVault: "Open the Vault",
    cosmeticNote: "Coins are cosmetic — they unlock themes, never rank.",
  },
```

`es.ts`:

```typescript
  vault: {
    title: "LA BÓVEDA",
    subtitle: "GASTA MONEDAS EN ESTILO — NUNCA EN RANGO",
    balance: "Tus monedas",
    themes: "Temas",
    equip: "Equipar",
    equipped: "Equipado",
    owned: "Tuyo",
    unlockFor: "Desbloquear",
    shortfall: "Gana {n} monedas más",
    confirmTitle: "¿Desbloquear {name}?",
    confirmBody: "Gasta {cost} monedas en este tema. Las monedas son cosméticas — nunca afectan al rango.",
    confirmUnlock: "Desbloquear",
    cancel: "Cancelar",
    lockedLabel: "Bloqueado",
    back: "Volver",
    menuLabel: "La Bóveda",
    openVault: "Abrir la Bóveda",
    cosmeticNote: "Las monedas son cosméticas — desbloquean temas, nunca el rango.",
  },
```

`tr.ts`:

```typescript
  vault: {
    title: "KASA",
    subtitle: "JETONLARI TARZA HARCA — ASLA SIRALAMAYA DEĞİL",
    balance: "Jetonların",
    themes: "Temalar",
    equip: "Kuşan",
    equipped: "Kuşanıldı",
    owned: "Senin",
    unlockFor: "Aç",
    shortfall: "{n} jeton daha kazan",
    confirmTitle: "{name} açılsın mı?",
    confirmBody: "Bu temaya {cost} jeton harca. Jetonlar kozmetiktir — sıralamayı asla etkilemez.",
    confirmUnlock: "Aç",
    cancel: "Vazgeç",
    lockedLabel: "Kilitli",
    back: "Geri",
    menuLabel: "Kasa",
    openVault: "Kasayı aç",
    cosmeticNote: "Jetonlar kozmetiktir — temaları açar, sıralamayı asla etkilemez.",
  },
```

Before finalizing, skim each locale file's existing `campaign`/`home` sections and align word choices (e.g. if tr uses a different verb for "unlock" in campaign strings, reuse it).

- [ ] **Step 2: Run the i18n tests**

Run: `npx vitest run src/i18n`
Expected: PASS (key parity across locales, no empty values, matching `{tokens}`, no banned words).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/i18n
git commit -m "feat(i18n): vault strings in en/es/tr"
```

---

### Task 11 (Phase 2): VaultScreen + VaultItemCard + tests

**Files:**
- Create: `frontend/src/screens/vault/VaultItemCard.tsx`
- Create: `frontend/src/screens/vault/VaultScreen.tsx`
- Create: `frontend/src/screens/vault/VaultScreen.test.tsx`

Before coding, read `frontend/src/ui/GlassCard.tsx`, `GoldButton.tsx`, `Display.tsx`, `CoinIcon.tsx`, `CountUp.tsx`, `Confetti.tsx` for their actual props, and `frontend/src/screens/leaderboard/LeaderboardScreen.tsx` for the screen-scaffold pattern (back button, header, data fetch in `useEffect`, loading state). Match those conventions over the sketches below where they differ.

- [ ] **Step 1: Write the failing tests**

`VaultScreen.test.tsx` (mock `@/api/client`; follow `LeaderboardScreen.test.tsx`'s render/mocking style):

```tsx
// Contracts to assert (adapt mocking style from LeaderboardScreen.test.tsx):

// 1. Renders one card per item from GET /vault, with server prices (not tokens.ts costs).
// 2. Card states from a fixture VaultResponse:
//    - equipped item shows t.vault.equipped and no buy/equip CTA
//    - owned-but-not-equipped shows an Equip button
//    - affordable unowned shows Unlock + cost
//    - unaffordable unowned shows fmt(t.vault.shortfall, {n: cost - balance}) and a disabled CTA
// 3. Buying: tapping Unlock opens the confirm step; confirming calls api.buyVaultItem("midnight")
//    exactly once; on a mocked success the balance text updates to the RESPONSE value (50), the
//    card flips to Equip. Assert NO client-side subtraction (mock returns a surprising balance,
//    e.g. 57 — the UI must show 57).
// 4. Equipping: calls api.equipVaultItem and calls useSessionStore setMe with equipped_theme from
//    the RESPONSE (mock the store like other screen tests do, or assert via store state).
// 5. Copy guard: render full screen, assert rendered HTML contains none of
//    ["cash","prize","wager","gambl","jackpot","casino","lottery","payout","player"]
//    (copy the loop from LeaderboardScreen.test.tsx:51-56).
```

Write these as real executable tests (the comment block is the spec — each numbered item becomes one `it()`).

- [ ] **Step 2: Run — expect FAIL** (module doesn't exist)

Run: `npx vitest run src/screens/vault`

- [ ] **Step 3: Implement `VaultItemCard.tsx`**

```tsx
import { fmt, useT } from "@/i18n/useT";
import type { VaultItem } from "@/api/client";
import { getTheme } from "@/theme/tokens";
import { CoinIcon } from "@/ui/CoinIcon";
import { GlassCard } from "@/ui/GlassCard";

/**
 * One theme card. State machine (exactly one CTA per card):
 *   equipped → "Equipped" badge, no action
 *   owned    → Equip button
 *   locked   → locked label + requirement copy (unreachable with the v1 catalog; state exists
 *              so Phase 4 gating needs no card rework)
 *   affordable   → Unlock + price (opens the confirm step in the parent)
 *   unaffordable → disabled CTA with the exact shortfall
 * Prices come from the SERVER item (item.cost via GET /vault), never tokens.ts.
 * The swatch renders the theme's own vars so every card previews its palette live.
 */
export function VaultItemCard({
  item,
  balance,
  busy,
  onBuy,
  onEquip,
}: {
  item: VaultItem;
  balance: number;
  busy: boolean;
  onBuy: () => void;
  onEquip: () => void;
}) {
  const t = useT();
  const theme = getTheme(item.id);
  const affordable = balance >= item.cost;

  // Swatch: the theme's world in miniature — bg, panel, and its gold/brand accents.
  const swatch = (
    <div
      aria-hidden
      style={{
        height: 64,
        borderRadius: 14,
        background: theme.vars["--bg"],
        border: `1px solid ${theme.vars["--line"]}`,
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        padding: 8,
      }}
    >
      <div style={{ flex: 1, height: 22, borderRadius: 8, background: theme.vars["--panel"] }} />
      <div style={{ width: 34, height: 22, borderRadius: 8, background: theme.vars["--amber"] }} />
      <div style={{ width: 22, height: 22, borderRadius: "50%", background: theme.vars["--brand"] }} />
    </div>
  );

  let cta: React.ReactNode;
  if (item.equipped) {
    cta = <span className="display" style={{ color: "var(--lime)", fontSize: 14 }}>{t.vault.equipped}</span>;
  } else if (item.owned) {
    cta = (
      <button type="button" disabled={busy} onClick={onEquip} style={ctaStyle("var(--brand)", "#fff")}>
        {t.vault.equip}
      </button>
    );
  } else if (item.locked) {
    cta = <span style={{ color: "var(--faint)", fontWeight: 800, fontSize: 13 }}>🔒 {t.vault.lockedLabel}</span>;
  } else if (affordable) {
    cta = (
      <button type="button" disabled={busy} onClick={onBuy} style={ctaStyle("linear-gradient(180deg, #FFD24A, #FFB300)", "var(--btnText)")}>
        {t.vault.unlockFor} <CoinIcon size={14} /> {item.cost}
      </button>
    );
  } else {
    cta = (
      <button type="button" disabled style={{ ...ctaStyle("var(--panel2)", "var(--faint)"), cursor: "default" }}>
        {fmt(t.vault.shortfall, { n: item.cost - balance })}
      </button>
    );
  }

  return (
    <GlassCard>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {swatch}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, color: "var(--text)" }}>{theme.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{theme.blurb}</div>
          </div>
          {cta}
        </div>
      </div>
    </GlassCard>
  );
}

function ctaStyle(background: string, color: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "9px 14px",
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 13,
    whiteSpace: "nowrap",
    background,
    color,
  };
}
```

(Adapt `GlassCard` usage to its real props — if it doesn't accept bare children with no props, match how other screens use it.)

- [ ] **Step 4: Implement `VaultScreen.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, type VaultItem } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { useSessionStore } from "@/store/session";
import { CoinIcon } from "@/ui/CoinIcon";
import { Confetti } from "@/ui/Confetti";
import { Display } from "@/ui/Display";
import { VaultItemCard } from "@/screens/vault/VaultItemCard";

/**
 * The Vault: spend coins on themes (cosmetic-only — the subtitle says so explicitly).
 * All coin/ownership state comes from SERVER responses: GET /vault renders, buy/equip responses
 * patch — there is no client-side coin math and no optimistic flip. Buttons disable while a
 * mutation is in flight; a 409 on buy is treated as "already owned" → just refetch.
 */
export function VaultScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  const me = useSessionStore((s) => s.me);
  const setMe = useSessionStore((s) => s.setMe);
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [balance, setBalance] = useState(0);
  const [confirming, setConfirming] = useState<VaultItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(0);

  async function refresh() {
    const res = await api.vault();
    setItems(res.items);
    setBalance(res.coins_balance);
  }

  useEffect(() => {
    refresh().catch(() => setItems([]));
  }, []);

  async function buy(item: VaultItem) {
    setBusy(true);
    try {
      const res = await api.buyVaultItem(item.id);
      setBalance(res.coins_balance);
      if (me) setMe({ ...me, coins_balance: res.coins_balance });
      setBurst((k) => k + 1); // one celebratory burst; Confetti is reduced-motion aware
      await refresh();
    } catch {
      await refresh(); // 409 already-owned / anything else → server state wins
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  async function equip(item: VaultItem) {
    setBusy(true);
    try {
      const res = await api.equipVaultItem(item.id);
      if (me) setMe({ ...me, equipped_theme: res.equipped_theme }); // App reskins instantly
      await refresh();
    } catch {
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", padding: "18px 16px 90px", maxWidth: 520, margin: "0 auto" }}>
      {burst > 0 && <Confetti burstKey={burst} count={90} />}

      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <button type="button" onClick={onBack} aria-label={t.vault.back} style={{ border: "none", background: "transparent", color: "var(--muted)", fontWeight: 800, cursor: "pointer", fontSize: 15 }}>
          ← {t.vault.back}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 12px", borderRadius: 999, background: "var(--panel)", border: "1px solid var(--line)" }}>
          <CoinIcon size={16} />
          <span className="display" style={{ fontSize: 17, color: "var(--amber)" }}>{balance}</span>
        </div>
      </header>

      <div style={{ marginTop: 14, marginBottom: 4 }}>
        <Display pop style={{ fontSize: 30 }}>{t.vault.title}</Display>
        <div style={{ color: "var(--muted)", fontWeight: 800, fontSize: 12, letterSpacing: 1 }}>{t.vault.subtitle}</div>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
        {items === null ? (
          <div style={{ color: "var(--muted)", textAlign: "center", padding: 30 }}>…</div>
        ) : (
          items.map((item) => (
            <VaultItemCard
              key={item.id}
              item={item}
              balance={balance}
              busy={busy}
              onBuy={() => setConfirming(item)}
              onEquip={() => void equip(item)}
            />
          ))
        )}
      </section>

      <p style={{ marginTop: 16, fontSize: 12, color: "var(--faint)", textAlign: "center" }}>{t.vault.cosmeticNote}</p>

      {confirming && (
        <ConfirmSheet
          item={confirming}
          busy={busy}
          onConfirm={() => void buy(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </main>
  );
}

function ConfirmSheet({ item, busy, onConfirm, onCancel }: { item: VaultItem; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const t = useT();
  const name = (await-free) // use getTheme(item.id).name — see note below
  return ( /* fixed-position dim layer + panel, same overlay pattern as ProfileMenu.tsx:58-75;
              title fmt(t.vault.confirmTitle, {name}), body fmt(t.vault.confirmBody, {cost: item.cost}),
              gold confirm button (t.vault.confirmUnlock, disabled when busy) + plain cancel */ );
}
```

NOTE for the implementer: the `ConfirmSheet` sketch above is intentionally abbreviated — implement it fully: `const name = getTheme(item.id).name;`, overlay button + panel styled like `ProfileMenu.tsx`'s popover, two buttons. Everything else in the file is complete as written (adjust `Confetti`/`Display` props to their real signatures).

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run src/screens/vault` then `npm run typecheck; npm run lint`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/vault
git commit -m "feat(vault): Vault screen - themes catalog, buy + equip"
```

---

### Task 12 (Phase 2): Wire the Vault into the app (coin pill + ProfileMenu) + final verification

**Files:**
- Modify: `frontend/src/app/App.tsx`
- Modify: `frontend/src/screens/home/HomeHeader.tsx`
- Modify: `frontend/src/screens/home/ProfileMenu.tsx`
- Modify: `frontend/src/screens/Home.tsx`

- [ ] **Step 1: App.tsx — vault route state**

Mirror the `leaderboardOpen` pattern exactly (App.tsx:27,44-46,102-108): add `const [vaultOpen, setVaultOpen] = useState(false);`, render `if (vaultOpen) return <VaultScreen onBack={() => setVaultOpen(false)} />;` FIRST in `authenticatedView()` (above the leaderboard branch), pass `onVault={() => setVaultOpen(true)}` to `<Home>`, and include `!vaultOpen` in `isAuthedHome`. Do NOT add `vaultOpen` to `hasInlineSelector` (the Vault has no inline language selector → it gets the floating one, same as Contest/Practice).

- [ ] **Step 2: HomeHeader.tsx — the coin pill becomes the Vault button**

Wrap the existing coin-pill `<div>` (HomeHeader.tsx:35-51) in a `<button type="button" aria-label={t.vault.openVault} onClick={onOpenVault}>` with transparent/borderless button styling (same reset as the avatar button at lines 52-63) — visually unchanged, now tappable. Add `onOpenVault: () => void` to the props.

- [ ] **Step 3: ProfileMenu.tsx — Vault row**

Add `onOpenVault: () => void` to props. Between the global-rank row and the reminders block, add a menu row (same row styling as `t.home.globalRank` at lines 90-96):

```tsx
          <div style={{ height: 1, background: "var(--line)" }} />
          <button
            type="button"
            onClick={onOpenVault}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
          >
            <span style={{ fontWeight: 800, fontSize: 13, color: "var(--text)" }}>{t.vault.menuLabel}</span>
            <span style={{ fontWeight: 800, fontSize: 13, color: "var(--amber)" }}>🪙 →</span>
          </button>
```

- [ ] **Step 4: Home.tsx — thread it through**

Add an `onVault: () => void` prop to `Home`; pass it to `HomeHeader` (`onOpenVault={onVault}`) and to `ProfileMenu` (`onOpenVault={() => { setMenuOpen(false); onVault(); }}` — read Home.tsx for the actual menu-state setter name). Note `CampaignWorlds.tsx` also renders a `ProfileMenu` — give it the same prop (it has access to no vault handler; thread `onVault` through `Campaign` → `CampaignWorlds` the same way `onPlay` already flows, or — simpler and acceptable — make `onOpenVault` optional in `ProfileMenu` with the row hidden when absent; choose whichever keeps the diff smallest, but the typecheck must pass).

- [ ] **Step 5: Full verification**

- Frontend: `npm run typecheck; npm run lint; npx vitest run; npm run build` — all green; build emits no phaser chunk (unchanged).
- Backend: `uv run pytest; uv run ruff check .; uv run mypy app` — all green.
- Manual smoke (optional but recommended; backend on **:8001** per CLAUDE.md ops rules): sign in → tap coin pill → Vault opens → equip Daylight → app reskins instantly → reload → still Daylight (server-persisted).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/App.tsx frontend/src/screens/home/HomeHeader.tsx frontend/src/screens/home/ProfileMenu.tsx frontend/src/screens/Home.tsx frontend/src/screens/campaign
git commit -m "feat(vault): wire Vault entry from coin pill and profile menu"
```

---

## Acceptance criteria (whole plan)

1. Settling any window creates zero `coin_ledger` rows; `Standing.coins_awarded == 0`; rating/division/streak/standings/bots/exactly-once unchanged (Task 2 tests prove each).
2. Campaign rewards untouched: `tests/test_campaign.py` and `tests/test_ledger.py` pass without modification (except the additive `ref_key` test).
3. One additive migration only (`coin_ledger.ref_key`); `user_themes`, `profiles.equipped_theme`, and registration are untouched.
4. `/vault` endpoints: server-priced, no request body, all error paths (404/409/400-insufficient/403-requirement/403-not-owned) tested.
5. A purchase = exactly one ledger row + one ownership row in one transaction; never touches rating/division/streak/standings (tested invariant).
6. Vault screen: five themes with live-palette swatches, one correct CTA state per card, prices from the API, confirm-before-buy, equip reskins instantly and persists.
7. No client-side coin math; all state from server responses.
8. The theme formerly displayed as "Vault" displays "Daylight"; its id is unchanged.
9. All copy passes the banned-word guards in en/es/tr; "payout" appears nowhere.
10. No new dependencies; no BottomNav change; no commits pushed/merged without the user asking.
