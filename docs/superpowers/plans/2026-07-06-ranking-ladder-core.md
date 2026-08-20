# Ranking Ladder & Rating Math Core — Implementation Plan (Plan 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, DB-free foundation of the ranking system — the shared six-tier ladder derivation, demotion-shield rung transitions, placement-calibration K, duel pairwise Elo, and the Royale opponent-aware rating delta — each fully unit-tested.

**Architecture:** All logic here is **pure functions** of their arguments (no DB, no async), following the existing `services/duel_logic.py` pattern. New tuning constants land in `app/core/constants.py`; the shared-ladder derivation + transitions live in `app/services/rating.py`; the duel Elo joins `app/services/duel_logic.py`; the Royale opponent-aware delta joins `app/services/settlement.py` as a new pure helper. **This plan is purely additive** — it does NOT modify the existing `division_for_rating` or `rating_delta`, does NOT touch the DB, and does NOT change any wired behavior. Plan 2 swaps the call sites and adds the migration.

**Tech Stack:** Python 3.12, pytest (`uv run pytest` from `backend/`), no new dependencies. Tests are plain unit tests (no DB harness needed — these functions never touch a session).

**Reference spec:** `docs/superpowers/specs/2026-07-06-ranking-system-design.md` (§1 ladder, §2 math, §4 shield, §2c placement).

---

## File Structure

- `backend/app/core/constants.py` — **modify**: add the ladder rung table + new rating constants (§7 of spec). Additive only; existing constants untouched.
- `backend/app/services/rating.py` — **modify**: add shared-ladder derivation (`rung_for_rating`, `tier_for_rating`, `fill_fraction`), the `rung_transition` demotion-shield function, and `effective_k`. Keep the existing `division_for_rating` / `DIVISION_THRESHOLDS` in place (Plan 2 retires them).
- `backend/app/services/duel_logic.py` — **modify**: add `duel_elo_delta` + `apply_duel_rating` pure functions.
- `backend/app/services/settlement.py` — **modify**: add `royale_rating_delta` pure helper (opponent-aware). Keep the existing `rating_delta` (Plan 2 removes it).
- `backend/tests/test_ladder.py` — **create**: rung table + derivation + transition + placement-K tests.
- `backend/tests/test_duel_elo.py` — **create**: duel pairwise Elo tests.
- `backend/tests/test_royale_rating.py` — **create**: Royale opponent-aware delta tests.

---

### Task 1: Ladder rung table + rating constants

**Files:**
- Modify: `backend/app/core/constants.py` (append a new section near the existing Seasons block, end of file)
- Test: `backend/tests/test_ladder.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ladder.py`:

```python
"""Pure ladder-math tests (no DB). See docs/superpowers/specs/2026-07-06-ranking-system-design.md."""
from __future__ import annotations

from app.core.constants import (
    LADDER_RUNGS,
    RATING_FLOOR,
    ROYALE_RATING_K,
    DUEL_RATING_K,
    PLACEMENT_GAMES,
    PLACEMENT_K_MULT,
    DEMOTION_SHIELD,
    PROMO_IMMUNITY_GAMES,
)


def test_rung_table_is_ordered_and_starts_at_floor():
    floors = [floor for _tier, _sub, floor in LADDER_RUNGS]
    assert floors[0] == RATING_FLOOR
    assert floors == sorted(floors)
    assert len(set(floors)) == len(floors)  # strictly increasing, no dupes


def test_rung_table_shape():
    # Bronze..Diamond each have 3 sub-divisions; Apex is a single open-ended rung.
    tiers = [tier for tier, _sub, _floor in LADDER_RUNGS]
    assert tiers.count("Bronze") == 3
    assert tiers.count("Diamond") == 3
    assert tiers.count("Apex") == 1
    assert LADDER_RUNGS[-1] == ("Apex", None, 2350)


def test_new_rating_constants_have_expected_values():
    assert RATING_FLOOR == 850
    assert ROYALE_RATING_K == 64
    assert DUEL_RATING_K == 32
    assert PLACEMENT_GAMES == 5
    assert PLACEMENT_K_MULT == 2.0
    assert DEMOTION_SHIELD == 25
    assert PROMO_IMMUNITY_GAMES == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_ladder.py -v` (from `backend/`)
