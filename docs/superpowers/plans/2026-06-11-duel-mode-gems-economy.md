# Duel Mode + Gems Economy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Run `uv run pytest`, `uv run ruff check .`, `uv run mypy app` (backend) and `npm run typecheck`/`lint`/`build` + vitest (frontend) green after each phase.

**Goal:** Add a scarce, earned-only second currency ("Gems") with a ledger-grade audit trail, and build **Duel** — an async, bot-backed, best-of-7 trivia mode with Gem entry pools — as the #2 product pillar, without touching Daily Royale fairness or the coin invariant.

**Architecture:** A **parallel `gem_ledger`** (mirrors the coin ledger pattern) + `profiles.gems_balance` cache, with a DB-enforced **idempotency key** the coin ledger lacks. Gems are granted at Daily Royale settlement (placement tiers), at Campaign milestones (first-clear, ledger-keyed), and won/lost in Duel. Duel **reuses ~90% of the existing contest machinery** — `trivia_spec`, `build_round_set`, `TriviaModule.score`, `compute_points`, and the `Entry`/`RoundAnswer`/`RoundResult` persistence pattern (cloning the window-less practice/campaign start) — adding only a `DUEL_BO7` template, three duel tables, a per-round adjudicator, a window-less bot rival, and a gem-pool reward path.

**Tech Stack:** FastAPI + SQLAlchemy 2.x async + Alembic + Postgres (backend); Vite + React + TS + Zustand + Capacitor (frontend). No new dependencies.

---

## 1. Product recommendation

Build in the spec's phase order, but with three scope tightenings that keep v1 shippable and policy-safe:

