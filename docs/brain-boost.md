# Brain Boost — anonymous-first onboarding + the daily brain dashboard

> "Rot Royale turns brain rot into brain reps."

Brain Boost is the daily ritual layer: a fast 8-question, AI-personalized check that builds a
visible **Brain Profile** (strengths, weak spots, Rot Type, Brain Score). The first-run flow has
**no signup wall** — value first, account later.

## The first-run flow

1. Anonymous visitor opens the app → **Brain Boost intro** (one CTA: Start Check; "No signup
   needed."; log-in link for returning players). `src/screens/brainboost/BrainBoostIntro.tsx`.
2. Start Check silently creates a **guest account** (`POST /auth/guest`) — a REAL fully-seeded
   user (auto username `rot_xxxxxx`, unusable random password, `status="guest"`), so every
   existing endpoint (practice, events, personalization, vault, even ranked) works immediately.
3. They play the **Starter Check**: `POST /practice/start {"mode":"starter"}` → the `starter_8`
   template (easy×3 / medium×4 / hard×1) over a category-balanced calibration bank
   (`services/practice.py::_calibration_bank`) so the first read spans categories.
4. **Brain Profile reveal** (`GET /brain-boost/{entry_id}/summary`): starter Brain Score (300–900),
   Rot Type, sharpest/needs-work categories, weak-spot topic (from AI metadata when classified;
   gracefully null otherwise), framed honestly as an "early read".
5. **Save your Brain Profile** (`POST /auth/upgrade {email, password}`): attaches credentials to
   the SAME user row and flips `status` to active — **all guest progress is retained with zero
   data migration; there is no merge step by construction.** Skippable; guests keep playing and
   Home shows a quiet save banner.

Guest sessions persist across restarts via the ordinary refresh token (30-day TTL — the natural
"save your profile" pressure). Device flag `rr.starter_check_done` (Capacitor Preferences) plus
`me.is_guest` drive the shell routing (`src/lib/firstRun.ts::resolveFirstRunStep`).

## The daily dashboard (Home)

- **BrainBoostCard** leads the screen: pending → "Today's Brain Boost · 8 questions · 2 min ·
  AI-personalized" + Start Check (routes to quick play — the Brain Boost IS quick play, reframed);
  done → today's Brain Score, movement chips ("Money +4"), the weak spot, and TRAIN WEAK SPOT
  (jumps into a category practice session for the weakest category).
- **BrainProfileCard**: thin 0–100 bars per category from the latest check.
- Daily Royale hero, Battle, Friends, Campaign, Vault all remain below — present, not shouting.

`GET /brain-boost/today` powers both cards: `{completed_today, has_any_check, latest}` where a
"check" = a submitted practice entry with `mode in ("quick","starter")` on today's **ET** date
(the app's day-boundary convention). Movement = per-category accuracy delta vs the previous
check. No LLM call anywhere in this path — pure reads over stored round results.

## Brain Score & Rot Type

`services/brain_boost.py`: `score = clamp(300 + 400·accuracy + 120·avg_speed + 15·best_streak +
5·hard_corrects, 300, 900)`. Rot Type is a deterministic nickname from the top category
(Market Menace / Sports Demon / History Menace / Geography Ghost / Space Goblin / Culture
Killer / Meme Scholar; overall accuracy < 37.5% → Money Rookie; fallback Internet Scholar).
Flavor, not a grade.

## Fairness (unchanged, protected)

Ranked Daily Royale remains globally fair: `PERSONALIZE_RANKED_DAILY=false` (default) makes the
ranked path's `personalize_bank(mode="ranked")` a hard no-op. Duels share one seeded set and are
never personalized. The Starter/Brain Boost are no-stakes practice entries — no coins, no rating,
no standings.

## Ranked permanence requires a saved profile

Guests may PLAY the Daily Royale end to end (enter, answer, live field, instant Rot Report) —
but **settlement excludes anyone still a guest**: no standing, no rating, no streak, no gems
(`services/settlement.py` filters `User.status != GUEST_STATUS`). Saving the profile before
settlement (12:15 AM ET) makes them an ordinary ranked player; after settlement there is no
retroactive inclusion — "save it before it disappears" is literally true. The frontend gate
(`RankedSaveGate`, shown when a guest finishes a ranked run) frames this as locking in earned
progress; "Later" always continues to the report. Funnel events: docs/analytics-funnel.md;
post-deploy verification: docs/deploy-checklist.md.

## Money & Business content

Seventh canonical category (`content/categories.py`), icon 💰. Reviewed seed bank:
`content/bank/money_business.json` (~26 scenario-style financial-literacy questions across Money
Basics / Investing / Business / World Economy / Scams & Street Smarts — general knowledge, never
personal financial advice). Load + classify:

```bash
cd backend
uv run python -m app.jobs.run ingest content/bank/money_business.json
uv run python -m app.jobs.run classify --limit 100   # needs ROT_AI_* creds (docs/personalization.md)
```

## Migration

`bb22cc33dd44_entries_mode` — nullable `entries.mode` ("practice"|"quick"|"category"|"starter",
NULL for ranked/duel/legacy). `uv run alembic upgrade head`.

## Known follow-ups

- Apple / Google / magic-link sign-in: no provider/email infra exists — the save screen is
  email+password styled as "saving progress". The upgrade endpoint is the seam OAuth plugs into.
- Guest username editing (auto `rot_xxxxxx` handle is permanent for now).
- Campaign world for Money & Business (category sessions already work standalone).
- Mono ("Blank") theme uses the same token-driven cards; a bespoke mono row treatment is optional
  polish.