Expected: FAIL — `ImportError: cannot import name 'LADDER_RUNGS'`.

- [ ] **Step 3: Add the constants**

Append to `backend/app/core/constants.py` (after the Seasons block at the end of the file):

```python
# ── Ranking ladder (shared by royale_rating and duel_rating) ───────────────────────────────────
# One six-tier ladder. Bronze..Diamond split into 3 sub-divisions (III low → I high); Apex is a
# single open-ended leaderboard pool. Each sub-division is 100 rating wide, each tier 300 wide.
# A new player starts at STARTING_RATING (1000) = Bronze II. Rating never drops below RATING_FLOOR.
# Ordered LOW→HIGH; each rung is (tier, subdivision|None, floor_rating_inclusive).
LADDER_RUNGS: tuple[tuple[str, str | None, int], ...] = (
    ("Bronze", "III", 850),
    ("Bronze", "II", 950),
    ("Bronze", "I", 1050),
    ("Silver", "III", 1150),
    ("Silver", "II", 1250),
    ("Silver", "I", 1350),
    ("Gold", "III", 1450),
    ("Gold", "II", 1550),
    ("Gold", "I", 1650),
    ("Platinum", "III", 1750),
    ("Platinum", "II", 1850),
    ("Platinum", "I", 1950),
    ("Diamond", "III", 2050),
    ("Diamond", "II", 2150),
    ("Diamond", "I", 2250),
    ("Apex", None, 2350),
)
RATING_FLOOR: int = 850  # soft floor — no rating (royale or duel) ever drops below this
ROYALE_RATING_K: int = 64  # per-event budget for the opponent-aware Royale delta
DUEL_RATING_K: int = 32  # K for the 1v1 duel pairwise Elo exchange

# Placement calibration: the first PLACEMENT_GAMES rated events per ladder per season use a boosted
# K so a new/reset player converges on their true tier fast, then K reverts to the base value.
PLACEMENT_GAMES: int = 5
PLACEMENT_K_MULT: float = 2.0

# Demotion shield (anti-yo-yo): a player only drops a rung once their rating falls DEMOTION_SHIELD
# below the rung's floor. A fresh promotion into a NEW TIER grants PROMO_IMMUNITY_GAMES of demotion
# immunity.
DEMOTION_SHIELD: int = 25
PROMO_IMMUNITY_GAMES: int = 2

# Spread (std-dev) of the ratings assigned to cold-start bots around the field's mean (used in
# Plan 2 when bots become rating-bearing opposition). Kept here as the single tuning seam.
BOT_RATING_SIGMA: int = 120
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_ladder.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/constants.py backend/tests/test_ladder.py
git commit -m "feat(ranking): shared ladder rung table + rating constants"
```

---

### Task 2: Shared-ladder derivation (rating → tier / sub-division / fill)

**Files:**
- Modify: `backend/app/services/rating.py`
- Test: `backend/tests/test_ladder.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_ladder.py`:

```python
from app.services.rating import (
    rung_index_for_rating,
    tier_for_rating,
    fill_fraction,
)


def test_rung_index_clamps_to_floor():
    # Below the floor still resolves to the lowest rung (Bronze III), never negative.
    assert rung_index_for_rating(0) == 0
    assert rung_index_for_rating(849) == 0
    assert rung_index_for_rating(850) == 0


def test_starting_rating_is_bronze_ii():
    assert tier_for_rating(1000) == ("Bronze", "II")


def test_band_boundaries_map_to_expected_tiers():
    assert tier_for_rating(1150) == ("Silver", "III")
    assert tier_for_rating(1650) == ("Gold", "I")
    assert tier_for_rating(2049) == ("Platinum", "I")
    assert tier_for_rating(2050) == ("Diamond", "III")
    assert tier_for_rating(9999) == ("Apex", None)


def test_fill_fraction_within_a_sub_division():
    # Bronze II spans 950..1049 (width 100); rating 1000 is halfway.
    assert fill_fraction(1000) == 0.5
    assert fill_fraction(950) == 0.0
    assert fill_fraction(1049) == 0.99


def test_fill_fraction_apex_is_capped():
    # Apex has no ceiling; the meter fills over a nominal 300-wide window and clamps to 1.0.
    assert fill_fraction(2350) == 0.0
    assert fill_fraction(2650) == 1.0
    assert fill_fraction(9999) == 1.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_ladder.py -v`
