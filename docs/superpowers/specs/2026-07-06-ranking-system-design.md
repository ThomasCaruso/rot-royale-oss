# Ranking System — Daily Royale & Duel (design)

**Date:** 2026-07-06
**Status:** approved (brainstorm), pending implementation plan
**Scope:** Turn the two existing-but-hollow rank numbers into two *meaningful* skill ranks under one
shared tier ladder — visible, losable, and calibrated so they track skill even while the player pool
is padded with bots.

---

## 0. Problem

Both ranking systems already exist in the backend, but neither *means* anything to a player:

- **Daily Royale rating** is a hidden Elo (`profiles.rating`, schema comment: "kept under the hood"),
  updated by a **blind placement delta** (`round((score − 0.5) · 64)`) against a field **padded with
  in-memory bots** whose rolls partly determine your ±32. Invisible + noisy = no stakes.
- **Duel tier** is derived from `duel_xp`, which is **monotonic** — a win is +2 XP, a *loss* is still
  +1 XP. "Crown" (700 XP) just means "played a lot." A rank you cannot fall out of is a playtime
  meter, not a rank.

Decision (brainstorm): keep **two ratings** (Royale and Duel measure genuinely different skills —
async 8-question vs real-time 1v1) but unify them under **one shared tier ladder** and one
progression feel, and fix the math so both ranks are real skill signals. This is **Approach A** with
**progression Option 3** (rating is the single source of truth, rendered as a ladder) and **duel
scope Option 2** (all competitive duels feed the duel rating; Gems remain a separate optional stake).

### Non-negotiable guardrail (CLAUDE.md §7 / DESIGN §7 honesty)

Bots may be **rating opposition and calibration**, but the system **never displays a fabricated
count** (no "N players online", no fake friends-beaten). `WindowOut.entry_count` and every shown
player/field count stay derived from **real** entries only. Bots remain in-memory, never persisted as
entries. This is the line that keeps the design "what every app does" honest rather than casino-style.

---

## 1. One shared tier ladder, two ratings

Six named tiers, shared by both modes so the app reads as one competitive system:

**Bronze → Silver → Gold → Platinum → Diamond → Apex**

- Bronze…Diamond each split into **3 sub-divisions**, `III → II → I` ascending (15 climbable rungs).
- **Apex** is a single top pool with **no sub-divisions** — the *leaderboard tier*, ranked 1…N by
  raw rating. It is "the top."
- Rating→tier bands (each tier 300 wide, each sub-division 100 wide). **Tunable constants**, not magic
  numbers scattered in code:

| Tier      | Sub-divisions        | Rating band |
|-----------|----------------------|-------------|
| Bronze    | III / II / I         | 850–1149    |
| Silver    | III / II / I         | 1150–1449   |
| Gold      | III / II / I         | 1450–1749   |
| Platinum  | III / II / I         | 1750–2049   |
| Diamond   | III / II / I         | 2050–2349   |
| Apex      | — (leaderboard pool) | 2350+       |

- New players start at **1000 = Bronze II** (reuses existing `STARTING_RATING`), leaving real room to
  climb. **Soft floor at 850** (Bronze III bottom): rating never drops below it, so a bad run can't
  spiral to nothing.
- Both ratings live on this **same** band table. A player may be *Gold I in the Arena, Platinum III in
  the Royale* — coherent identity, each rank earned on its own merits.

### Data

- `profiles.rating` → **`royale_rating`** in this design (same column; may keep the name `rating` to
  avoid a migration — implementation plan decides). Existing values (~1000) re-derive to Bronze II
  under the new bands; no data loss (rating is just a number; only the *band function* changes).
- New **`duel_rating`** column on `DuelUserStats` (int, default `STARTING_RATING`).
- Tier/sub-division are **derived** from a rating by a pure function — not stored as truth. A cached
  `division` string may be persisted for cheap reads (as today), always recomputed from rating.

---

## 2. The math — ranks that track skill

