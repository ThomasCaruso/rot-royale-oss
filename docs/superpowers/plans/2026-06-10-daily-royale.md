# Daily Royale — Implementation Plan (one ranked event/day, replacing 3 windows)

Branch: `feat/daily-royale` (off main). Approved by the user 2026-06-10 with three corrections (below).
Phase-by-phase, tests after each phase. No push/merge without the user asking. PLAN.md/CLAUDE.md
conventions; subagent-driven with two-stage review per phase.

## Product spec (locked)
- ONE ranked **Daily Royale** per ET date. Opens **8:00 AM ET**, closes **8:00 PM ET** (a **12-hour**
  window — never say "13-hour"), results settle **8:15 PM ET**.
- One attempt/user/day, one field, one leaderboard, one reveal, one daily rank/rating/division impact.
- **No ranked coin payouts** (all coin constants stay 0; settlement writes no ledger rows).
- Campaign = solo progression/coins/cosmetic unlocks (untouched). Vault = cosmetics/identity (untouched).
  Battle Mode later.
- Format V1: **flat 20 trivia questions**, trivia-only, no mini-games, no difficulty ramp, no
  final-question weighting. Frontend round-framing only: **Opening Round / Pressure Round / Crown Climb
  / Final Crown Round** (5 questions each). The streak multiplier provides the emergent climax.
- Copy: Daily Royale, Today's Royale, Enter Daily Royale, Score Locked, Field Closing/Closed, Results
  Settling, Results Ready, Reveal Your Standing. Banned: cash/prize/bet/wager/jackpot/gambling/casino,
  and no fake-human "players" (field includes bots → use "field").

## Three locked corrections
1. **Do NOT relabel historical Morning/Midday/Night results as Daily Royale.** Old slots display as
   "Legacy Morning Game" / "Legacy Midday Game" / "Legacy Night Game"; unknown slot → "Past Ranked
   Game". "Daily Royale" describes only the new `royale` slot going forward.
2. **Remove morning/midday/night from FUTURE SCHEDULING ONLY.** Keep legacy slot
   display/parsing/computation so old history, results, tests, and admin/debug don't break. Split the
   slot definitions: a full computation map (legacy + royale) vs a provisioning list (royale only).
3. **Tighten settlement to ~8:15, not ~8:18.** Robust heartbeat PLUS a targeted 8:15-PM-ET settle.
   Lazy settlement still not allowed.

## Internal naming
- New slot id: `"royale"`. Template id: `"dr_20_trivia"`.
- Settlement delay constant: `SETTLE_DELAY_MINUTES = 15`. `settle_at` = `close_at + 15min` (derived).

---

## Current architecture (verified)
- Slots: `app/core/timezone.py:21-25` `WINDOW_SLOTS` (morning/midday/night ET times). `window_bounds_utc`
  computes UTC from ET via zoneinfo (DST-correct, night crosses midnight).
- Templates: `app/services/templates.py:39-121` MORNING/MIDDAY/NIGHT = 7 rounds each; `SLOT_TEMPLATES`
  maps slot→template id. PRACTICE(5), CATEGORY_SESSION(10).
- Window model: `app/models/contest.py:42-59` (slot, open_at, close_at, state, template_id, settled_at;
  `UNIQUE(contest_date, slot)`).
- Provisioning: `app/services/scheduler.py:23-56` `create_windows_for_date` loops `for slot in
  WINDOW_SLOTS`; `ensure_upcoming_windows` (today+tomorrow).
- Transitions: `scheduler.py:59-78` `transition_windows(now)`; lazy-on-read in `app/api/contests.py:41-46`.
- Cron/daemon: `app/jobs/daemon.py` `_tick` every `scheduler_tick_seconds`(60): transitions + settle +
  notify; 00:30-ET provision cron. `app/jobs/run.py` subcommands create/transition/settle/both.
  `app/jobs/tasks.py` `settle_due_windows` selects CLOSED ordered by (contest_date, open_at).
  `render.yaml` cron `*/3 * * * *` runs `both` with `scheduler_enabled=false` on web.
- Settlement: `app/services/settlement.py:92-176` `settle_window`: FOR UPDATE, acts only if
  `state==CLOSED` (exactly-once), never commits, ranks, ZERO coins, Elo (RATING_K=64), division, daily
  streak keyed off `contest_date` (`next_streak`), Standing rows. **No time gate today.**
- Bots: `app/services/bots.py` `_window_seed = contest_date.toordinal()*31 + sum(ord(c) for c in slot)`,
  pad to MIN_FIELD_SIZE=8, in-memory only.
- Entry/one-attempt: `app/services/contest.py:101-157` enter (state==OPEN, `uq_entry_window_user`), submit
  (`:160-212`, status IN_PROGRESS, window OPEN & close_at>now), seed fixed at creation.
- Scoring: `app/services/scoring.py` `points = correct ? round((100+time_frac*60)*(1+min(streak,5)*0.12))
  : 0`. No round-count coupling. 20-round max ≈ 4,900, unbounded by schema. engine `_MAX_REROLLS=25`.