Expected: FAIL — `ImportError: cannot import name 'rung_index_for_rating'`.

- [ ] **Step 3: Add the derivation functions**

Append to `backend/app/services/rating.py` (keep the existing `DIVISION_THRESHOLDS` / `division_for_rating` untouched above):

```python
from app.core.constants import LADDER_RUNGS, RATING_FLOOR

# Nominal width used only to render the Apex meter (Apex itself is open-ended / uncapped).
_APEX_METER_WIDTH = 300


def rung_index_for_rating(rating: int) -> int:
    """Index into LADDER_RUNGS (0 = Bronze III) for a rating, clamped at the floor."""
    r = max(rating, RATING_FLOOR)
    idx = 0
    for i, (_tier, _sub, floor) in enumerate(LADDER_RUNGS):
        if r >= floor:
            idx = i
        else:
            break
    return idx


def tier_for_rating(rating: int) -> tuple[str, str | None]:
    """(tier, sub-division) for a rating. Sub-division is None for Apex."""
    tier, sub, _floor = LADDER_RUNGS[rung_index_for_rating(rating)]
    return (tier, sub)


def fill_fraction(rating: int) -> float:
    """Progress (0.0–1.0, 2-dp) through the current rung toward the next — the ladder fill-meter.

    Apex is open-ended, so its meter fills over a nominal _APEX_METER_WIDTH and clamps to 1.0.
    """
    idx = rung_index_for_rating(rating)
    floor = LADDER_RUNGS[idx][2]
    if idx + 1 < len(LADDER_RUNGS):
        width = LADDER_RUNGS[idx + 1][2] - floor
    else:
        width = _APEX_METER_WIDTH
    frac = (max(rating, RATING_FLOOR) - floor) / width
    return round(min(1.0, max(0.0, frac)), 2)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_ladder.py -v`
