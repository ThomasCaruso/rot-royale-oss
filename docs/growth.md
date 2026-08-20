# Growth Over Time — the trajectory & "Your Growth" dashboard

Sub-project **B** of the "self-growth via AI" epic (A = universal evaluation, B = this, C = AI
narrative, D = Daily Royale → Brain Boost). Spec:
`docs/superpowers/specs/2026-07-04-growth-over-time-design.md`; plan:
`docs/superpowers/plans/2026-07-04-growth-over-time.md`.

Turns the per-answer signal captured in sub-project A into a day-over-day trajectory and shows it
in a "Your Growth" dashboard. Personalization/product-analytics only — never touches
scores/coins/rating/standings.

## The pipeline

1. **`user_daily_stats`** (migration `d7947da0506d`) — one row per `(user_id, ET calendar date)`:
   `answers`, `correct`, `sum_time_frac`, `best_streak`, `hard_correct`, `per_category`
   (`{category: {a, c}}`). The raw daily rollup; anything derived is computed on read.
2. **Incremental capture** — `taste_profile.record_answer_signal` (the same seam from A that fires
   at all four per-round chokepoints: practice/campaign, Daily Royale, bot duel, friend duel) now
   also calls `growth.update_daily_stats`, upserting today's row as each answer lands. The four
   chokepoints pass `difficulty=server_answer.get("difficulty")`. The ET date comes from
   `app.core.timezone.ET`. Best-effort + flush-only inside A's existing try/except — a growth-write
   bug can never sink a score write. Gated on `settings.growth_tracking_enabled` (default **true**),
   an independent flag from personalization.
3. **Shared Brain Score** — the 300–900 score maths lives in `app/services/brain_score.py`
   (`brain_score(*, accuracy, avg_time_frac, best_streak, hard_correct)`), imported by BOTH
   `brain_boost.py` and `growth.py` so there is exactly one definition.
4. **Rolling read** — `growth.get_growth(session, user_id, days, today)` computes a **trailing-7-day
   rolling** Brain Score per plotted day (so a low-volume 8-question Royale day never whipsaws the
   line), the per-category window aggregate (accuracy + per-day sparkline + up/down/flat direction),
   and consistency (days played + `profiles.streak_count`).

## API

`GET /me/growth?days=30` (`days` clamps 7–90) →
```json
{
  "brain_score": { "current": 742, "delta": 38 },
  "trend": [ { "date": "2026-06-05", "score": 704 }, ... ],
  "categories": [ { "category": "Science & Nature", "accuracy": 0.86, "spark": [...], "direction": "up" } ],
  "consistency": { "days_played": 21, "streak": 12 }
}
```
Guests included (stats keyed by `user_id`).

## Frontend

`src/screens/growth/GrowthScreen.tsx` (layout "chart-first + per-category grid"): a Brain Score trend
line (lightweight SVG, reduced-motion aware) + per-category mini-cards (accuracy + ▲/▼/– direction)
+ a consistency line. Cold state (`days_played < 7`) shows a "keep playing to build your trend"
prompt instead of a misleading chart. Data via `api.getGrowth(days)`. Copy is §7-safe; i18n group
`growth` mirrored across en/es/tr.

**Home entry point:** the "Your Growth" entry **replaces the Campaign pill** on Home (the hub-list
row directly under Friends; arcade tile likewise). Campaign is **not orphaned** — it stays reachable
via the nav (`AppNav` + Home's `BottomNav` Campaign tab).

## Config

| Var | Default | Meaning |
|---|---|---|
| `growth_tracking_enabled` | `true` | master switch for daily-stats capture (independent of personalization) |

## Key files

Backend: `app/services/brain_score.py`, `app/services/growth.py`, `app/models/personalization.py`
(`UserDailyStats`), `app/schemas/growth.py`, `GET /me/growth` in `app/api/me.py`, capture hook in
`app/services/taste_profile.py`, migration `alembic/versions/d7947da0506d_user_daily_stats.py`.
Frontend: `src/screens/growth/GrowthScreen.tsx`, `api.getGrowth` in `src/api/client.ts`, Home/tiles
swap in `src/screens/Home.tsx` + `src/screens/home/HubTiles.tsx`, growth flow in `src/app/App.tsx`,
i18n `growth` group.