### 2a. Duel rating — classic pairwise Elo

1v1 is textbook Elo. Per resolved duel, for each player vs their opponent:

```
expected = 1 / (1 + 10 ** ((opp_rating − my_rating) / 400))
delta    = round(DUEL_RATING_K * (actual − expected))     # actual = 1 win, 0 loss, 0.5 draw
new      = clamp(my_rating + delta, RATING_FLOOR, +inf)
```

- `DUEL_RATING_K ≈ 32` (calibration boost, §2c). Win vs an equal → +16; beating someone above you →
  more; a loss drops you. **This is what makes duel a real rank instead of a playtime meter.**
- **Fed by all competitive duels** — bot Gem duels, bot training duels, and live friend duels (Q5
  Option 2). Draws (both-tiebreak edge) score 0.5/0.5.
- The Gem economy is unchanged and rides *on top* as an optional stake. **§5b amendment:** friend
  duels now feed `duel_rating` (a skill axis), but still **never** touch the Gem `wins`/`losses`
  counters or award/deduct Gems. "No Gems from friend duels" holds; we add a skill axis alongside it.

### 2b. Royale rating — opponent-aware placement Elo

Replace the blind `(score − 0.5) · K` with **pairwise-average Elo against the actual settled field**
(the standard multiplayer-Elo reduction of a placement to a round-robin):

```
For player P placed at `place` in a field of size N (real + rating-bearing bots):
  budget = ROYALE_RATING_K / (N − 1)              # per-opponent share; total swing stays ~±K
  delta  = 0
  for each other competitor O in the field:
      actual   = 1 if P outplaced O else 0        # (ties -> 0.5; broken by avg time_frac already)
      expected = 1 / (1 + 10 ** ((O.rating − P.rating) / 400))
      delta   += budget * (actual − expected)
  new = clamp(P.rating + round(delta), RATING_FLOOR, +inf)
```

- `ROYALE_RATING_K` keeps the existing budget feel (**64**), but the swing is now **opponent-aware**:
  beating a field of strong opponents gains more than beating weak ones; getting outplaced by players
  *below* you costs more. Placement now reflects *who* you beat, not just where you landed.
- Only **SETTLED real entries** receive a delta and a `standings` row (unchanged). Bots contribute to
  the field ordering and to each real player's pairwise sum, but are never paid, never persisted,
  never rated-in-DB.
- **This is only meaningful because bots carry ratings — see §3.**

### 2c. Placement calibration (open-choice A = yes, light)

New/season-reset players are uncertain, so seed them fast:

- The **first `PLACEMENT_GAMES` (≈5) rated events per ladder per season** use a **boosted K**
  (`K × PLACEMENT_K_MULT`, ≈2×) so a player lands near their true tier quickly, then K reverts.
- Tracked per ladder via a small counter (e.g. `royale_placements_left`, `duel_placements_left` on
  the respective stats rows), reset at season rollover.
- During placement, tier/leaderboard may show a **"Calibrating"** state instead of a firm rung.

---

## 3. Bots as honest, calibrated opposition

The lever that makes the rank mean something *before* the real pool exists — and keeps it honest.

