# Daily Royale — Deploy Runbook

Cutover from the 3-window model (morning/midday/night) to one Daily Royale per ET date.
Branch `feat/daily-royale`. This is a **content/scheduling cutover with no window-table schema
change** (the `slot` column + `UNIQUE(contest_date, slot)` are preserved; legacy rows stay readable).

## Pre-deploy checklist
- [ ] Branch merged to `main` (or deploying the branch build).
- [ ] **Take a database snapshot** (Render dashboard → the Postgres instance → manual backup). The
      only destructive step is the data-tidy migration, which deletes *future, SCHEDULED, zero-entry*
      legacy windows — but snapshot anyway for instant rollback.
- [ ] Confirm the trivia bank is ingested in prod: the Daily Royale draws 8 trivia from the live
      servable bank. `render.yaml`'s api `startCommand` runs `ingest ../content/bank` (≈600 approved
      questions). If the bank were empty, `enter` would raise "trivia bank is empty". Verify after
      deploy via a smoke entry (below).

## Deploy timing — IMPORTANT
Deploy **overnight, during the dark hours before 8:00 AM ET** (i.e. after the legacy night window has
settled and before the first Daily Royale opens). This guarantees **no user is mid-game** during the
cutover and the first Daily Royale opens cleanly at 8:00 AM ET.

## What deploys
1. **Migrations** (run automatically by the api `startCommand`: `alembic upgrade head`):
   - `f3a4b5c6d7e8` — data tidy: `DELETE` of future SCHEDULED zero-entry legacy windows. Safe predicate
     (state=SCHEDULED ∧ slot∈{morning,midday,night} ∧ open_at>now ∧ no entries; `window_id IS NOT NULL`
     guards the NOT-IN). Never touches CLOSED/SETTLED windows, windows with entries, royale windows,
     or past windows. Downgrade is a no-op.
2. **Scheduling**: `PROVISIONED_SLOTS=("royale",)` — going forward only the royale window is created
   (8:00 AM–8:00 PM ET, a 12-hour window). Legacy `WINDOW_SLOTS` entries remain for historical
   computation only.
3. **Settlement timing**: `SETTLE_DELAY_MINUTES=15` gate → settles at 8:15 PM ET.
4. **render.yaml cron** (apply the new service):
   - `rot-royale-cron` heartbeat relaxed to `*/2 * * * *` (fallback for create/transition/catch-up).
   - **NEW** `rot-royale-settle` cron `15 0,1 * * *` (00:15 + 01:15 UTC = 8:15 PM ET in EDT/EST; the
     settle gate makes exactly the DST-correct fire effective, the other a no-op). Mirror the existing
     cron's env (DATABASE_URL, SECRET_KEY, APP_ENV, VAPID keys). **This service must be created in
     Render** (a render.yaml change alone provisions it on the next blueprint sync — confirm it appears).

## Day-one verification (the ET schedule)
- **~7:55 AM ET**: confirm a single SCHEDULED `royale` window exists for today (no morning/midday/night
  SCHEDULED rows for today/future remain). `GET /contests/current` → `schedule` has one royale.
- **8:00 AM ET**: window transitions OPEN (heartbeat or lazy-on-read). Home shows state B "Enter Daily
  Royale". Do a smoke entry (a test account): enter → 8 trivia rounds build → submit → "Score Locked".
- **During the day**: field count is real (entry_count) + bots pad to 8 so the leaderboard isn't empty.
- **8:00 PM ET**: window transitions CLOSED. Home shows state D "Field closed / Results settling",
  countdown to 8:15. Standings show "Provisional".
- **8:15 PM ET**: `rot-royale-settle` fires → window SETTLED, standings written, **zero coin ledger
  rows**, rating/division/streak applied. Home shows state E "Results Ready / Reveal Your Standing";
  leaderboard shows "Final". Confirm results landed at ~8:15, not via a user opening the app.
- **Next 8:00 AM ET**: tomorrow's royale opens; yesterday's result viewable in history as "Daily
  Royale" (legacy rows render as "Legacy * Game").

## Monitoring
- Watch the `rot-royale-settle` cron logs at 00:15 and 01:15 UTC — exactly one should report a window
  settled (the DST-correct one); the other a no-op.
- Verify `coin_ledger` gains no rows from ranked settlement.
- Verify only one `contest_windows` row per `contest_date` going forward (slot `royale`).

## Rollback
- Revert the deploy (redeploy the prior `main`). Old provisioning (`PROVISIONED_SLOTS` → 3 slots)
  resumes; the data-tidy downgrade is a no-op (deleted future empty windows simply get re-provisioned).
- If data integrity is in question, restore the pre-deploy snapshot.
- No window-table schema was changed, so rollback is low-risk; the snapshot is the safety net for the
  one DELETE.

## Notes
- Time **labels** in the UI are viewer-local (app convention); the contest itself is defined in ET
  wall-clock (zoneinfo, DST-correct). A user in PT sees "unlocks at 5:00 AM" with a correct countdown.
- Campaign, Vault, identity, and practice are unaffected by this cutover.