- API: `app/api/contests.py` current/field/standings/enter/submit; `app/schemas/contest.py` WindowOut(slot),
  RoundSpecOut, CurrentContestResponse, FieldEntryOut, EnterResponse, SubmitResponse, HistoryItem(slot),
  StandingOut. `app/api/me.py:146-181` history (joins Entry+Window+Standing, carries slot).
- Live ranked bank = `content/bank/*.json` (6×100 ≈ 600 approved, ingested at deploy). `fetch_bank("trivia")`
  serves `status in (approved, live)`, no category filter → mixed. 20 distinct draws are safe.

---

## Phase 1 — Backend: single-window provisioning + 20-trivia template + legacy preservation
Files:
- `app/core/timezone.py`: Keep a FULL computation map including legacy + royale, and add a provisioning
  list. Concretely:
  - `WINDOW_SLOTS` stays the full map for `window_bounds_utc`/legacy parsing, ADD
    `"royale": (time(8,0), time(20,0), False)`. (Legacy entries remain so old data/tests compute.)
  - Add `PROVISIONED_SLOTS: tuple[str, ...] = ("royale",)` — the only slot created going forward.
- `app/services/scheduler.py`: `create_windows_for_date` loops `PROVISIONED_SLOTS` (not all of
  WINDOW_SLOTS). Update the "three windows" comments to singular.
- `app/services/templates.py`: add `DAILY_ROYALE = ContestTemplate("dr_20_trivia", tuple(_t("trivia")
  for _ in range(20)))`. `SLOT_TEMPLATES` gains `"royale": DAILY_ROYALE.id`. KEEP MORNING/MIDDAY/NIGHT
  defs + their SLOT_TEMPLATES entries (legacy: harmless, never provisioned now — preserves template
  lookup for any historical reconstruction and keeps legacy template tests meaningful).
- `app/models/contest.py:48`: update slot comment → `# 'royale' going forward; legacy: morning|midday|night`.
- Phase-0 verification inside this phase: confirm `fetch_bank("trivia")` count (~600) in a test/log; if
  it's the 40-row legacy seed in dev, ensure the ranked test uses an adequate bank (the dedup at 20 from
  a thin bank must still succeed — `_MAX_REROLLS` allows accepting a duplicate after 25 tries, so it
  never errors; but assert no crash and 20 rounds built).
Tests (`tests/test_scheduler.py`, `tests/test_templates.py`, new `tests/test_daily_royale.py`):
- `create_windows_for_date` creates exactly ONE window/date with slot `"royale"`, opens 8AM ET / closes
  8PM ET (assert UTC instants in EDT and EST).
- `window_bounds_utc(date, "morning"/"midday"/"night")` STILL computes the legacy instants (legacy
  parsing preserved) — keep/repoint the existing legacy bounds tests.
- `DAILY_ROYALE` has 20 trivia rounds; `build_round_set` produces 20 rounds from the bank without error;
  scoring an all-correct 20-round entry yields the expected max-ish score (no round-count assumption).
- Update `test_templates.py`: SLOT_TEMPLATES now includes "royale"; drop/replace the "exactly 3 distinct
  compositions" assertion with one that asserts royale is 20× trivia and legacy slots still resolve.
Commit: `feat(royale): provision one Daily Royale/day with a 20-trivia template; preserve legacy slots`.

## Phase 2 — Backend: settlement timing (8:15) + targeted scheduling + data tidy
Files:
- `app/core/constants.py`: `SETTLE_DELAY_MINUTES = 15`.
- `app/jobs/tasks.py` `settle_due_windows(session, now=...)`: gate selection on `close_at <= now -
  timedelta(minutes=SETTLE_DELAY_MINUTES)` (i.e., settle only when `now >= settle_at`). Keep the
  CLOSED-state filter, the (contest_date, open_at) ordering, exactly-once, never-commit. Thread `now`
  from the daemon and the one-shot runner (default `datetime.now(UTC)`).
- `app/jobs/daemon.py`: keep the 60s `_tick` (transitions + gated settle + notify). ADD a DST-correct
  targeted settle: `CronTrigger(hour=20, minute=15, timezone=ET)` job that runs the gated settle (belt
  + suspenders with the 60s tick). Provisioning cron unchanged.
- `app/schemas/contest.py` + `app/api/contests.py`: add `settle_at: datetime` to `WindowOut` (= close_at
  + SETTLE_DELAY). current-contest response carries it.
- `render.yaml`: keep the heartbeat cron (relax to `*/2 * * * *` or keep `*/3`) running `both` AS
  FALLBACK; ADD a targeted settle cron `rot-royale-settle` schedule `15 0,1 * * *` (00:15 + 01:15 UTC =
  8:15 PM ET in EDT/EST respectively; the gate makes exactly the DST-correct one effective) running
  `both`. This nails 8:15 ET DST-correctly without lazy settlement.
- Data tidy: new Alembic data migration (or a `jobs` command) deleting ONLY future, SCHEDULED,
  zero-entry morning/midday/night windows (never CLOSED/SETTLED, never any with entries). Idempotent;
  no-op downgrade (rollback re-enables old provisioning, which is fine).
