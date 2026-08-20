# Growth Over Time — the trajectory & "Your Growth" dashboard (Sub-project B)

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation plan
**Epic:** "Self-growth via AI" — Daily Royale eventually becomes the daily Rot Check.
**Depends on:** Sub-project A (Universal Evaluation) — every mode now records a server-authoritative
answer signal via `taste_profile.record_answer_signal`. Spec:
`docs/superpowers/specs/2026-07-04-universal-evaluation-design.md`.

## Where this sits in the epic

- A — Universal evaluation (DONE): every mode feeds one brain model.
- **B — Growth over time (THIS SPEC):** turn the current-state signal into a day-over-day
  trajectory and show it in a "Your Growth" dashboard.
- C — AI growth narrative: a batch LLM turns the trajectory into human-readable insight.
- D — Daily Royale → Rot Check: the premium product reframe (home restructure, quests).

## Locked decisions (from brainstorming)

1. **Metric:** a headline **Rot Score** trajectory (the existing 300–900 score, now computed from
   ALL play, not just checks) **plus** a per-category strengths breakdown that trends over time.
2. **Storage:** an **incremental daily snapshot** table, upserted by the SAME capture seam from A
   (`record_answer_signal`). Always current (today's progress updates the instant you play), cheap
   historical reads, no separate rollup job.
3. **Scope:** the growth **data layer + one "Your Growth" dashboard** (layout "B — chart-first +
   per-category grid", chosen from mockups). The premium reframe stays in D.
4. **Smoothing:** the plotted Rot Score is a **trailing-7-day rolling** value, so low-volume days
   (the Royale is 8 questions) never whipsaw the line. Each daily snapshot still stores that day's
   raw components; smoothing is computed from them on read.
5. **Home entry point:** the "Your Growth" entry **replaces the Campaign pill** on Home (the row
   directly under Friends). Campaign is **not orphaned** — it remains reachable via the nav menu
   (`AppNav`, which already carries `onCampaign`), the menu between Home and Play. So Home simply
   swaps that one pill; Campaign keeps its menu entry.

## 1. Data model — `user_daily_stats` (new table, Alembic migration)

Composite PK `(user_id, stat_date)`. `stat_date` is the **ET calendar date** (America/New_York,
the same day-boundary used for streaks/contests — via the existing `app/core/timezone.py` helper),
so a day's play always lands in the right bucket regardless of the server's UTC clock.

| Column | Type | Meaning |
|---|---|---|
| `user_id` | UUID FK users(id) ON DELETE CASCADE, PK | owner |
| `stat_date` | Date, PK | ET calendar date |
| `answers` | int, default 0 | answers that day (all modes) |
| `correct` | int, default 0 | correct answers that day |
| `sum_time_frac` | float, default 0 | Σ time_frac (avg speed = `sum_time_frac/answers`) |
| `best_streak` | int, default 0 | max `streak_after` seen that day |
| `hard_correct` | int, default 0 | correct answers on `difficulty == "hard"` questions |
| `per_category` | JSONB, default `{}` | `{category: {"a": answers, "c": correct}}` |
| `created_at`, `updated_at` | timestamptz | |

This is the raw daily rollup — enough to recompute any smoothed/derived metric; nothing derived is
stored redundantly. JSONB is REASSIGNED, never mutated in place (repo convention).

## 2. Capture — extends A's seam, no new chokepoints

`taste_profile.record_answer_signal(...)` gains one optional parameter `difficulty: str | None =
None`. The four existing call sites pass it from the stored server answer they already hold:
- practice / contest / bot-duel: `answer.server_answer.get("difficulty")`
- friend-duel: `answer_row["server_answer"].get("difficulty")`

After `record_answer_signal` records the taste event, it calls a new
`growth.update_daily_stats(session, user_id, *, is_correct, time_frac, streak_after, difficulty,
category)` which **upserts today's `user_daily_stats` row** (increment `answers`, `correct` if
correct, add `time_frac`, `best_streak = max(best_streak, streak_after)`, `hard_correct += 1` when
`difficulty == "hard" and correct`, merge `per_category[category]`). `category` is resolved the same
way the taste path resolves it — from the question's AI metadata / bank category via the already-fetched
`question_id` (None when the round has no bank question, e.g. generated modules; such answers still
count in the totals, just not in `per_category`).

The daily-stats update is wrapped in the SAME best-effort try/except and `flush`-only (never commits)
posture as the taste update — a growth-write bug can never sink a score write. It is gated on a new
`settings.growth_tracking_enabled` (default **true**) so the growth feature is independent of the
personalization flag (growth is core product, not personalization).

**All the growth logic (upsert, aggregation, scoring reads) lives in one new file
`app/services/growth.py`.** The four chokepoints change only to pass one extra value.

## 3. The Rot Score — shared definition, rolling window

`rot_check.py` currently owns the pure scoring maths inline (`_score(accuracy, avg_time_frac,
best_streak, hard_correct)` = `clamp(300 + accuracy*400 + avg_time_frac*120 +
best_streak*STREAK_WEIGHT + hard_correct*5, 300, 900)`, plus `rot_type_for`). Extract these pure
functions into a new `app/services/rot_score.py` (`rot_score(...)`, `rot_type_for(...)`, and the
weight constants). `rot_check.py` imports them (behaviour unchanged — the existing rot-check tests
must stay green as a parity guard); `growth.py` imports the same. **One definition of the Rot Score.**

The plotted trend is a **trailing-7-day rolling Rot Score**: for each day D in the window, aggregate
the components of days `[D-6 … D]` (sum answers/correct/sum_time_frac/hard_correct; `best_streak` =
max over the window) and compute `rot_score(...)` from that aggregate. The headline is the latest
rolling value; the **delta** is latest minus the rolling value 7 days earlier.

## 4. Read API — `GET /me/growth?days=30`

`days` clamps to a sane range (e.g. 7…90, default 30). Returns:

```json
{
  "rot_score": { "current": 742, "delta": 38 },
  "trend": [ { "date": "2026-06-05", "score": 704 }, ... ],
  "categories": [
    { "category": "Science & Nature", "accuracy": 0.86, "spark": [0.7,0.75,...], "direction": "up" }
  ],
  "consistency": { "days_played": 21, "streak": 12 }
}
```

- `trend`: the rolling-7-day series over the window.
- `categories`: one per category the user has played in the window, sorted strongest→weakest by
  windowed accuracy. `spark` = that category's per-day accuracy across the window (for the mini
  sparkline). `direction` ∈ `up|down|flat` compares the recent half vs the earlier half of the
  window (a small dead-band → `flat`).