- Bots are still seeded deterministically from `(contest_date, slot)` (Royale) / per-duel seed (Duel),
  but each is now **assigned a rating** near the live opposition's level, and its **skill
  (P(correct)/speed) is derived from that rating** — a 1600-rated bot actually plays like 1600. So
  "beat the field" ≈ "beat opponents at your level" = a genuine skill signal, not RNG.
  - Royale: bot ratings drawn from a distribution centered on the **real entrants' mean rating**
    (fallback to the day's provisioned target when the field is empty), spread by a tunable sigma.
  - Duel: the opponent bot is drawn near the challenger's `duel_rating`, replacing or informing the
    current `choose_rival_tier` skill pick, so the Elo exchange is fair.
- **Honesty invariant (hard):** bots stay in-memory only, are **never** persisted as entries, and are
  **never** counted in `entry_count` or any displayed player/field/opponent count. They are rating
  opposition, not a crowd.
- A config knob (`BOT_FIELD_TARGET`, already exists; plus a `bot_fraction` dial) lets the bot share
  fall as real players arrive without code changes.

---

## 4. Progression feel — Option 3, rendered as a ladder

One rating is the truth; the presentation makes it a ladder with stakes:

- **Tier badge + fill-meter:** rating renders as the current rung's badge plus a bar filling toward
  the next rung (`(rating − rung_floor) / rung_width`).
- **Promotion / demotion moments:** crossing a rung boundary fires a real moment — surfaced in Royale
  results and `DuelResult`. Reuse the `frontend/src/ui/` motion primitives (Confetti, CountUp, etc.);
  the *visual* treatment is handed to the `game-ui-design` skill at build time, not designed here.
- **Demotion shield (anti-yo-yo):** you do **not** demote the instant rating dips below a rung line.
  You must fall `DEMOTION_SHIELD` (≈25 rating) **below** the boundary to actually drop a rung. A fresh
  promotion into a new *tier* (not sub-division) grants brief demotion immunity
  (`PROMO_IMMUNITY_GAMES`, ≈2 games). The shield is a pure function of `(rating, current_rung)`, so it
  needs one piece of state: the player's **current rung** (persisted, distinct from the raw-rating
  derivation) to know which side of the line they're defending.

---

## 5. Leaderboards & seasons

### 5a. Leaderboards (open-choice C = all three)

- **Global top-N** by rating, **per ladder** (Royale, Duel), real players only.
- **Your rank & percentile** — promotes today's ad-hoc `/me` global rank into a first-class,
  per-ladder figure (rank among real profiles, percentile = `1 − (rank−1)/total`).
- **Friends leaderboard** — ranks you among your accepted friends using the existing social graph
  (real people, fully honest). Note: a friends-leaderboard spec already exists
  (`2026-07-04-daily-friends-leaderboard-design.md`) — the implementation plan **reconciles** with it
  rather than duplicating; this ladder view links/extends that surface, per ladder.
- New read-only endpoint(s), e.g. `GET /leaderboard?ladder=royale|duel&scope=global|friends`,
  returning top-N + the caller's own rank/percentile. Never includes bots.

### 5b. Seasons

- Keep the existing **monthly soft-reset** (`SEASON_RESET_FACTOR = 0.5`, pull halfway to
  `STARTING_RATING`) but apply it to **both** `royale_rating` and `duel_rating`, and reset the
  placement counters.
- **End-of-season rewards pay on *peak* tier reached, not final tier** — a late slump can't erase the
  climb. Requires tracking `peak_royale_rating` / `peak_duel_rating` per season (reset at rollover;
  updated on every rating gain).
- Season reward tables already exist (`SEASON_RATING_REWARDS`, `SEASON_DUEL_REWARDS`); they key off
  peak tier under this design.

---

## 6. `duel_xp` (open-choice B = keep as cosmetic mastery)

