# Post-deploy verification checklist (Brain Boost + ranked gate + funnel release)

Run top to bottom after deploying to Render. API base: https://rot-royale-api.onrender.com
(memory: no Render CLI/MCP access — verify via HTTP + the dashboard).

## 1. Migrate + seed

- [ ] Web service deployed; cron services unchanged (`rot-royale-settle` etc. still scheduled).
- [ ] `uv run alembic upgrade head` ran against prod DB (release command or one-off job).
      Expected chain: `b8c9d0e1f2a3 → aa11bb22cc33 → bb22cc33dd44 → cc33dd44ee55`.
- [ ] Money & Business seed loaded:
      `python -m app.jobs.run ingest content/bank/money_business.json`
      → `added 26, skipped 0, rejected 0` (re-run is idempotent: `skipped 26`).
- [ ] (Optional, needs ROT_AI_* env) classify new content:
      `python -m app.jobs.run classify --dry-run` then without `--dry-run`.

## 2. Env vars (web service)

- [ ] `PERSONALIZE_RANKED_DAILY` unset or `false` (ranked fairness).
- [ ] `PERSONALIZATION_ENABLED=true`, `PERSONALIZATION_DEBUG` unset/false.
- [ ] `ROT_AI_ENABLED=false` unless classification is intended; key/base/model only in env, never
      committed.

## 3. API smoke (curl)

- [ ] `GET /health` → `{"status":"ok","db":"ok"}`.
- [ ] `POST /auth/guest` → 200 with token pair. Keep the access token as `$T`.
- [ ] `GET /me` (Bearer $T) → `is_guest: true`, username `rot_…`.
- [ ] `POST /practice/start {"mode":"starter"}` (Bearer $T) → 200, 8 trivia rounds, no
      `correctIndex` in any `client_spec`.
- [ ] `GET /brain-boost/today` (Bearer $T) → `{"completed_today":false,"has_any_check":false,...}`.
- [ ] `POST /analytics/funnel {"event":"intro_viewed"}` (NO auth) → 202.
- [ ] `POST /analytics/funnel {"event":"bogus"}` → 422 (allowlist live).
- [ ] `POST /auth/upgrade {"email":…,"password":…}` (Bearer $T) → 200; `GET /me` → `is_guest:false`;
      login with those creds → 200.

## 4. Web app smoke (fresh incognito / cleared storage)

- [ ] First open shows the **Brain Boost intro** — no login wall; "No signup needed." visible;
      "Already playing? Log in" works.
- [ ] Start Check plays 8 questions and ends on the **Brain Profile reveal** (score, Rot Type,
      sharpest/needs work).
- [ ] "Keep playing" lands on Home: Brain Boost card leads (hub-card styling, gold accent), Brain
      Profile bars render, **no Vault card** in the hub (Vault reachable via bottom nav + coins
      pill), guest save banner visible.
- [ ] Existing account login on a fresh device goes straight to Home (no first-run).

## 5. Ranked gate (the one that needs a live window)

- [ ] As a GUEST, enter and finish today's Daily Royale → the **"Your score is ready"** save gate
      appears (not the report); "Later" continues to the Rot Report.
- [ ] After the day settles (12:15 AM ET): the guest has NO standing/rating/streak change
      (`SELECT * FROM standings s JOIN users u ON u.id=s.user_id WHERE u.status='guest'` → 0 rows,
      ever).
- [ ] A guest who saved BEFORE settlement appears in standings normally.

## 6. Funnel is flowing

```sql
SELECT event, count(*) FROM funnel_events
WHERE created_at > now() - interval '1 day' GROUP BY 1;
```
- [ ] Rows appear for intro_viewed / start_check_clicked / guest_created after the web smoke.
      (Queries: docs/analytics-funnel.md.)

## 7. Regression sentinels

- [ ] `GET /contests/current` shape unchanged; today's royale window exists.
- [ ] A saved account can play practice/category/campaign/duel as before.
- [ ] `GET /personalization/me/profile` 404s in prod (debug off).