Tests (`tests/test_settlement.py`, `tests/test_daily_royale.py`):
- A window CLOSED at 8:05 PM ET is NOT settled (gate); after 8:15 PM ET it settles.
- `settle_at` exposed = close_at + 15min; EDT and EST instants asserted.
- Exactly-once across two settle passes; no ledger rows (coins still 0); streak per contest_date.
- Data-tidy removes a future SCHEDULED zero-entry "night" window but leaves a SETTLED one and one with
  an entry untouched.
Commit: `feat(royale): settle at 8:15 PM ET via gated + targeted scheduling; tidy future legacy windows`.

## Phase 3 — Frontend: Home Daily Royale state machine + i18n (incl. legacy labels)
Files: `src/screens/Home.tsx` + `src/screens/home/HeroCard.tsx` (states A–F), `src/lib/home.ts`
(`slotTitle`: royale→"Daily Royale", morning/midday/night→"Legacy * Game", else "Past Ranked Game"),
`src/api/client.ts` (WindowOut += settle_at), `src/i18n/{en,es,tr}.ts` (Daily Royale vocabulary +
legacy labels; keep parity + copy-guard), `ResultStrip.tsx` (legacy-aware label), tests.
Home states from the royale window state + settle_at + the user's entry/result:
- A before open (no open window, next royale scheduled): "Today's Royale unlocks at 8:00 AM ET" + countdown.
- B live, not entered (OPEN): hero "Enter Daily Royale" · "One attempt. One field. Results at 8:15 PM
  ET." · field count · countdown to close.
- C submitted (OPEN, entered): "Score Locked" + score + provisional placement + "The field is still
  moving" + countdown to close.
- D closed, settling (CLOSED, < settle_at): "Field closed" / "Results settling" + countdown to settle_at.
- E results ready (SETTLED, unseen result): "Results Ready" + "Reveal Your Standing".
- F result viewed: summary + countdown to tomorrow's open.
Campaign/Vault cards secondary. Tests: each state renders from mocked data; legacy slot title mapping.
Commit: `feat(royale): Home Daily Royale state machine and copy`.

## Phase 4 — Frontend: result reveal adaptation
Files: `src/screens/results/RoyaleResultsModal.tsx`, `src/lib/results.ts` (`gameTitle`: royale→"Daily
Royale", legacy→"Legacy * Game"), i18n. Show: Daily Royale date/number, placement, field size,
percentile/top%, score, correct count, rating movement, division, streak, near-miss ("X points from Top
N") only when field data supports it, tomorrow unlock time. No fabricated stats. Old results show their
legacy label truthfully. Tests + share-text fixtures updated.
Commit: `feat(royale): result reveal for the Daily Royale (legacy-aware)`.

## Phase 5 — Frontend: leaderboard + run-screen round framing
Files: `src/screens/leaderboard/*` (Today's Royale tab label, provisional vs final, empty state, Global
fallback; no "players"), `src/screens/Contest.tsx` (replace 20-dot progress with round-segmented
progress: "Round X of 4 · Q Y of 5"; round-banner interstitials Opening/Pressure/Crown Climb/Final Crown
Round; "Score Locked / Results at 8:15 PM ET"), i18n, tests.
Commit: `feat(royale): daily leaderboard labels and 20-question round framing`.

## Phase 6 — Docs + full verification
Rewrite PLAN.md §4/5/6/9/10, CLAUDE.md §5/5a/6, DESIGN.md §4 to the Daily Royale model (note legacy slots
preserved for history). Full backend (ruff/mypy/pytest) + frontend (typecheck/lint/vitest/build, no
phaser chunk) verification. Final whole-branch review.
Commit: `docs(royale): rewrite contest spec for Daily Royale`.

## Phase 7 — Deploy runbook (no deploy executed)
Write a deploy runbook: overnight dark-hour deploy (before 8AM ET), DB snapshot, run migrations
(includes data tidy), verify 8:00 open / 8:00 close / 8:15 settle on day one, monitor. Then
finishing-a-development-branch (present merge options; do not push/merge without the user).

## Acceptance criteria
1. No new morning/midday/night windows created; exactly one royale window/ET date.
2. Opens 8:00 AM ET, closes 8:00 PM ET (12-hour; never "13-hour").
3. Settles after 8:15 PM ET, scheduled (targeted + heartbeat), exactly-once, never lazy, never double-pay.
4. One ranked attempt/user/day; second → clean 409.
5. Home shows states A–F clearly; submitted users see Score Locked + provisional + "field moving".
6. Result reveal works post-settlement; legacy results show "Legacy * Game" / "Past Ranked Game" truthfully.
7. Leaderboard works for the daily field; provisional vs final labels; no banned/"players" language.
8. Campaign + Vault + identity untouched; no ranked coins (zero ledger rows).
9. 20-question run plays and scores correctly; historical results still render.
10. Legacy slot computation/parsing preserved (old data/tests/admin unaffected).
11. All backend + frontend tests, typecheck, lint, build green; no phaser chunk.