- `consistency.days_played` = snapshot rows in the window; `streak` = `profiles.streak_count`.
- Guests included (stats keyed by `user_id`).

## 5. Frontend — the "Your Growth" screen (layout B)

New screen `src/screens/growth/GrowthScreen.tsx` (+ small presentational pieces):
- **Rot Score trend** tile: current score + ▲/▼ delta, and a lightweight **SVG line chart** of the
  rolling trend. `prefers-reduced-motion` aware (no draw animation under reduced motion).
- **Per-category grid**: mini-cards, each accuracy% + a tiny SVG sparkline + a ▲/▼/– direction chip.
- **Consistency line**: `days_played` + current streak (small footer).
- Cream/mono aesthetic, existing UI primitives (`GlassCard`, `Display`, tokens). No new deps.
- **Cold state** (`days_played < 7` or trend too short): render what exists + a calm "Keep playing
  to build your trend" prompt instead of a misleading flat/empty chart.

Data via a typed `api.getGrowth(days)` + a TanStack Query hook (`useGrowth`).

**Home wiring:** the Campaign entry on Home is replaced by a "Your Growth" entry in the same slot
(directly under Friends):
- Mono home (`MonoHubList`): the `campaign` row becomes a `growth` row → order `[Daily Royale/Battle,
  Rot Check, Friends, Your Growth]`.
- Arcade home (`HubTiles`): the Campaign tile becomes the "Your Growth" tile.
Opening it routes to `GrowthScreen` (App-level overlay/flow, mirroring how Friends/Vault open).
i18n: add a `growth` string group (en/es/tr mirror), copy-safe (§7 — no cash/bet/casino language;
"field"/"progress"/"streak" framing).

## 6. Scope guardrail (what B does NOT do)

No coins/rating/scoring/standings changes. No LLM (that's C). No premium Daily-Royale→Rot-Check
reframe, home restructure beyond the single pill swap, or quests (that's D). Campaign is untouched
apart from losing its Home pill (it keeps its `AppNav` menu entry).

## 7. Testing

**Backend:**
- `update_daily_stats` upserts and accumulates across multiple answers the same ET day (answers,
  correct, sum_time_frac, best_streak = max, hard_correct, per_category merge).
- ET day-boundary bucketing (an answer's `stat_date` is its ET date).
- Rolling-7-day Rot Score aggregation is correct and smooth on a low-volume day.
- Shared `rot_score.rot_score(...)` returns the same value the old inline rot-check maths did
  (parity — existing rot_check tests stay green).
- Guests accumulate `user_daily_stats`.
- `GET /me/growth` returns the documented shape; cold state (1–2 days) doesn't error; `days` clamps.
- Growth capture is best-effort (a forced failure in `update_daily_stats` doesn't fail the score
  write) and gated off cleanly when `growth_tracking_enabled=false`.

**Frontend:**
- `GrowthScreen` renders trend + category grid from a mocked `getGrowth` response.
- Cold state renders the "keep playing" prompt, not a broken chart.
- Reduced-motion: no chart draw animation.
- Home shows the "Your Growth" entry in the Campaign slot (under Friends) and no Campaign pill;
  clicking routes to the growth flow. Existing Home tests updated for the swapped entry.

## 8. Risks

- **Per-answer write cost:** each answer now also upserts a daily-stats row (read-modify-write the
  `per_category` JSONB). Acceptable at v1 scale and best-effort; if it ever bites, the upsert can be
  batched at entry-submit rather than per-round. Logged, not silently dropped.
- **Category attribution needs `question_id`:** generated-module rounds (rapid_math/memory_flash)
  have none → they count in totals but not `per_category`. Correct and intended; documented.
- **Difficulty source:** relies on `server_answer["difficulty"]` being present (it is, per
  `rot_check.summarize_check`); when absent, `hard_correct` simply isn't incremented for that answer.
