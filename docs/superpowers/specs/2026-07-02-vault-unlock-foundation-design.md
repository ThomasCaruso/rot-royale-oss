# Vault Overhaul — Sub-project #1: Unlock-Source Foundation

**Date:** 2026-07-02
**Status:** Approved design → ready for implementation plan
**Epic:** Vault/shop massive rework (decomposed into 3 sub-projects; this is #1)

---

## Epic context & decomposition

The vault rework is one epic, split into three ordered spec→plan→build cycles:

1. **Unlock-Source Foundation** *(this spec)* — the engine that lets cosmetics be gated on many
   progression sources, plus the "you just earned it" celebration plumbing. Proven end-to-end with a
   small starter item set.
2. **Catalog expansion + reward wiring** *(later)* — the full set of new themes/frames (and any new
   cosmetic kinds), mapping specific unlocks to specific sources/levels.
3. **Shop UI overhaul** *(later)* — reorganize the Vault screen: categories, source cues, "how to
   unlock" affordances, featured items, premium storefront feel.

Each sub-project is designed and built completely before the next begins.

### Product decisions locked in brainstorming
- **Sources in scope:** specific level clears, daily streak, rank/division, duel achievements — all
  four. Rarity/premium-ness scales with difficulty. Curated set, not an explosion of options.
- **Acquisition:** mix per item — some earned-free (accomplishment IS the price), some
  unlock-then-buy (requirement gates access, coins still sink).
- **Earn moment:** celebrate in the moment (Approach A — on the existing results screens + a net).

---

## 1. Scope of this sub-project

Build the **engine and the earn-moment**, proven end-to-end with a small starter set.

**In scope:** requirement grammar, ownership/fluctuation handling, the pending-unlock primitive,
wiring the three existing results screens + a Home-load safety net, and ~4 starter gated items
(including at least one theme).

**Explicitly NOT in scope (deferred):** the full catalog of new content, new cosmetic *kinds*
(titles/banners/avatars), and the Vault screen redesign.

---

## 2. Requirement grammar

Each catalog item keeps its single optional `requirement: str | None` (in `backend/app/core/cosmetics.py`).
Verbs, all evaluated server-side against a player-progress snapshot:

| Verb | Meaning | Source data | Monotonic? |
|------|---------|-------------|------------|
| `world:<key>` | that campaign world fully cleared | `user_campaign_progress` | yes (exists) |
| `all_worlds` | every manifest world cleared | `user_campaign_progress` | yes (exists) |
| `level:<world>:<n>` | that specific level cleared | `user_campaign_progress` row, `times_cleared ≥ 1` | yes |
| `streak:<n>` | **best** daily streak ≥ n | `profiles` (best streak) | yes (best, not current) |
| `division:<name>` | **peak** Royale division ≥ name | peak rating vs `DIVISION_THRESHOLDS` | yes (peak) |
| `duel_wins:<n>` | cumulative duel wins ≥ n | `DuelUserStats.wins` (+training per current rollup) | yes |
| `duel_tier:<name>` | duel tier ≥ name | `DuelUserStats.duel_tier` | yes |
| `duel_perfect:<n>` | perfect duel wins ≥ n | `DuelUserStats.perfect_wins` | yes |

- **One requirement per item.** No AND/OR combinators (YAGNI).
- **Unknown verb → NOT met** (existing safe default: a catalog typo can lock an item, never leak it).
- **Division ordering** comes from `services/rating.py::DIVISION_THRESHOLDS`
  (Bronze < Silver < Gold < Platinum < Diamond < Apex). `division:` compares by rank index.
- **"Best/peak" requirement:** `streak:` and `division:` gate on the player's high-water mark, not
  current value, so a later dip never un-earns an unlock. This needs a persisted peak:
  - `streak`: add a `best_streak` (if not already tracked on profile; DuelUserStats has one for
    duels but Royale streak is `profiles.streak_count`). Confirm/added in the plan.
  - `division`: add a persisted `peak_rating` (or `peak_division`) advanced at settlement.
  - *Fallback if adding peak columns is undesirable:* rely on the earn-moment grant (§4) to make
    ownership permanent even though the live requirement check uses current value. The grant is the
    real permanence guarantee; peak columns are the belt-and-suspenders. **Plan will choose;
    default: add the peak columns for correct `locked` display + grant for permanence.**

## 3. Ownership & the fluctuation trap

Two acquisition models, chosen per item:
- **Earned-free:** `cost == 0` + `requirement`. Meeting the requirement grants it.
- **Unlock-then-buy:** `cost N` + `requirement`. Requirement makes it purchasable; coins still pay.

**The trap:** some sources can drop (current division/streak). The current code treats
`cost==0 && requirement_met` as *implicitly* owned (computed live) — fine for monotonic gates
(`all_worlds`), but for a fluctuating gate an item could silently un-own.

**Rule:** at the **earn moment**, an earned-free item is written an **explicit ownership row**
(`user_themes` / `user_cosmetics`) — permanent, never revoked if the player later regresses.
Unlock-then-buy items become purchasable and stay purchasable. Existing monotonic implicit-ownership
items keep working unchanged (backward compatible). Gating on best/peak (§2) reinforces this so the
`locked` flag in the Vault also reads correctly.

## 4. The earn-moment primitive (Approach A)

One core function powers all detection:

```
pending_unlocks(user) = { catalog items whose requirement is now met }
                        − { unlock ids already acknowledged for this user }
```

- **Storage:** a new dedicated table `user_unlock_acks (user_id, item_id, acked_at)` — the once-only
  reveal ledger (chosen over a JSONB column: queryable, clean composite PK, same shape as the other
  ownership tables).
- **Results-screen path:** the campaign level-complete, duel-finish, and royale-settlement responses
  gain a `newly_unlocked: [{ id, kind, name, acquisition }]` field, computed from
  `pending_unlocks`. The existing staged-reveal screens — `LevelComplete.tsx`, `DuelResult.tsx`,
  `RoyaleResultsModal.tsx` — render it, generalizing the proven "FRAME UNLOCKED" reveal from
  world-frames to any gated item.
- **Safety net:** `GET /me/pending-unlocks` is checked on Home load, catching sources with no
  results screen (streak crossing at midnight) → a "while you were away, you unlocked…" reveal that
  reuses the same reveal component.
- **Acknowledge = the exactly-once guarantee:** revealing an unlock writes its `user_unlock_acks`
  row *and* (for earned-free items) writes the ownership grant, inside one transaction. Because both
  the results path and the net diff against acks, whichever surface catches it first wins and it
  never re-fires (replay of a level, re-open of the app, etc.).
- **Transaction boundary:** the ack + grant follow the existing vault pattern — the service never
  commits; the request/worker boundary commits once. Composite PKs are the concurrency backstop.

## 5. Starter items (proof, not the full catalog)

A handful spanning every source × both acquisition models, including at least one theme (the
headline "themes unlocked from certain things"). Working set (final ids/values in the plan):

| Item | Kind | Source verb | Acquisition |
|------|------|-------------|-------------|
| Cosmic Labs boss frame | frame | `level:Science:10` | earned-free |
| streak theme | theme | `streak:7` | unlock-then-buy (coins) |
| rank theme | theme | `division:Gold` | earned-free |
| duel-tier frame | frame | `duel_tier:gold` | earned-free |

New themes require a `theme/tokens.ts` entry and the `cosmeticIds.json` frontend↔backend parity
contract — included for just these. Full catalog is sub-project #2.

## 6. Testing & invariants

- **Requirement evaluator:** pure function, unit-tested per verb against snapshot progress state
  (met / not-met / boundary).
- **Exactly-once reveal:** ack prevents re-fire across replay + re-open + both surfaces catching the
  same unlock.
- **Fluctuation:** earn at Gold → drop to Silver → item stays owned (explicit grant); `locked`
  reads correctly off peak.
- **Preserved invariants (existing tests must stay green + new ones added):**
  - `coin_ledger` / `gem_ledger` append-only; balance == ledger sum.
  - Purchases and grants never touch rating / division / streak / standings.
  - Copy-honesty guard: no cash/prize/bet/gamble language in any new player-facing string.
  - i18n: all new strings in `en.ts` + `es.ts` + `tr.ts`.
  - `cosmeticIds.json` parity between frontend visuals and backend catalog.

## 7. Files expected to change

- `backend/app/core/cosmetics.py` — new requirement verbs + starter items.
- `backend/app/services/vault.py` — extended requirement evaluator, `pending_unlocks`, earn-grant.
- `backend/app/models/` — new `user_unlock_acks` table (+ Alembic migration); possible
  `peak_rating`/`best_streak` columns.
- Campaign-complete / duel-finish / settlement services + their response schemas — add
  `newly_unlocked`.
- `backend/app/api/` — `GET /me/pending-unlocks`; acknowledge-on-reveal endpoint or fold into
  existing reads.
- `frontend/src/theme/tokens.ts` + `cosmeticIds.json` — starter themes.
- `frontend/src/screens/campaign/LevelComplete.tsx`, `screens/duel/DuelResult.tsx`,
  `screens/results/RoyaleResultsModal.tsx` — render `newly_unlocked`.
- `frontend/src/screens/Home.tsx` — pending-unlocks net + reveal.
- `frontend/src/i18n/{en,es,tr}.ts` — new strings.
- Tests alongside each.

## 8. Open items for the implementation plan

- Confirm whether `profiles` already persists a best/peak streak and peak rating; add columns if not.
- Confirm the exact `DuelUserStats` win field(s) to use for `duel_wins` (ranked `wins` vs including
  `training_wins`).
- Final starter-item ids, costs, and the token palettes for the two new themes.
- Whether acknowledge is a dedicated endpoint or folded into the results-fetch / vault-open reads.