Expected: PASS (all tests, including the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/rating.py backend/tests/test_ladder.py
git commit -m "feat(ranking): rating -> tier/sub-division/fill derivation"
```

---

### Task 3: Demotion-shield rung transition

**Files:**
- Modify: `backend/app/services/rating.py`
- Test: `backend/tests/test_ladder.py`

A player carries a **persisted current rung index** (their defended rung). After each rated event the new rating is compared against it: promotions apply immediately (and grant tier-change immunity); demotions require the rating to fall `DEMOTION_SHIELD` below the current rung's floor and are blocked while immune.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_ladder.py`:

```python
from app.services.rating import rung_transition, RungTransition


def _floor(idx: int) -> int:
    from app.core.constants import LADDER_RUNGS
    return LADDER_RUNGS[idx][2]


def test_promotion_advances_rung_and_grants_tier_immunity():
    # From Bronze II (idx 1) up to Silver III (idx 3) crosses a TIER boundary → immunity granted.
    t = rung_transition(new_rating=1160, current_rung=1, immunity_left=0)
    assert isinstance(t, RungTransition)
    assert t.new_rung == 3
    assert t.direction == "promote"
    assert t.immunity_left == 2  # PROMO_IMMUNITY_GAMES


def test_promotion_within_same_tier_grants_no_immunity():
    # Bronze III (0) → Bronze II (1): same tier, no immunity.
    t = rung_transition(new_rating=1000, current_rung=0, immunity_left=0)
    assert t.new_rung == 1
    assert t.direction == "promote"
    assert t.immunity_left == 0


def test_dip_below_floor_within_shield_does_not_demote():
    # Current Silver III (idx 3, floor 1150). Rating 1130 is only 20 below → within the 25 shield.
    t = rung_transition(new_rating=1130, current_rung=3, immunity_left=0)
    assert t.new_rung == 3
    assert t.direction == "none"


def test_drop_past_shield_demotes():
    # 1120 is 30 below the 1150 floor → past the 25 shield → demote to the natural rung.
    t = rung_transition(new_rating=1120, current_rung=3, immunity_left=0)
    assert t.new_rung == 2  # Bronze I (1050..1149)
    assert t.direction == "demote"


def test_immunity_blocks_demotion_and_decrements():
    t = rung_transition(new_rating=1000, current_rung=3, immunity_left=2)
    assert t.new_rung == 3  # held despite being well below floor
    assert t.direction == "none"
    assert t.immunity_left == 1


def test_no_change_leaves_rung_and_decrements_immunity():
    # Still comfortably inside Bronze II; a lingering immunity ticks down.
    t = rung_transition(new_rating=1000, current_rung=1, immunity_left=1)
    assert t.new_rung == 1
    assert t.direction == "none"
    assert t.immunity_left == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_ladder.py -v`
Expected: FAIL — `ImportError: cannot import name 'rung_transition'`.

- [ ] **Step 3: Add the transition function**

Append to `backend/app/services/rating.py`:

```python
from dataclasses import dataclass

from app.core.constants import DEMOTION_SHIELD, PROMO_IMMUNITY_GAMES


@dataclass(frozen=True)
class RungTransition:
    new_rung: int  # the player's rung index after this event
    direction: str  # "promote" | "demote" | "none"
    immunity_left: int  # remaining demotion-immunity games after this event


def rung_transition(new_rating: int, current_rung: int, immunity_left: int) -> RungTransition:
    """Resolve a rating change into a rung move, applying the demotion shield + promo immunity.

    - Promotion: rating reaches a higher rung → move up immediately. Crossing into a new *tier*
      (not just a sub-division) grants PROMO_IMMUNITY_GAMES of demotion immunity.
    - Demotion: only once the rating falls DEMOTION_SHIELD below the current rung's floor, and never
      while immune. A blocked/absent demotion decrements any remaining immunity by one.
    """
    natural = rung_index_for_rating(new_rating)

    if natural > current_rung:
        old_tier = LADDER_RUNGS[current_rung][0]
        new_tier = LADDER_RUNGS[natural][0]
        immunity = PROMO_IMMUNITY_GAMES if new_tier != old_tier else 0
        return RungTransition(new_rung=natural, direction="promote", immunity_left=immunity)

    if natural < current_rung:
        current_floor = LADDER_RUNGS[current_rung][2]
        if immunity_left > 0:
            return RungTransition(current_rung, "none", immunity_left - 1)
        if new_rating <= current_floor - DEMOTION_SHIELD:
            return RungTransition(natural, "demote", 0)
        return RungTransition(current_rung, "none", 0)  # within the shield → held

    return RungTransition(current_rung, "none", max(0, immunity_left - 1))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_ladder.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/rating.py backend/tests/test_ladder.py
git commit -m "feat(ranking): demotion-shield rung transitions"
```

---

### Task 4: Placement-calibration K helper

**Files:**
- Modify: `backend/app/services/rating.py`
- Test: `backend/tests/test_ladder.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_ladder.py`:

```python
from app.services.rating import effective_k


def test_placement_boosts_k_then_reverts():
    # During placement (placements_left > 0) K is multiplied; afterward it is the base value.
    assert effective_k(64, placements_left=3) == 128.0  # 64 * 2.0
    assert effective_k(32, placements_left=1) == 64.0
    assert effective_k(64, placements_left=0) == 64.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_ladder.py -v`
Expected: FAIL — `ImportError: cannot import name 'effective_k'`.

- [ ] **Step 3: Add the helper**

Append to `backend/app/services/rating.py`:

```python
from app.core.constants import PLACEMENT_K_MULT


def effective_k(base_k: float, placements_left: int) -> float:
    """K for one rated event: boosted while the player still has placement games left, else base."""
    return base_k * PLACEMENT_K_MULT if placements_left > 0 else float(base_k)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_ladder.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/rating.py backend/tests/test_ladder.py
git commit -m "feat(ranking): placement-calibration K helper"
```

---

### Task 5: Duel pairwise Elo

**Files:**
- Modify: `backend/app/services/duel_logic.py`
- Test: `backend/tests/test_duel_elo.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_duel_elo.py`:

```python
"""Pure duel Elo tests (no DB)."""
from __future__ import annotations

from app.services.duel_logic import duel_elo_delta, apply_duel_rating


def test_equal_ratings_win_gains_half_k():
    # Equal ratings → expected 0.5; a win exchanges DUEL_RATING_K * (1 - 0.5) = 16 (K=32).
    assert duel_elo_delta(1000, 1000, actual=1.0) == 16
    assert duel_elo_delta(1000, 1000, actual=0.0) == -16


def test_draw_between_equals_is_zero():
    assert duel_elo_delta(1000, 1000, actual=0.5) == 0


def test_beating_a_stronger_opponent_gains_more_than_an_equal():
    strong = duel_elo_delta(1000, 1400, actual=1.0)
    equal = duel_elo_delta(1000, 1000, actual=1.0)
    assert strong > equal


def test_exchange_is_zero_sum_for_a_decisive_result():
    winner = duel_elo_delta(1000, 1200, actual=1.0)
    loser = duel_elo_delta(1200, 1000, actual=0.0)
    assert winner + loser == 0


def test_custom_k_overrides_default():
    assert duel_elo_delta(1000, 1000, actual=1.0, k=64) == 32


def test_apply_respects_the_rating_floor():
    # A loss near the floor cannot push the rating below RATING_FLOOR (850).
    assert apply_duel_rating(855, 1400, actual=0.0) == 850
    assert apply_duel_rating(1000, 1000, actual=1.0) == 1016
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_duel_elo.py -v`
Expected: FAIL — `ImportError: cannot import name 'duel_elo_delta'`.

- [ ] **Step 3: Add the Elo functions**

Append to `backend/app/services/duel_logic.py` (add `DUEL_RATING_K` and `RATING_FLOOR` to the existing `from app.core.constants import (...)` block):

```python
def duel_elo_delta(my_rating: int, opp_rating: int, actual: float, k: float = DUEL_RATING_K) -> int:
    """Classic 1v1 Elo delta. `actual` is 1.0 win / 0.0 loss / 0.5 draw. Positive = rating gained."""
    expected = 1.0 / (1.0 + 10.0 ** ((opp_rating - my_rating) / 400.0))
    return round(k * (actual - expected))


def apply_duel_rating(
    my_rating: int, opp_rating: int, actual: float, k: float = DUEL_RATING_K
) -> int:
    """Apply a duel result to a rating, clamped at the shared RATING_FLOOR."""
    return max(RATING_FLOOR, my_rating + duel_elo_delta(my_rating, opp_rating, actual, k))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_duel_elo.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/duel_logic.py backend/tests/test_duel_elo.py
git commit -m "feat(ranking): duel pairwise Elo (duel_rating math)"
```

---

### Task 6: Royale opponent-aware rating delta

**Files:**
- Modify: `backend/app/services/settlement.py`
- Test: `backend/tests/test_royale_rating.py`

The Royale is a placement contest, so we reduce it to a round-robin: you "beat" everyone you outplaced and "lost to" everyone above you, run Elo against each opponent's rating, and share a fixed `K/(opponent-count)` budget across the pairings — keeping the total swing bounded ~±K while making the delta reflect *who* you beat.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_royale_rating.py`:

```python
"""Pure Royale opponent-aware rating delta tests (no DB)."""
from __future__ import annotations

from app.services.settlement import royale_rating_delta


def test_no_opponents_is_zero():
    assert royale_rating_delta(1000, my_place=1, opponents=[]) == 0


def test_first_place_gains_last_place_loses_in_an_even_field():
    # 4-player field, all rated 1000. Winner gains, last loses, and the field nets to ~zero.
    opponents_for = lambda place: [(p, 1000) for p in (1, 2, 3, 4) if p != place]
    first = royale_rating_delta(1000, 1, opponents_for(1))
    last = royale_rating_delta(1000, 4, opponents_for(4))
    assert first > 0
    assert last < 0
    assert first == -last  # symmetric around the mean


def test_swing_is_bounded_by_k():
    # Beating an entire field can't exceed the K budget (default 64).
    opponents = [(p, 1000) for p in range(2, 9)]  # 7 opponents, you placed 1st
    assert royale_rating_delta(1000, 1, opponents) <= 64


def test_beating_a_strong_field_gains_more_than_beating_a_weak_one():
    strong = royale_rating_delta(1000, 1, [(2, 1600), (3, 1600), (4, 1600)])
    weak = royale_rating_delta(1000, 1, [(2, 600), (3, 600), (4, 600)])
    assert strong > weak


def test_losing_to_weaker_players_costs_more():
    # Placing last behind a field rated well below you is the harshest outcome.
    to_weak = royale_rating_delta(1600, 4, [(1, 900), (2, 900), (3, 900)])
    to_strong = royale_rating_delta(1600, 4, [(1, 1700), (2, 1700), (3, 1700)])
    assert to_weak < to_strong < 0


def test_custom_k_scales_the_budget():
    opponents = [(2, 1000), (3, 1000)]
    assert abs(royale_rating_delta(1000, 1, opponents, k=32)) < abs(
        royale_rating_delta(1000, 1, opponents, k=64)
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_royale_rating.py -v`
Expected: FAIL — `ImportError: cannot import name 'royale_rating_delta'`.

- [ ] **Step 3: Add the delta function**

Add to `backend/app/services/settlement.py`. First extend the constants import to include `ROYALE_RATING_K` (add it to the existing `from app.core.constants import (...)` block). Then add the pure helper next to the existing `rating_delta` (leave `rating_delta` in place — Plan 2 removes it):

```python
def royale_rating_delta(
    my_rating: int,
    my_place: int,
    opponents: list[tuple[int, int]],
    k: float = ROYALE_RATING_K,
) -> int:
    """Opponent-aware placement Elo for one settled entry.

    `opponents` is (place, rating) for every OTHER competitor in the settled field (real + bots).
    You "beat" (actual=1) everyone you outplaced, "lost to" (actual=0) everyone above you; a shared
    K/opponent-count budget keeps the total swing bounded ~±K while rewarding beating stronger
    fields. Places are unique in a settled field; an equal place (defensive) scores 0.5.
    """
    if not opponents:
        return 0
    budget = k / len(opponents)
    total = 0.0
    for opp_place, opp_rating in opponents:
        if my_place < opp_place:
            actual = 1.0
        elif my_place > opp_place:
            actual = 0.0
        else:
            actual = 0.5
        expected = 1.0 / (1.0 + 10.0 ** ((opp_rating - my_rating) / 400.0))
        total += budget * (actual - expected)
    return round(total)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_royale_rating.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite to confirm nothing regressed**

Run: `uv run pytest tests/test_ladder.py tests/test_duel_elo.py tests/test_royale_rating.py -v`
Expected: PASS (all). Then a quick lint/type pass:
Run: `uv run ruff check app/services/rating.py app/services/duel_logic.py app/services/settlement.py app/core/constants.py`
Expected: no errors. (These are additive pure functions; existing tests are unaffected.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/settlement.py backend/tests/test_royale_rating.py
git commit -m "feat(ranking): opponent-aware Royale rating delta"
```

---

## Self-Review

**Spec coverage (this plan's slice):**
- §1 shared ladder (tiers, sub-divisions, bands, floor, Bronze II start) → Tasks 1–2. ✓
- §2a duel pairwise Elo (fed by all competitive duels — the *wiring* is Plan 2) → Task 5. ✓
- §2b Royale opponent-aware delta → Task 6. ✓
- §2c placement calibration K → Task 4. ✓
- §4 demotion shield + promo immunity → Task 3. ✓
- Deferred to later plans (intentionally out of this plan's scope): rating-bearing bots (§3, Plan 2), migration + call-site swaps + seasons/peak (Plan 2), leaderboards (§5a, Plan 3), frontend rank screen + promotion moments (§4 UI, Plan 4).

**Placeholder scan:** none — every step has real code and exact commands.

**Type consistency:** `rung_index_for_rating`/`tier_for_rating`/`fill_fraction`/`rung_transition`/`RungTransition`/`effective_k` (rating.py); `duel_elo_delta`/`apply_duel_rating` (duel_logic.py); `royale_rating_delta` (settlement.py) — names are used identically in their tests and across tasks. `RungTransition` fields (`new_rung`, `direction`, `immunity_left`) match between Task 3's definition and its tests. Constants (`LADDER_RUNGS`, `RATING_FLOOR`, `ROYALE_RATING_K`, `DUEL_RATING_K`, `PLACEMENT_GAMES`, `PLACEMENT_K_MULT`, `DEMOTION_SHIELD`, `PROMO_IMMUNITY_GAMES`, `BOT_RATING_SIGMA`) defined in Task 1, consumed consistently thereafter.

**Non-breaking check:** `division_for_rating`/`DIVISION_THRESHOLDS` (rating.py) and `rating_delta`/`RATING_K` (settlement.py) are left in place and untouched, so existing settlement/season tests keep passing. Plan 2 owns the swap.