1. **Per-round submit for Duel** (not full-run). The contest engine already supports sequential per-round scoring with server-held state (`answer_round`), and the frontend already drives Daily Royale that way (`api.answerRound` per lock). Per-round is what makes the "Round Won / Speed Win / No Point" reveal and the live `YOU — RIVAL` scoreline possible while staying anti-cheat-safe (the rival's answer for round *i* is only revealed after the user locks round *i*).
2. **Gem Vault v1 = Gem-priced frames only**, with the `currency` discriminator wired end-to-end so auras / nameplates / result-effects (which need brand-new equip slots + renderers) can be added later without schema churn. This satisfies acceptance #23 ("exists or explicitly deferred with backend support ready").
3. **Defer Weekly Skill Missions to V2.** No mission/cron-quest architecture exists; building it is a separate subsystem. Daily Royale + Campaign are sufficient Gem faucets for v1.

Daily Royale stays the scarce daily crown; Duel is the repeatable "run it back" loop; Campaign trains and feeds both currencies; Vault/Profile is identity. Gems never buy a Daily Royale advantage and are never purchasable/redeemable/transferable.

## 2. Current architecture findings (verified against the code)

**Economy / ledger**
- `app/models/ledger.py::CoinLedger` (`coin_ledger`): `id, user_id, delta(BigInteger), reason(String64), ref_type, ref_id(UUID), ref_key(String64), balance_after, created_at`. **No idempotency key; no currency discriminator** — single-currency by design. Duplicate-prevention is caller-side.
- Sole write chokepoint: `app/services/ledger.py::record_coin_delta(...)` — locks `Profile` `with_for_update`, computes `balance_after`, appends a row, updates `profiles.coins_balance`, `flush()` (never commits). Request boundary (`core/db.py::get_session`) commits once.
- `profiles.coins_balance` is a cache that must equal `SUM(coin_ledger.delta)`. `Profile` has `rating, division, streak_count, last_streak_date, equipped_theme, equipped_frame, equipped_badges(JSONB), equipped_title, avatar_preset`.
- Constants in `app/core/constants.py`. All ranked coin constants are **0** (ranked pays no coins). Campaign is the live coin faucet; Vault is the sink.
- Coin writes today: `registration.py` (signup, 0), `settlement.py` (contest_payout/streak_bonus, both 0 → no rows), `campaign.py` (the real faucet), `vault.py` (purchases, negative delta).

**Settlement / standings / bots**
- `app/services/settlement.py::settle_window` locks the window `FOR UPDATE`, acts only if `state == CLOSED`, ranks SUBMITTED entries by `(-total_score, -avg_time_frac)`, applies Elo (`RATING_K=64`) + division, advances the daily streak keyed off `window.contest_date`, writes `Standing(window_id, user_id, place, field_size, total_score, coins_awarded, rating_before, rating_after)`, flips `SETTLED`. **Never commits** — exactly-once + atomic. Inside the placement loop, `place`, `field_size`, `user_id`, `profile` are all in scope: **this is the clean hook for placement Gems.**
- `Standing` stores `place` + `field_size` (bot-padded to `MIN_FIELD_SIZE=8`) — percentile is derivable (`place <= ceil(field_size * 0.10)`, etc.). Note the bot padding inflates the denominator for thin fields.
- `app/services/bots.py`: `_window_seed`/`bot_rng` give deterministic per-bot streams; `_make_bot` already generates a **full per-round trajectory** (per-round correct via `rng.random() < skill`, per-round `time_frac`, real `compute_points`) but `BotEntry` only surfaces `points[]` + `avg_time_frac`. Bots are **in-memory only, never persisted**. Reusable for Duel rivals once per-round `correct[]`/`time_frac[]` are surfaced and the seed is decoupled from `ContestWindow`.
- Settlement gate `app/jobs/tasks.py::settle_due_windows`: `close_at <= now - 15min` (= `now >= settle_at`), chronological order. Driven by daemon tick + targeted 8:15-ET cron. Never lazy.

**Campaign**
- `app/models/campaign.py`: `CampaignSession(entry_id PK, user_id, world, level_number, settled_at)` (settle-once guard) + `UserCampaignProgress((user_id, world, level_number) PK, best_correct, clear_status, first_clear_claimed, times_cleared, completed_at)`.
- 6 worlds, locked short keys: `Science, History, Sports, Geography, Arts, Pop Culture`; 10 levels each, L10 = `is_boss`. Authored manifest `content/campaign/campaign_levels.json` via `content/campaign/manifest.py`. Cosmetics already couple on `world:<key>` requirement strings.
- `app/services/campaign.py::complete_campaign_level` recomputes `correct`/`status`/`passed` server-side from `RoundResult` rows; `_reward_components` pays coins (first-clear stacking, replay flat 5, daily cap 300). **Hook point: after `first_clear`/`status`/`is_boss` are known (~line 454), before `link.settled_at = now`.** First-clear coin gating uses `first_clear_claimed`; **gems should use ledger idempotency keys instead** (so "perfect boss on a later replay" can pay once, which the coin path does NOT do).
- `world_progress.py` (`world_completion(..., perfect_only=)`, `all_worlds_cleared`) supplies perfect-world / all-worlds detection.
- **Chests are frontend-only visuals today** (`frontend/src/lib/campaign.ts::chestState`, `RewardChest.tsx`) — no backend reward. Gem milestones make the L5/arc chests "real."

**Vault / cosmetics**
- Catalog is code: `app/core/cosmetics.py::COSMETIC_CATALOG` of `CosmeticItem(id, kind, cost, requirement)` — `cost` is **coin-only, no currency field**. Only `theme` + `frame` kinds exist; badges/titles are earned (not purchasable); **auras/nameplates/result-effects do not exist anywhere.**
- Ownership: `user_themes` (themes) + `user_cosmetics(user_id, item_id, kind)` (frames). Equipped on `profiles` (`equipped_theme`, `equipped_frame`). `buy_item` (`vault.py`) debits coins via `record_coin_delta`, checks owned/requirement/funds, composite-PK IntegrityError backstop. Error `detail` strings are machine-readable codes the FE switches on (`insufficient_coins` deliberately 400, not 402).
- **`cosmeticIds.json` parity contract** (`frontend/src/theme/cosmeticIds.json`): dual-enforced by `backend/tests/test_cosmetics.py` (reads the FE file by path; `test_catalog_shape` hard-codes the full price map) and `frontend/src/theme/identity.test.ts`/`tokens.test.ts`. Any new id must land in the fixture + FE styles + BE catalog or both suites fail.
- Frontend Vault: `src/screens/vault/VaultScreen.tsx` + `VaultItemCard`/`FrameCard`; **rarity is inferred client-side from coin cost** (`rarity.ts::rarityOf`) → would mis-bucket Gem items unless revised. `VaultItem` client type has no `currency`. Card CTA hard-codes `CoinIcon`.
- Coin balance is shown in 5 always-on places: Vault header, `HomeHeader`, `StatTiles`, `CampaignHero`, `LeaderboardScreen` (+ per-result award strips). `CoinIcon.tsx` is the glyph.

**Engine / scoring / session**
- `app/modules/base.py`: `RoundModule` Protocol (`type`, `time_limit_ms`, `generate`, `score`), `RoundJudgement{correct, time_frac, valid, flags}`, `GenerationContext{bank, seed}`.
- `app/modules/trivia.py`: `time_limit_ms = 10000`; `trivia_spec(q, shuffle_seed, time_limit_ms)` builds `(client_spec, server_answer)` with server-side option shuffle; `score(server_answer, submission)` clamps `elapsed_ms` to the server limit, `time_frac = (limit - elapsed)/limit`, `correct = choice == server_answer["correctIndex"]`. `submission = {choice, elapsed_ms}`.
- `app/services/engine.py::build_round_set(seed, template, ctx)` — pure; iterates `template.rounds` (tuple of `RoundSlot{type, difficulty}`), dedups client_specs. `app/services/templates.py` has `DAILY_ROYALE` (`dr_20_trivia`) + `CATEGORY_SESSION`; a `DUEL_BO7` is a one-line addition.
- `app/services/scoring.py::compute_points(correct, time_frac, streak)` + `score_entry(answers, submissions_by_idx)` → per-round `correct`/`time_frac`/`points` + total.
- Models `app/models/contest.py`: `Entry(window_id nullable, user_id, is_practice, seed, round_set JSONB, total_score, status)`, `RoundAnswer((entry_id, idx) PK, module_type, server_answer JSONB)`, `RoundResult(entry_id, idx, module_type, points, correct, time_frac, valid, flags)`. Window-less entries (practice/campaign) prove the Duel pattern.
- Per-question path: `contest.py::answer_round` (enforces idx order, derives streak from stored results, finalizes on last round) — the model for Duel's per-round submit.

**Frontend shell**
- **No react-router**: `src/app/App.tsx` is a custom screen state machine (boolean/string flags + `authenticatedView()` switch + `closeAllOverlays()`). Immersive screens render no nav; flat screens render `<AppNav>`.
- **No TanStack Query in practice**: screens call the flat `api` object (`src/api/client.ts`) inside `useEffect`. `authedRequest` attaches the bearer token + single-flight 401 refresh. New endpoints follow the `vault`/`buyVaultItem` shape.
- Question UI: `src/modules/multipleChoice/MultipleChoiceRound.tsx` (`spec`, `onComplete`, `eyebrow`, `footer`) + `RoundHeader`/`CountdownRing`/`AnswerPill`. Per-round reveal via `RevealView` (Contest.tsx) off `api.answerRound`'s `{correct, answer, points}`.
- `src/ui/` primitives confirmed (Confetti, CountUp, CountdownRing, AnswerPill, GoldButton, GlassCard, Display, CategorySplash, Starfield, useReducedMotion, CoinIcon). Theme tokens `src/theme/tokens.ts` (15-var contract), CSS `src/theme/global.css`.
- i18n `src/i18n/{en,es,tr}.ts` (nested, `Dict = typeof en` → missing key = compile error). Parity + copy-guard in `i18n.test.ts` (BANNED list) + `identity.test.ts` (BANNED + URGENCY) + an inline copy in `VaultScreen.test.tsx`. **"bet"/"stake"/"deposit"/"withdraw"/"redeem" are NOT yet banned.**
- Session store `src/store/session.ts::Me` (has `coins_balance`); `gems_balance` added alongside, surfaced from `GET /me`. Test mocks hardcode `Me` and need the new field.
- Mobile: `maxWidth: 480`, `100dvh`, `env(safe-area-inset-*)`; nav `BottomNav.tsx` is 5 hand-written slots + a reserved center "Battle" FAB (Daily Royale). No automated overflow tests.

## 3. Economy architecture

Two currencies, both closed-loop, earned-only, server-authoritative:

| | **Coins** | **Gems** |
|---|---|---|
| Faucets | Campaign clears | Daily Royale placement, Campaign milestones, Duel pool wins |
| Sinks | Vault common cosmetics | Duel entries, Gem Vault rare cosmetics |
| Ledger | `coin_ledger` (existing) | `gem_ledger` (new, with idempotency key) |
| Cache | `profiles.coins_balance` | `profiles.gems_balance` (new) |
| Service | `record_coin_delta` | `record_gem_delta` (new) |
| Daily Royale | none (0) | placement tiers (after settlement only) |

**Decision — parallel ledger, not generalized.** A separate `gem_ledger` + `record_gem_delta` mirrors the proven coin pattern with near-zero blast radius and zero risk to the coin invariant/tests. Generalizing (a `currency` column threaded through every call site + two reason-filtered queries + all coin tests) buys ~30 lines of shared code at much higher risk. The one improvement over the coin ledger: a **DB-enforced idempotency key** (the spec's hard requirement for one-time grants).

## 4. Gems ledger design

**Table `gem_ledger`** (`app/models/gem_ledger.py`):

| Column | Type | Notes |
|---|---|---|
| `id` | `Uuid` PK | `default uuid4` |
| `user_id` | `Uuid` | FK `users.id` CASCADE, indexed |
| `delta` | `BigInteger` | signed |
| `reason` | `String(64)` | free-form, same convention as coins |
| `ref_type` | `String(64)` nullable | `"window"`, `"campaign"`, `"duel"`, `"item"` |
| `ref_id` | `Uuid` nullable | window/entry/match id |
| `ref_key` | `String(128)` nullable | string refs (item id, `world:Science`) |
| `balance_after` | `BigInteger` | running snapshot |
| `idempotency_key` | `String(128)` nullable | **partial UNIQUE where not null** |
| `created_at` | `DateTime(tz)` | `server_default now()` |

**Migration** (`down_revision = "f3a4b5c6d7e8"`): create the table, add `profiles.gems_balance BigInteger NOT NULL DEFAULT 0`, and `CREATE UNIQUE INDEX uq_gem_ledger_idempotency ON gem_ledger (idempotency_key) WHERE idempotency_key IS NOT NULL`. No PG enum (follows the `coin_ledger.reason` string precedent; `Entry.status` is also a plain string). Register the model in `app/models/__init__.py`.

**Service `app/services/gem_ledger.py::record_gem_delta(session, user_id, delta, reason, *, ref_type=None, ref_id=None, ref_key=None, idempotency_key=None) -> GemLedger | None`:**
- If `idempotency_key` is set and a row already exists for it → **return that row, write nothing** (no-op grant; balance unchanged). This is the once-guarantee.
- Else: `Profile` `with_for_update`, `balance_after = gems_balance + delta`, **guard `balance_after >= 0`** (raise `InsufficientGemsError` on a debit that would go negative), append row, update `profiles.gems_balance`, `flush()`. On `IntegrityError` from a concurrent same-key insert → swallow and return the existing row (exactly-once under concurrency). Never commits.

**Reason taxonomy** (strings): `starter_daily_royale`, `daily_royale_placement`, `campaign_level5_chest`, `campaign_boss_clear`, `campaign_perfect_boss`, `campaign_perfect_world`, `campaign_all_worlds`, `duel_entry`, `duel_pool_win`, `duel_refund`, `admin_adjustment`. (Granular DR tiers collapse into one `daily_royale_placement` reason with the tier encoded in `ref_key`, e.g. `ref_key="dr_top_10"`.)

Constants → `app/core/constants.py`: `STARTING_GEMS = 0`, `GEM_STARTER_DAILY_ROYALE = 5`, `GEM_DR_TIERS = ((1,1,12),(3,3,7),...)` (see §7), `GEM_CAMPAIGN_*`, `DUEL_TIERS`, `DUEL_SPEED_GAP_MS = 350`, `DUEL_BOT_GEM_CAP_PER_DAY = 3`, `DUEL_SUDDEN_DEATH_MAX = 3`, `DUEL_ROUNDS_TO_WIN = 4`, `DUEL_NORMAL_ROUNDS = 7`.

## 5. Gem source implementation

**5.1 Starter (+5) — at first settled Daily Royale.** In `settle_window`'s real-user branch, attempt `record_gem_delta(..., GEM_STARTER_DAILY_ROYALE, "starter_daily_royale", idempotency_key=f"starter:{user_id}")`. The key makes it once-per-user forever (even across many windows). Atomic with settlement. **Retroactive:** a one-time idempotent backfill command `python -m app.jobs.run backfill_starter_gems` grants `starter:{user_id}` to every user with ≥1 SUBMITTED royale entry; the shared key means the next settlement won't double-grant.

**5.2 Daily Royale placement — at settlement, highest tier only.** New helper `gems_for_place(place, field_size) -> tuple[int, str] | None` returns `(amount, tier_label)` for the single best matching tier:

```
place == 1            -> (12, "dr_crown")
place <= 3            -> (7,  "dr_top_3")
place <= 10% of field -> (4,  "dr_top_10pct")
place <= 25% of field -> (2,  "dr_top_25pct")
place <= 50% of field -> (1,  "dr_top_50pct")
else                  -> None
```

Granted in the placement loop: `record_gem_delta(..., amount, "daily_royale_placement", ref_type="window", ref_id=window_id, ref_key=tier, idempotency_key=f"dr:{window_id}:{user_id}")`. Highest-tier-only is intrinsic (single return). Never before settlement (settlement is the only caller). Coins remain 0. `Standing` gains a `gems_awarded int` column (display parity with `coins_awarded`).

**5.3 Campaign milestones — in `complete_campaign_level`, ledger-keyed (first-time-only, NOT coin-cap-bound).** After `correct`/`status`/`is_boss`/`first_clear` are known and the progress upsert is flushed, attempt each applicable grant (each a no-op if its key exists):

| Milestone | Condition | Amount | idempotency_key |
|---|---|---|---|
| L5 chest | `passed and level_number == 5` | +1 | `cm:{uid}:{world}:5:chest` |
| Boss clear | `passed and is_boss` | +2 | `cm:{uid}:{world}:10:boss` |
| Perfect boss | `is_boss and correct == 10` | +1 | `cm:{uid}:{world}:10:perfect_boss` |
| Perfect world | `world_completion(world, perfect_only=True)` complete | +3 | `cm:{uid}:{world}:perfect_world` |
| All worlds | `all_worlds_cleared(user)` | +10 | `cm:{uid}:all_worlds` |

Gems bypass `CAMPAIGN_DAILY_COIN_CAP` (separate currency). Returned in the completion payload so the FE can surface "+N Gems" alongside coins. The `complete_campaign_level` response schema gains `gems_awarded`.

## 6. Duel backend design

**Reuse, don't reinvent.** A duel creates a window-less `Entry` (`window_id=None`, `seed=match.seed`) with `RoundAnswer` rows (anti-cheat answer storage) for **10 questions** (7 normal + 3 reserved sudden-death), built via a new `DUEL_BO7` template through `build_round_set` + `fetch_bank("trivia")` (mixed categories, like ranked). The user's per-round play is scored by the **existing** `TriviaModule.score` → `RoundResult`. Three new tables hold duel-specific state.

**New models (`app/models/duel.py`):**

`duel_matches` — `id, user_id(FK), entry_id(FK entries, unique), duel_type(String16: training|spark|crown|royal), rival_type(String16: bot|human_snapshot|live_human), rival_user_id(UUID null), rival_snapshot_id(UUID null), bot_rival_tier(String16 null: rookie|solid|sharp|elite), entry_gems(int), pool_gems(int), seed(BigInteger), rival_run(JSONB)`, `status(String16: created|in_progress|completed|abandoned|refunded)`, `user_round_wins(int)`, `rival_round_wins(int)`, `winner(String16 null: user|rival|none)`, `result_reason(String32 null)`, `gem_delta(int)`, `xp_awarded(int)`, `contest_date(Date, ET — for the bot-cap query)`, `started_at, completed_at, expires_at(null), created_at, updated_at`.
- `rival_run` JSONB = list of `{correct: bool, time_ms: int}` for all 10 questions, generated server-side at create from `seed`+tier. **Never sent to the client.**

`duel_rounds` — `id, match_id(FK indexed), round_index(int), phase(String12: normal|sudden_death), user_answer(int null), user_correct(bool), user_time_ms(int), rival_correct(bool), rival_time_ms(int), outcome(String12: user_win|rival_win|no_point), outcome_reason(String24: correct_vs_wrong|speed_gap|both_wrong|near_tie_correct|tiebreak_total_correct|tiebreak_avg_speed), created_at`. Written one row per adjudicated round.

`duel_user_stats` — `user_id(PK FK), wins, losses, training_wins, training_losses, current_streak, best_streak, perfect_wins, comeback_wins, total_gems_won, total_gems_lost, duel_xp, duel_tier(String16 default 'bronze'), updated_at`. Lazily created on first duel.

**Services (`app/services/duel.py`):**

- `duel_config(session, user_id)` → tiers with entry/pool/`unlocked`/`bot_cap_remaining` + copy labels. Unlocks: Spark always; Crown at `stats.wins >= 5`; Royal at `stats.wins >= 25`. Training always.
- `create_duel(session, user_id, duel_type)`:
  1. Validate `duel_type`; load/create `duel_user_stats`; check unlock.
  2. If Gem duel: enforce bot cap (`count(duel_matches where user_id, rival_type='bot', entry_gems>0, contest_date==today_et, status != 'refunded') < DUEL_BOT_GEM_CAP_PER_DAY`) → else `BotGemCapReachedError`. Check `gems_balance >= entry` → else `InsufficientGemsError`.
  3. `seed = secrets.randbits(63)`. Insert `duel_matches` (status `created`, contest_date = ET today), `flush()` for `id`.
  4. Pick `bot_rival_tier` server-side from the user's duel strength (`duel_xp`/recent winrate) + `duel_type` (higher tiers → sharper rival). Generate `rival_run` (10 rounds) via `make_duel_rival(seed, tier, user_skill_hint, num_rounds=10)`; store on the match.
  5. Build the 10-round set, create the `Entry` + `RoundAnswer` rows (clone `start_practice`). Link `entry_id` on the match.
  6. If Gem duel: `record_gem_delta(..., -entry, "duel_entry", ref_type="duel", ref_id=match_id, idempotency_key=f"duel:{match_id}:entry")`. Set `status='in_progress'`, `started_at`, `expires_at = now + 30min`.
  7. Return match payload: `match_id, duel_type, entry_gems, pool_gems, rival{label,tier,accuracy,speed}` (copy-safe, no fake name), and the **answer-free** round set (first question onward).
  - All in one transaction; any failure rolls back → **no debit happens** (covers the "errors before completion → refund" case for create).
- `submit_duel_round(session, user_id, match_id, idx, result)` (per-round):
  1. Load match (ownership + `status=='in_progress'`); enforce `idx == count(existing duel_rounds)` (strict order).
  2. Score the user's round via the existing path (`get_module(answer.module_type).score(server_answer, result)` → `RoundResult`).
  3. Read `rival_run[idx]`. Adjudicate (see §7) → `outcome`, `outcome_reason`. Update `user_round_wins`/`rival_round_wins`; insert `duel_rounds` row.
  4. Determine `next`: `done` if a side reached 4, or after the 7th normal round (then sudden death if tied), or after `DUEL_SUDDEN_DEATH_MAX` SD rounds (final tiebreak). Else `normal`/`sudden_death`.
  5. On `done`: `finalize_duel` (atomic) — set `winner`/`result_reason`, update `duel_user_stats` (+XP, streak, perfect/comeback), and if a Gem duel won: `record_gem_delta(..., pool, "duel_pool_win", ref_type="duel", ref_id=match_id, idempotency_key=f"duel:{match_id}:win")`; set `gem_delta = (pool - entry)` on win or `-entry` on loss/training-0; `status='completed'`, `completed_at`. Idempotent via match `status` + ledger key.
  6. Return per-round reveal: `{outcome, outcome_reason, your_correct, answer{correctIndex}, rival_correct, rival_time_ms, user_round_wins, rival_round_wins, phase, next, finished, result?}`.
- `get_duel(session, user_id, match_id)` → current state / final result (for resume + result screen).
- `cleanup_expired_duels(session, now)` (daemon tick + one-shot): `created`/`in_progress` matches past `expires_at` → `status='abandoned'`; Gem entry already debited = forfeit; if ≥1 round played, record a `loss` in stats (else pure forfeit, no stat). No refund (abandonment is a forfeit by policy). Wired into `jobs/tasks.py` + `jobs/daemon.py` like settlement.

**Accounting model (anti-inflation), explained:** user-side ledger only; the bot is virtual. Entry is **debited** at create (`-entry`); a win **credits the pool** (`+pool`). For the 1:2 / 3:6 / 5:10 ratios, a win nets `+entry` (mints `pool-entry = entry` gems) and a loss nets `-entry` (burns entry). At ~50% winrate the faucet is ~neutral; skilled play nets positive (intended "skill reward"). **Minting is bounded by `DUEL_BOT_GEM_CAP_PER_DAY = 3`** — at most 3 bot Gem duels/day, so worst-case daily mint per user is small and capped. Training duels touch no ledger.

## 7. Duel scoring design

Per-round adjudication (`DUEL_SPEED_GAP_MS = 350`), using the user's `RoundResult` (`correct`, `time_frac`) and `rival_run[idx]`. Convert `time_frac` → `time_ms` via `elapsed_ms = round(limit_ms * (1 - time_frac))` (server limit = 10000) for the gap comparison and storage.

```
user_correct & !rival_correct -> user_win  (correct_vs_wrong)
rival_correct & !user_correct -> rival_win (correct_vs_wrong)
!user_correct & !rival_correct -> no_point (both_wrong)
both correct:
    gap = abs(user_ms - rival_ms)
    gap >= 350 -> faster side wins (speed_gap)
    gap <  350 -> no_point (near_tie_correct)
```

**Match outcome:** first to `DUEL_ROUNDS_TO_WIN = 4` round wins → done (early-out allowed before Q7). After 7 normal rounds with no 4: higher round-wins wins. If tied → **sudden death**: one question at a time (phase `sudden_death`), same per-round rule; max `DUEL_SUDDEN_DEATH_MAX = 3`. Still tied after SD → deterministic final tiebreak, in order: (1) total correct across the match (`tiebreak_total_correct`), (2) lower avg response time on correct answers (`tiebreak_avg_speed`), (3) `Random(match.seed)` coin-flip (recorded as `result_reason="tiebreak_seed"`). No endless SD.

**Perfect win** = user wins 4–0 with no missed user rounds. **Comeback win** = user was behind by ≥2 round-wins at some point and still won (tracked during adjudication). Both add bonus XP and increment their stat counters.

**XP / tier:** Gem-duel win +10 / loss +3; training win +2 / loss +1; perfect +5; comeback +5. `duel_tier` from cumulative `duel_xp`: Bronze < 100 < Silver < 300 < Gold < 700 < Crown. (Tier is cosmetic/status only — **never** affects Daily Royale rating/division/streak; duel and ranked stats are fully separate tables.)

## 8. Bot rival / anti-farming plan

- `app/services/bots.py`: surface per-round data — add `correct: list[bool]` + `time_fracs: list[float]` to `BotEntry` (data already computed in `_make_bot`), and add `make_duel_rival(seed: int, tier: str, user_skill_hint: float, num_rounds: int) -> list[dict]` returning `[{correct, time_ms}, ...]`. Skill/speed ranges per tier (`rookie` ~0.55 / `elite` ~0.9 accuracy), modulated by `user_skill_hint` (derived from the user's duel winrate/xp and duel_type) so a stronger player faces a sharper rival — **chosen server-side; the client never selects difficulty.** Deterministic from `(seed, tier)` → reproducible/auditable, regenerable from the stored `seed`.
- **Honest rival copy:** `rival_type='bot'`; label as "Rival: Sharp" / "Accuracy: Strong" / "Speed: Fast" — **no fake human names, no "live"/"real player" language.** `WindowOut`-style field counts are never fabricated.
- **Anti-farming controls:** (1) server-side ledger only; (2) entry debit + pool credit transactional with idempotency keys; (3) `balance_after >= 0` guard — no negative balances; (4) `DUEL_BOT_GEM_CAP_PER_DAY = 3` (Gem bot duels), training uncapped; (5) rival difficulty server-chosen; (6) answers/timings validated by the existing `TriviaModule.score` (client `elapsed_ms` clamped to the server limit); (7) one `Entry`/`RoundAnswer` set per match, seed fixed at create — replaying a seen seed is impossible (a new duel = a new match + new seed); (8) match `status` gate makes finalize exactly-once (no double pool credit); (9) abandoned Gem duels forfeit the entry. No Gem transfer / purchase / redeem endpoints exist or are added.

## 9. API endpoint plan

All under the existing typed-client convention. Auth = bearer (`authedRequest`).

| Method | Path | Returns |
|---|---|---|
| `GET` | `/me/wallet` | `{coins_balance, gems_balance, duel:{bot_gem_duels_used, bot_gem_duels_cap}}` |
| `GET` | `/duel/config` | tiers `[{type, entry_gems, pool_gems, unlocked, lock_reason?}]`, `bot_cap_remaining`, `disclaimer` |
| `POST` | `/duel/create` `{duel_type}` | `{match_id, duel_type, entry_gems, pool_gems, rival{label,tier,accuracy,speed}, rounds[answer-free]}`; 400 `insufficient_gems` / 403 `duel_locked` / 429 `bot_gem_cap_reached` |
| `POST` | `/duel/{match_id}/round` `{idx, result}` | per-round reveal (see §6) |
| `GET` | `/duel/{match_id}` | current/final match state |
| `GET` | `/me/duel-stats` | record, streak, xp, tier, gems won/lost, perfect/comeback |
| `GET` | `/duel/recent` | last N matches (lightweight; for Profile) |

`GET /me` (`MeResponse`) gains `gems_balance`. `GET /me/gem-ledger` is **deferred** (not needed for v1 UI). Error `detail` codes stay machine-readable like the vault (`insufficient_gems`, not money words). Routers: `app/api/duel.py`, `app/api/wallet.py` (or fold wallet into `me.py`), registered in `app/main.py`.

## 10. Frontend UX plan

- **GemIcon** (`src/ui/GemIcon.tsx`) — SVG sibling to `CoinIcon`, re-skins via a token (`--cyan`/violet, distinct from gold coins).
- **Home (`src/screens/Home.tsx`):** insert `<DuelCard onDuel={onDuel} />` as the #2 element (between `HeroCard` and `ResultStrip`), modeled on `PracticeCard.tsx` — "DUEL / Best of 7 / Face a rival run · Win the Gem pool", gold CTA "Start Duel" (or "Training Duel" when `gems_balance == 0`). Add `onDuel` to Home props; thread from `App`.
- **App shell (`src/app/App.tsx`):** add a `duelFlow: "off"|"lobby"|"prematch"|"playing"|"result"` state (Campaign-style multi-step), a `goDuel()` (calls `closeAllOverlays()`), and render branches — `lobby`/`result` render `<AppNav>`; `playing` is immersive (no nav).
- **DuelLobby** (`src/screens/duel/DuelLobby.tsx`): Gem balance pill (GemIcon), four tier cards (Training/Spark/Crown/Royal) with entry/pool, unlock + bot-cap states, rules copy, and a disclaimer info link. Insufficient gems → Training offered; locked tier → goal-framed copy; cap reached → "Gem rival limit reached for today. Training Duels are still open."
- **DuelPreMatch** (`src/screens/duel/DuelPreMatch.tsx`): tier, entry/pool, "Rival: Sharp", Best of 7 / first to 4, "Start Duel".
- **DuelPlay** (`src/screens/duel/DuelPlay.tsx`): reuse `MultipleChoiceRound` with `eyebrow` = `YOU n — m RIVAL` + `Question k / 7`, `footer` = subtle Gem-pool context. After each lock, call `api.submitDuelRound` and show a fast outcome reveal (reuse `RevealView`/`AnswerPill` states): Round Won / Speed Win (with delta) / Round Lost / No Point (both missed / too close). Drive the score from the server response only.
- **DuelResult** (`src/screens/duel/DuelResult.tsx`): VICTORY/DEFEAT/PERFECT DUEL with score, Gems earned/lost (or "no Gem change" for Training), duel streak, XP, best round, and the always-present primary CTA **Run It Back** (re-creates the same tier) + Home/Training secondaries.
- **Wallet/balance:** add a Gem pill next to the coin pill in `HomeHeader`; show `gems_balance` in the Vault header and Duel screens. Source from `me.gems_balance`; after a duel, patch the store (`setMe({...me, gems_balance})`) or `refreshMe()`.
- **API client:** add `wallet`, `duelConfig`, `createDuel`, `submitDuelRound`, `getDuel`, `duelStats`, `duelRecent` to `src/api/client.ts` (vault pattern). New response interfaces near the top.
- Mobile: all new screens `maxWidth: 480`, `100dvh`, `env(safe-area-inset-*)`, reuse `clamp()` font sizing; reduced-motion via the primitives.

## 11. Vault / Profile integration

- **Backend currency wiring:** add `currency: str = "coins"` to `CosmeticItem`; `VaultItemOut` gains `currency`; `buy_item` branches the debit (`record_coin_delta` vs `record_gem_delta`, with the matching insufficient-funds error). Add Gem-priced **frames** to `COSMETIC_CATALOG` (e.g. `violet_duel_frame` 25g, `crown_duel_frame` 60g) — reusing the existing `frame` kind + `equipped_frame` slot (no new equip infra). Add their ids to `cosmeticIds.json` (a new `gem_frames` array or extend `frames`), add FE `FRAME_STYLES`, and **update `test_cosmetics.py::test_catalog_shape`** (hard-coded map) + the parity tests.
- **Auras / nameplates / result-effects are DEFERRED** (new kinds = new equip slots + renderers + cosmeticIds arrays). The `currency` seam means they drop in later with no schema change.
- **Frontend Vault:** `VaultItem` gains `currency`; cards render `GemIcon` + Gem price when `currency==="gems"`; a Gems section (segmented control or section header) groups Gem items. **Rarity for Gem items** = explicit `prestige`/`epic` tier (don't run them through `rarityOf`'s coin-cost thresholds). Affordability checks `gems_balance`.
- **Profile:** add a Duel section (Record, current/best streak, Gems won, Perfect/Comeback, Duel Tier) fed by `api.duelStats` — secondary to the existing Daily Royale status block.

## 12. Copy / i18n plan

- New `duel` namespace + `nav.duel?` and a `wallet`/`gems` namespace in `en.ts` → mirrored in `es.ts` + `tr.ts` (compile-enforced parity). Allowed: Gems, Entry, Match Pool, Winner earns the pool, Duel, Spark/Crown/Royal Duel, Training Duel, Run It Back, No cash value, Earned in-game, Rare unlocks, Skill rewards, Rival.
- **Disclaimer string** (Wallet/Lobby info modal): *"Gems are earned in-game, have no cash value, cannot be purchased, transferred, sold, or redeemed, and do not provide an advantage in Daily Royale."*
- **Extend the copy guard** in all three locations (`i18n.test.ts`, `identity.test.ts`, `VaultScreen.test.tsx` — they're independent copies): add `bet`, `stake`, `deposit`, `withdraw`, `redeem`, `sweepstake`, `payout` (some already present) to `BANNED`. Keep "wager"/"gambl"/"jackpot"/"casino"/"cash"/"prize". Verify all new Duel/Gem copy passes.

## 13. Data migration plan

1. **Migration A (Phase 1):** `gem_ledger` table + `gem_ledger` partial-unique idempotency index + `profiles.gems_balance` (default 0) + `standings.gems_awarded` (default 0). `down_revision = f3a4b5c6d7e8`.
2. **Migration B (Phase 3):** `duel_matches`, `duel_rounds`, `duel_user_stats` (+ indexes). No enums (string columns). Additive only.
3. **Backfill (Phase 2, prod one-shot):** `python -m app.jobs.run backfill_starter_gems` — idempotent (key `starter:{user_id}`), grants +5 to users with ≥1 completed royale. Re-runnable safely.
- **Reversibility:** every migration has a `downgrade` dropping its tables/columns/types. All changes are additive; **no existing row is modified**, the coin ledger/invariant is untouched, Daily Royale settlement keeps paying 0 coins. **Rollback** = downgrade B then A (drops Duel + Gems); the only persisted side effect is gem_ledger rows, removed by the downgrade.
- **Deploy:** snapshot the prod DB before B; run migrations; deploy backend; run the backfill once; deploy frontend; smoke-test (create a Training duel, a Spark duel with seeded gems, settle a window and confirm placement gems, complete a campaign L5 and confirm +1 gem). The cleanup-expired job rides the existing daemon/cron.

## 14. Tests

**Phase 1 (gem ledger):** balance == ledger sum; idempotency key → one row on repeat; negative-balance debit raises; concurrent same-key insert → one row; `/me/wallet` shape.

**Phase 2 (sources):** starter +5 once (repeat settle = no double); backfill grants once to eligible users only; DR placement awards highest tier only (1st=12, top3=7, top10%=4, top25%=2, top50%=1, else 0); DR gems only after `settle_at` gate; settlement still writes no coin rows; campaign L5=+1 once, boss=+2 once, perfect-boss=+1 once (incl. perfect-on-replay), perfect-world=+3 once, all-worlds=+10 once; campaign gems bypass the coin cap; gems never change rating/division/streak.

**Phase 3 (duel core):** entry debits gems; win credits pool; loss credits nothing; training debits/credits nothing; insufficient gems blocks; bot Gem-duel cap blocks (training uncapped); round scoring correct/wrong; both-correct gap≥350 → faster wins; gap<350 → no point; both-wrong → no point; first-to-4 ends early; tie after 7 → sudden death; SD capped at 3; final deterministic tiebreak (total correct → avg speed → seed); stats/streak/xp/tier update; perfect & comeback detection; abandoned/expired forfeit; finalize idempotent (no double pool credit); no transfer/purchase/redeem endpoints exist (route-absence assertion).

**Phase 4–5 (frontend):** Home shows Duel as the #2 card; lobby shows all four tiers; Gem balance renders; insufficient-gems state; locked-tier state; bot-cap-reached state; question screen shows `YOU — RIVAL`; each round outcome message renders; victory shows Gems earned + Run It Back; defeat shows Gems lost + Run It Back; training shows no Gem change; Vault Gem section + GemIcon price; Profile duel stats render; i18n en/es/tr parity; copy guard blocks the new banned words; 360/390px no horizontal overflow (add width-assertion tests for the new screens); bottom nav doesn't cover content; reduced motion respected.

## 15. Risks

1. **Gambling-adjacency** if copy/mechanics drift → strict copy guard, honest "rival/Training/earned-in-game" language, disclaimer, no scarcity/FOMO. 2. **Bot-duel farming** → server-chosen difficulty + 3/day Gem cap + capped minting. 3. **Selling/redeeming Gems = compliance risk** → not built; no transfer/purchase/withdraw routes. 4. **Loot-box risk** → fixed rewards only, no randomized purchasable chests. 5. **Lock-out** → Training Duel always available with 0 Gems. 6. **Gem inflation** → win mints only `pool-entry`, bounded by the daily cap; Gem Vault sinks. 7. **Hoarding** → Gem Vault rare cosmetics as sinks. 8. **Punishing losses** → small entries (1/3/5), Training fallback, "Run It Back" + close-loss copy. 9. **Speed-tie confusion** → explain the 350ms rule in lobby + per-round reveal. 10. **Client timing abuse** → server clamps `elapsed_ms` to the 10s limit (existing). 11. **Human-snapshot complexity** → deferred; `rival_type`/`rival_snapshot_id`/`expires_at`/`status` columns reserve the seam. 12. **"wager" in copy** → banned + tested. 13. **Daily Royale untouched** → Gems are additive at settlement; rating/division/streak/coins unchanged. 14. **Cannibalizing the daily** → Gems are a *faucet from* Daily Royale (reinforces it); Duel is the repeatable loop, not a second crown. 15. **Cosmetic advantage** → Gem cosmetics are visual-only (frames), no gameplay effect.

## 16. Build phases

- **Phase 1 — Gems ledger + wallet:** model, migration A, `record_gem_delta` (idempotent, non-negative), `profiles.gems_balance`, `MeResponse.gems_balance`, `GET /me/wallet`, FE `GemIcon` + `gems_balance` on `Me` + a Gem pill. Tests. Disclaimer string added.
- **Phase 2 — Gem sources:** starter (+5 at settlement) + backfill command; `gems_for_place` + placement grants in `settle_window` + `standings.gems_awarded`; campaign milestone grants in `complete_campaign_level`. Tests; confirm coins still 0 at ranked.
- **Phase 3 — Duel backend core:** migration B; duel models; `DUEL_BO7` template; `make_duel_rival` + `BotEntry` per-round surfacing; `create_duel`/`submit_duel_round`/`finalize_duel`/`cleanup_expired_duels`; adjudicator + sudden death + tiebreak; entry/pool/refund; bot cap; stats/xp/tier; routers (`/duel/*`, `/me/duel-stats`); daemon wiring. Backend tests.
- **Phase 4 — Duel frontend:** Home Duel card; App `duelFlow`; Lobby/PreMatch/Play/Result; Run It Back; insufficient-gems + bot-cap states; client methods; mobile QA.
- **Phase 5 — Vault/Profile integration:** `currency` wiring (BE catalog + schema + `buy_item`; FE `VaultItem` + cards); Gem-priced frames + cosmeticIds parity updates; Gem Vault section; Profile Duel stats. Tests.
- **Phase 6 — Copy/i18n/QA:** en/es/tr `duel`+`wallet` namespaces; extend BANNED in all three guards; a11y + reduced-motion + safe-area pass; full typecheck/lint/build/test.
- **Phase 7 — Review/deploy:** migration + backfill + rollback runbook; DB snapshot; prod smoke test; existing-user starter-gem backfill executed once.

## 17. Acceptance criteria

Mapped 1:1 to the spec's §25 list (1–30). Tracked per phase; each phase ends green on typecheck/lint/build/tests. Key gates: ledger-backed Gems, earned-only/no-cash-value/disclaimer, DR grants at settlement (highest tier only), campaign first-clear-only milestones, Training always free, Spark/Crown/Royal 1/3/5 → 2/6/10, insufficient-gems blocks, bot cap, 10s/best-of-7/first-to-4, 350ms speed rule, no-point cases, capped sudden death + deterministic tiebreak, clear result + Run It Back, duel stats separate from ranked, Gem Vault present (frames; rest deferred with backend ready), Profile duel stats, no banned copy, no money/transfer/redeem routes, mobile 360/390 no overflow.

## 18. Decisions (locked 2026-06-11)

1. **Duel submit model** — ✅ **Per-round reveal** (reuse `answer_round`; live `YOU — RIVAL` + per-round outcome).
2. **Gem Vault v1 scope** — ✅ **Gem-priced frames only**, `currency` seam wired end-to-end; auras/nameplates/result-effects deferred.
3. **Gem ledger shape** — ✅ **Parallel `gem_ledger` + partial-unique idempotency key**; coin ledger untouched.
4. **Duel navigation** — ✅ **Home #2 card only**; 5-slot bottom nav + center FAB unchanged.
5. **Weekly Skill Missions** — ✅ **Deferred to V2** (no mission architecture).
6. **Retroactive starter Gems** — ✅ **One-time idempotent backfill** for users with ≥1 completed Daily Royale.