`duel_xp` and `duel_tier` are **retained as a cosmetic lifetime "mastery" stat** (total dedication /
games played) — a monotonic meter is *fine* for a mastery badge. But it is **no longer the rank**:
`duel_rating` and its shared-ladder tier are THE duel rank everywhere rank is shown. UI must clearly
separate "Mastery" (lifetime XP) from "Rank" (duel_rating tier) so they don't read as competing
numbers. (`duel_tier`'s old `bronze/silver/gold/crown` may be relabeled to a mastery vocabulary in
the plan to avoid clashing with the shared ladder's tier names.)

---

## 7. Constants (new/changed — all in `app/core/constants.py`)

| Constant | Value | Purpose |
|---|---|---|
| `TIER_BANDS` | table in §1 | rating → (tier, sub-division) |
| `RATING_FLOOR` | 850 | soft floor, both ladders |
| `STARTING_RATING` | 1000 (existing) | seed = Bronze II |
| `ROYALE_RATING_K` | 64 (was `RATING_K`) | Royale per-event budget |
| `DUEL_RATING_K` | 32 | Duel pairwise Elo K |
| `PLACEMENT_GAMES` | 5 | calibration length per ladder/season |
| `PLACEMENT_K_MULT` | 2.0 | K multiplier during placement |
| `DEMOTION_SHIELD` | 25 | rating margin below a rung before demotion |
| `PROMO_IMMUNITY_GAMES` | 2 | demotion immunity after a tier promotion |
| `BOT_RATING_SIGMA` | ~120 | spread of bot ratings around field mean |

---

## 8. Code-change map

**Backend**
- `core/constants.py` — new constants (§7).
- `services/rating.py` — replace `division_for_rating` with the shared-ladder derivation
  (tier + sub-division + fill fraction), the demotion-shield rung transition, and placement-K helpers.
- `services/settlement.py` — swap `rating_delta` for the pairwise-average opponent-aware model (§2b);
  update `peak_royale_rating`; write rung transitions.
- `services/bots.py` — assign each bot a **rating** and derive skill/speed from it (§3).
- `services/duel_logic.py` / `services/duel.py` / `services/friend_duel.py` — pairwise Elo on duel
  resolution (§2a); update `duel_rating`, placement counter, peak, rung transition, for **both**
  players in a friend duel; keep `duel_xp` as cosmetic.
- `models/` — `DuelUserStats.duel_rating` (+ placement/peak counters); per-duel `rating_before/after`
  history columns; `Profile` peak/placement/current-rung fields. **Alembic migration** (never
  `create_all`).
- `api/` — new leaderboard endpoint(s) (§5a); extend `/me`, `/me/duel-stats`, `/me/season`,
  `standings` payloads with tier/sub-division/fill/percentile/peak + rung-transition markers.
- `schemas/` — carry the new fields.

**Frontend**
- New **Rank / Ladder screen**: both ladders side by side — tier badge, sub-division, fill-meter,
  demotion-shield state, "Calibrating" state, global/percentile/friends leaderboards.
- **Promotion/demotion moments** wired into Royale results and `DuelResult` (reuse `ui/` primitives;
  visual polish via `game-ui-design`).
- `api/client.ts` + Query hooks for the new endpoints; i18n strings for tiers/sub-divisions/
  promotion/demotion/percentile/mastery-vs-rank.

**Tests** (server-authoritative, per CLAUDE.md §4 harness)
- Band/sub-division derivation incl. floor and Apex.
- Pairwise Elo (duel) symmetry & zero-sum; draw handling.
- Royale pairwise-average delta bounded ~±K; strong-field vs weak-field asymmetry.
- Demotion shield: dip-without-demote, demote-past-margin, promo immunity.
- Placement K boost applies for first N then reverts; resets on season rollover.
- Bot rating→skill calibration is deterministic from seed; bots never persisted, never in
  `entry_count`.
- Peak tracking survives a late-season slump; season reset halves both ratings + resets counters.
- Leaderboards exclude bots; percentile math.

---

## 9. Explicitly out of scope (v1)

- No separate LP/points economy on top of rating (Option 3 rejected the second source of truth).
- No unified single rating across modes (Approach B rejected).
- No matchmaking service beyond bot opposition (real-player matching is the pool filling naturally).
- No cross-mode rank blending; the two ratings never affect each other.
- No new Gem flows — the Gem economy and its `wins/losses` counters are untouched.

---

## 10. Open items for the implementation plan

- Whether to rename `profiles.rating` → `royale_rating` (migration cost) or keep the name.
- Exact reconciliation with the existing `2026-07-04-daily-friends-leaderboard-design.md` surface.
- Mastery vocabulary for the retained `duel_xp`/`duel_tier` so it can't be confused with the rank.
- Storage shape for per-duel rating history (columns on the duel row vs a small history table).
