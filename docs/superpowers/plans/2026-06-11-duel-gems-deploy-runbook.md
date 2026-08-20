# Duel Mode + Gems — Deploy & Rollback Runbook

Branch: `feat/duel-gems-economy` (29 commits, 88 files, +8381/−149). Final whole-branch review: **READY-TO-MERGE**. Backend `492 passed`, frontend `409 passed`, single migration head `c5d6e7f8a9b0`. All changes are **additive** — no existing row is modified, the coin ledger/invariant and Daily Royale settlement (still pays 0 coins) are untouched.

## What ships
- **Gems** — a second, scarce, earned-only currency: `gem_ledger` (append-only, idempotency-keyed) + `profiles.gems_balance` cache. Faucets: starter +5 at first settled Daily Royale, DR placement (12/7/4/2/1, highest tier only), campaign milestones (L5 +1 / boss +2 / perfect boss +1 / perfect world +3 / all worlds +10). Sinks: Duel entries, Gem Vault frames.
- **Duel** — async, bot-backed, best-of-7, 10s/question, first-to-4, 350 ms speed-tie rule, capped sudden death + deterministic tiebreak. Tiers: Training 0, Spark 1→2, Crown 3→6 (5 wins), Royal 5→10 (25 wins); bot Gem-duel cap 3/ET-day. New endpoints `/duel/*`, `/me/wallet`, `/me/duel-stats`.
- **Vault** — `currency` seam + two Gem-priced frames; **Profile** — a Duel stats section.

## Three new migrations (linear, head `c5d6e7f8a9b0`)
1. `a3b4c5d6e7f8` — `gem_ledger` table (+ partial-unique idempotency index) + `profiles.gems_balance` (default 0). `down_revision = f3a4b5c6d7e8`.
2. `b4c5d6e7f8a9` — `standings.gems_awarded` (default 0).
3. `c5d6e7f8a9b0` — `duel_matches` / `duel_rounds` / `duel_user_stats`.

All status-like columns are plain `String` (no PG enums). Each migration has a symmetric `downgrade()`.

## Deploy steps (prod)
1. **Snapshot the prod DB** (the only safety net for the new tables/columns; everything else is reversible by downgrade).
2. **Merge** `feat/duel-gems-economy` → `main` (open a PR; this branch has not been pushed yet).
3. **Apply migrations** on the API host: `cd backend && uv run alembic upgrade head` → applies the three new migrations. Additive; safe on a live DB (no data rewrite, no long locks — new tables + nullable-with-default columns).
4. **Deploy the backend** (the web service; `scheduler_enabled=false` there as today).
5. **Run the one-shot starter-gem backfill once:** `python -m app.jobs.run backfill_starter_gems`. Idempotent (key `starter:{user_id}`) — grants +5 to every existing user with ≥1 completed Daily Royale; re-running grants 0. New users get the +5 automatically at their first settled royale.
6. **Deploy the frontend** (`npm run build`). `GET /me` now returns `gems_balance`; the Home Duel card + gem pills light up.
7. **Crons — no NEW cron required for Duel.** `cleanup_expired_duels` (abandons/forfeits unfinished duels past their 30-min `expires_at`) is wired into the existing `python -m app.jobs.run both` heartbeat (`jobs/run.py`) **and** the in-process daemon tick (`jobs/daemon.py::_tick`), so it rides whatever already runs `both`. The Daily Royale settle cron (`rot-royale-settle`, from the Daily Royale change) is unchanged and still required.

## Smoke test (prod, post-deploy)
1. `GET /me/wallet` for a test account → `{coins_balance, gems_balance, duel:{bot_gem_duels_used, bot_gem_duels_cap}}`.
2. Home renders the **Duel** card as #2; the gem pill shows the balance.
3. **Training Duel** (free): create → play 7 → result screen with Run It Back; no gem change.
4. Seed/grant a few gems → **Spark Duel**: entry debits 1 gem (`/me/wallet` reflects it); a win credits the pool (net +1), a loss nets −1; stats update on `/me/duel-stats`.
5. **Daily Royale**: after the 8:15-ET settlement, a participating account's `standings.gems_awarded` and `gem_ledger` show the placement tier (+ the one-time starter +5 on a first royale).
6. **Campaign**: clear a world's level 5 → completion response shows `gems_awarded: 1`; the gem milestone is once-only.
7. **Vault** → Frames tab shows the Gem tier (Duelist's Edge 25, Crown Duelist 60) with GemIcon prices; a gem buy debits gems (not coins).
8. Confirm **no** real-money / purchase / transfer / redeem route exists (only `/duel/*` earn/spend); the **no-cash-value disclaimer** renders in the Duel lobby.

## Rollback
Fully reversible; the only persisted side effects are `gem_ledger` rows + `gems_balance`/`gems_awarded` values, all dropped by the downgrade.
1. Revert the frontend deploy.
2. Revert the backend deploy to the pre-merge build.
3. `cd backend && uv run alembic downgrade f3a4b5c6d7e8` — drops duel tables → `standings.gems_awarded` → `gem_ledger` + `profiles.gems_balance`, in order. The coin economy, Daily Royale settlement, campaign, and vault (coin path) are unaffected.
4. (If only a partial rollback is needed, downgrade to the specific revision — the chain is linear.)

The pre-deploy DB snapshot is the backstop if a downgrade is undesirable.

## Notes / deferred
- **Phase 6 deferred (by request):** the banned-word guard was NOT expanded with `bet/stake/deposit/withdraw/redeem`, and the es/tr duel/gem translations were not given a dedicated copy audit. This is hardening only — the existing guard already blocks cash/prize/wager/gambl/jackpot/payout, and the review confirmed **no banned word appears in any non-exempt duel/gem copy** (the `duel.disclaimer` no-cash-value line is the single intentional exemption). Recommended as a fast follow-up before a marketing push, not a launch blocker.
- **Known accepted v1 limitation:** the bot Gem-duel daily-cap check is count-then-create without a row lock (a concurrent race could let a user squeeze one extra bot Gem duel/day). Documented in `services/duel.py`; acceptable for v1 given the small cap and entry size.
- **Human-snapshot / live Duel** is not built; the `rival_type`/`rival_snapshot_id`/`expires_at`/`status` columns reserve the seam for V2.
- **Weekly Skill Missions** deferred to V2 (no mission architecture).
