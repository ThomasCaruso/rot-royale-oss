# Rot Royale — Build Plan & Architecture Spec

> **Purpose of this document.** This is the build brief for Claude Code. It defines the
> product scope, stack, data model, the contest engine, the round-module plugin system, the
> windowed-async schedule, scoring/settlement, anti-cheat, and an ordered milestone plan.
> Build in the milestone order in §12. Do not over-build past v1 scope (§13).

---

## 1. Product summary

Rot Royale is a **windowed-async skill-contest game**. Players compete in **one scheduled daily
contest — the Daily Royale** — by playing one run anytime inside its time window (a full 24-hour
day, midnight-to-midnight ET — no time limit); they're scored against everyone else who played that
same window. The plugin architecture is
**not only trivia** — a contest is a sequence of *round modules* (trivia, rapid math, memory, and
casual **mini-games**) — though the v1 Daily Royale is a flat 8-trivia event. There is a persistent
**hub** the player returns to between contests.

**v1 is currency-only.** Players win **coins** (an in-app, closed-loop currency: earned in-game
only, never purchasable, never cashable, no peer transfer). Coins are spent on **cosmetic themes**.
There is **no real money, no payments, no gambling mechanic** in v1. This keeps v1 out of all
gaming-regulation scope; the architecture must keep money cleanly addable later (see the
`coin_ledger` design in §6) without rework.

**Engagement model:** retention comes from *skill + habit*, not screen time. Daily streak
(played the Daily Royale that calendar day), a ranked ladder (rating/divisions earned by placing
well — **ranked pays no coins**), and an optional practice/campaign mode (campaign is the primary
coin source). Do not build mechanics where raw time-on-app improves competitive outcomes.

### Core loop
1. Open app → land in the **hub** (room/board with coins, streak, rating, equipped theme).
2. If the Daily Royale window is **open**, tap to enter the live contest.
3. Play the seeded run (8 trivia rounds, each with a category splash then the round; presented as
   four round-blocks — Opening / Pressure / Crown Climb / Final Crown).
4. Submit → see provisional score. Final placement + rating/streak changes are applied at
   **12:15 AM ET the next day** (settlement, 15 min after the midnight close), then surfaced next
   time the player opens the app.
5. Spend coins on themes in the **store**; equip art styles.

The downloaded `RotRoyale.jsx` is the **frontend feel reference** (theme system, scoring weights,
round types, category splash, look). Port from it — do not redesign from scratch. Its theme
object schema (`{ id, name, cost, style, blurb, vars }`) and the three art styles (`soft`,
`pixel`, `mono`) are the source of truth for theming.

---

## 2. Tech stack

**Client (mobile + web), one codebase:**
- **Vite + React + TypeScript** SPA for the app shell (chosen over Next.js: cleaner Capacitor
  fit for a wrapped mobile game; Next familiarity transfers directly).
- **Phaser 3** for the hub scene and all interactive/mini-game round modules (purpose-built for
  2D casual game content).
- **Capacitor** to wrap the SPA into native iOS/Android builds (App Store + Play Store) and for
  push notifications.
- **TanStack Query** for server state, **Zustand** (or React context) for local UI/session state.
- React DOM for menus/lobby/store/results; Phaser canvas mounted for the hub and mini-games.

**Backend:**
- **FastAPI (async) + PostgreSQL**, deployed on **Render** (same muscle memory as Nova).
- **JWT auth** (access + refresh), cookie or secure-storage token handling.
- **APScheduler** (or Render cron jobs) for the window scheduler and settlement jobs.
- **SQLAlchemy 2.x async** + Alembic migrations. All schema changes via migrations only.
- Server-authoritative scoring (§5). Server is the source of truth for content answers, scores,
  coins, rating, and standings.

**Marketing/landing site:** out of v1 scope; can be a separate Next.js project later.

---

## 3. Repository structure (monorepo)

```
rot-royale/
├── PLAN.md                      # this file
├── CLAUDE.md                    # repo conventions for Claude Code (create in M0)
├── RotRoyale.jsx                # frontend feel reference (do not ship as-is)
├── frontend/
│   ├── src/
│   │   ├── app/                 # shell, routing, layout
│   │   ├── screens/             # lobby, contest, results, store, hub, auth
│   │   ├── modules/             # ROUND MODULES (client side) — one folder per type
│   │   │   ├── registry.ts      # maps module type -> client component
│   │   │   ├── trivia/
│   │   │   ├── rapidMath/
│   │   │   ├── memoryFlash/
│   │   │   └── ...minigames
│   │   ├── game/                # Phaser: hub scene, shared game utils
│   │   ├── theme/               # theme tokens + art-style system (ported from RotRoyale.jsx)
│   │   ├── api/                 # typed API client, TanStack Query hooks
│   │   └── store/               # local state
│   ├── capacitor.config.ts
│   └── vite.config.ts
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── core/                # config, security/jwt, db session, timezone helpers
│   │   ├── models/              # SQLAlchemy models
│   │   ├── schemas/             # Pydantic
│   │   ├── api/                 # routers (auth, contests, entries, profile, store)
│   │   ├── modules/             # ROUND MODULES (server side) — generate + score
│   │   │   ├── registry.py      # maps module type -> server module
│   │   │   ├── trivia.py
│   │   │   ├── rapid_math.py
│   │   │   ├── memory_flash.py
│   │   │   └── ...minigames
│   │   ├── services/            # contest engine, scoring, settlement, scheduler
│   │   └── jobs/                # scheduler entrypoints, settlement worker
│   ├── alembic/
│   └── content/                 # seed question banks (JSON/CSV) + loader
└── docker-compose.yml           # local Postgres
```

---

## 4. Contest model & window state machine

### The Daily Royale window (America/New_York)
**One ranked contest per ET date** — the **Daily Royale**. Times are wall-clock **Eastern Time**.

| Slot   | Opens (ET)      | Closes (ET)           | Settles (ET)          |
|--------|-----------------|-----------------------|-----------------------|
| royale | 12:00 AM (open) | 12:00 AM the next day | 12:15 AM the next day |

A full **24-hour window** — no time limit, open all day, midnight-to-midnight ET; a player takes
their one run anytime that ET date. Results settle 15 minutes after the midnight close
(`settle_at = close_at + SETTLE_DELAY_MINUTES` → 12:15 AM the next day). On a DST-change date the
window spans 23h (spring forward) or 25h (fall back) of wall-clock. Exactly **one** window with slot
`"royale"` is provisioned per ET calendar date.

> **Legacy slots preserved (history only).** The old `morning` / `midday` / `night` slots remain in
> the slot computation map (`WINDOW_SLOTS`) so historical windows, results, admin/debug, and legacy
> tests still compute their correct UTC instants — but they are **never provisioned going forward**.
> `PROVISIONED_SLOTS = ("royale",)` is the only slot created. UI labels old slots truthfully as
> "Legacy Morning/Midday/Night Game" (unknown slot → "Past Ranked Game"); "Daily Royale" describes
> only the new `royale` slot.

> **CRITICAL — DST.** Define and compute all window times in the `America/New_York` timezone
> using Python `zoneinfo` (`ZoneInfo("America/New_York")`). **Never** hardcode a UTC offset like
> `-05:00`; ET shifts to `-04:00` half the year and a fixed offset will silently move every
> window by an hour for ~8 months. Store window open/close as UTC `timestamptz` in the DB,
> *computed from* the ET wall-clock definition for each calendar date.

### Rules
- **One entry per user per window.** A user may play a given window's contest exactly once.
- **Seeded pool — shared for the ranked Daily Royale, per-player everywhere else.** Each round set
  is drawn deterministically from a larger bank. The **Daily Royale uses a shared per-window seed**
  (`contest_date` + slot), so *every* player that day gets the **same questions + option order**
  (Wordle-style) and the leaderboard/"beat my score" share are directly comparable. This trades away
  the old per-entry anti-cheat property for the Daily Royale (same-for-all is leakable within the 24h
  window — acceptable: currency-only, server-validated, answers never leave the server). **Practice,
  category sessions, campaign, and duels keep per-run seeds** (not leaderboard-comparable → variety
  is fine).
- **Streak** increments when a user completes ≥1 window's contest on a given calendar day (ET).
- **Settlement at close:** placements, coins, rating deltas, and streaks are finalized when the
  window closes — not at submit time — because the field isn't complete until then.

### Window lifecycle (state machine)
```
SCHEDULED ──(open_at reached)──▶ OPEN ──(close_at reached)──▶ CLOSED ──(settle job)──▶ SETTLED
```
- **SCHEDULED**: row exists, not yet playable.
- **OPEN**: accepting entries/submissions.
- **CLOSED**: no new entries; awaiting settlement.
- **SETTLED**: standings computed, payouts/rating/streaks applied, immutable.

A daily scheduler job creates the next day's single `royale` `SCHEDULED` row. A settlement job
gated to `settle_at` (12:15 AM ET) transitions `CLOSED → SETTLED`; settlement is never lazy/on-read
(see §9).

---

## 5. Round-module plugin system  ← core architecture

A contest is an **ordered list of round modules**. "More than trivia" works by making every game
mode a module implementing one interface. **Adding a game mode = adding a module; the contest
engine is never touched.** Same philosophy as the theme system.

### The anti-cheat split: `client_spec` vs `server_answer`
`generate()` produces **two** objects:
- `client_spec` — sent to the client. For trivia/math this contains the prompt and options but
  **never the correct answer**. For mini-games it's the setup/seed.
- `server_answer` — stored server-side only, used to score. Never sent to the client.

The client submits a **result**; the server scores it against the stored `server_answer`.

### Server interface (Python)
```python
# backend/app/modules/base.py
from typing import Protocol, Any
from random import Random

class RoundModule(Protocol):
    type: str  # e.g. "trivia", "rapid_math", "memory_flash"

    def generate(self, rng: Random, difficulty: int) -> tuple[dict, dict]:
        """Return (client_spec, server_answer). client_spec must NOT leak answers."""

    def score(self, server_answer: dict, submission: dict) -> "RoundScore":
        """Validate submission against server_answer; return points + validity."""

# RoundScore: { points: int, correct: bool, time_frac: float, valid: bool, flags: list[str] }
```

### Client interface (TypeScript)
```ts
// frontend/src/modules/types.ts
export interface RoundModule<Spec = unknown, Result = unknown> {
  type: string;
  /** plays the round; calls onComplete with the result to submit */
  Component: React.FC<{ spec: Spec; onComplete: (result: Result) => void }>;
  /** "dom" for React-rendered rounds, "phaser" for canvas mini-games */
  surface: "dom" | "phaser";
}
```

Both sides register in a `registry` keyed by `type`. The contest engine iterates the round list,
looks up the module by `type`, renders/plays it, collects results, and submits.

### v1 modules
- **trivia** — content-backed MC drawn from the questions bank; `client_spec` = {prompt, options,
  category, icon}; `server_answer` = {correctIndex, question_id, difficulty}.
- **rapid_math** — generated arithmetic MC; multi-digit and precedence-bearing two-operator
  expressions, bounded for ~9s mental math; same shape.
- **memory_flash** — Simon-style sequence; `client_spec` = {sequence shown to player via spec},
  `server_answer` = {sequence}; submission = tapped sequence + per-tap timestamps.

  The ranked **Daily Royale is trivia-only** (8 trivia rounds); `rapid_math` and `memory_flash`
  remain registered modules used by legacy/practice templates, and the plugin system still supports
  mixing them. (Earlier minigames were retired: `tap_target` (Phaser reaction game — untestable
  real-time hit-detection) and later `pattern_sequence` / `odd_one_out` (visual rounds testers found
  incoherent/too-easy). None remain in the codebase. Phaser stays only as scaffolding for the planned
  hub scene, §10.)

See **§6** for the category/content/ingestion system (categories, difficulty, status, explanation).

### Scoring weights (port from reference)
`points = correct ? round((100 + speed_frac*60) * (1 + min(streak,5)*0.12)) : 0`, streak = consecutive
correct **within the contest**. Keep this in one server-side place; client may show a provisional
mirror but server score is canonical.

### Contest templates
A `contest_template` defines a window's round composition. The ranked **Daily Royale** uses one
template (`dr_8_trivia`): a **flat 8 trivia rounds** — trivia-only, no mini-games, no difficulty
ramp, no final-question weighting. The frontend presents these as four round-blocks (Opening Round /
Pressure Round / Crown Climb / Final Crown Round, 2 questions each) — **presentation only, no
scoring weight**; the streak multiplier (§5 scoring) supplies the emergent climax. The legacy
morning/midday/night templates and the original `dr_20_trivia` 20-round run remain in code (for
historical reconstruction / legacy tests) but are never provisioned now. Templates let you tune
length/composition without code changes.

---

## 6. Data model (PostgreSQL)

All `id` UUID v4. All timestamps `timestamptz` (UTC). Money/coin truth = ledger (below).

```sql
-- identity
users(id, email UNIQUE, password_hash, created_at, status)
profiles(user_id FK→users PK, username UNIQUE, rating INT DEFAULT 1000,
         division TEXT, streak_count INT DEFAULT 0, last_streak_date DATE,
         sharpness INT DEFAULT 0, coins_balance BIGINT DEFAULT 0,  -- cached; ledger is truth
         equipped_theme TEXT DEFAULT 'daylight', created_at)

-- themes (cosmetic). Static THEMES can live in code; ownership is in DB.
user_themes(user_id FK, theme_id TEXT, acquired_at, PRIMARY KEY(user_id, theme_id))

-- scheduling
contest_windows(id, contest_date DATE, slot TEXT,           -- 'royale' going forward; legacy: 'morning'|'midday'|'night'
                open_at, close_at, state TEXT,              -- SCHEDULED|OPEN|CLOSED|SETTLED
                template_id TEXT, settled_at,
                UNIQUE(contest_date, slot))                 -- one royale window per date going forward; no schema change

-- play
entries(id, window_id FK, user_id FK, seed BIGINT,          -- per-entry RNG seed
        round_set JSONB,                                    -- ordered [{type, client_spec_ref}]
        started_at, submitted_at, total_score INT,
        status TEXT,                                        -- IN_PROGRESS|SUBMITTED|EXPIRED
        UNIQUE(window_id, user_id))                         -- enforces one entry per window

round_results(id, entry_id FK, idx INT, module_type TEXT,
              points INT, correct BOOL, time_frac NUMERIC, valid BOOL, flags JSONB)

-- server-held answers for an entry's rounds (never sent to client)
round_answers(entry_id FK, idx INT, module_type TEXT, server_answer JSONB,
              PRIMARY KEY(entry_id, idx))

-- results
standings(window_id FK, user_id FK, place INT, total_score INT,
          coins_awarded INT, rating_before INT, rating_after INT,
          PRIMARY KEY(window_id, user_id))

-- content banks
questions(id, module_type TEXT, category TEXT, icon TEXT,
          payload JSONB,                                    -- {prompt, options, correctIndex} (trivia)
          difficulty question_difficulty,                   -- enum easy|medium|hard
          explanation TEXT,                                 -- review aid / post-answer reveal
          status question_status DEFAULT 'draft',           -- draft|approved|live; only approved/live served
          active BOOL,                                      -- vestigial (serving gates on status)
          created_at)
-- rapid_math / memory_flash are generated, so need no question rows.

-- currency: APPEND-ONLY source of truth. coins_balance is a cache derived from this.
coin_ledger(id, user_id FK, delta BIGINT, reason TEXT,      -- 'contest_payout'|'theme_purchase'|'streak_bonus'|...
            ref_type TEXT, ref_id UUID, balance_after BIGINT, created_at)
```

> **Why the ledger.** Every coin in/out is an immutable row with a reason and reference. This is
> trivial now but is exactly the audit trail you need the day real money or disputes enter. Build
> it from day one; treat `profiles.coins_balance` as a cache that must equal the ledger sum.

### Categories, content & review-gated ingestion (categories milestone)

- **Serving gate:** only `status in ('approved','live')` rows are ever served (`fetch_bank` /
  `list_categories`); `draft` is staged content that never reaches a player. `active` is vestigial.
- **Canonical categories (LOCKED — exactly six):** `Science & Nature`, `History`, `Geography`,
  `Arts & Literature`, `Sports`, `Pop Culture & Entertainment` (`content/categories.py`). The category
  picker shows exactly these; ingest rejects any other category (so a typo can't create a near-dup).
- **Ingestion:** `python -m app.jobs.run ingest <file.json>` loads a reviewed JSON bank
  (`[{category, question, options[4], correct_index, difficulty, explanation, confidence}]`) as
  `status='approved'` — validates each row, dedupes on `(question, category)` (DB + in-file), ignores
  `confidence`, and reports added/skipped/rejected-with-reason (malformed → rejected loudly, exit
  non-zero). `confidence` is a review aid, never stored.
- **Category sessions (no-stakes):** `GET /categories`, then `POST /practice/start {category}` runs a
  **category-scoped 10-question trivia session** with a weighted difficulty mix (easy/medium-heavy,
  some hard). The ranked **Daily Royale** stays mixed across all categories (no category pick) for
  comparability.

---

## 7. Scoring, settlement & integrity

### Play flow (server-authoritative)
1. `POST /contests/{window_id}/enter` → server checks window is OPEN and no existing entry,
   creates `entries` row with a fresh `seed`, runs each module's `generate()` to build the
   round set, stores `round_answers` (server-side), returns **only** `client_spec`s.
2. Client plays each round, submits per-round results (`POST /entries/{id}/rounds/{idx}` or one
   batched submit at the end).
3. Server scores each submission against stored `round_answers` via the module's `score()`,
   writes `round_results`, computes `total_score`, marks entry `SUBMITTED`. Returns provisional score.
4. At `close_at`, **settlement job**: load all SUBMITTED entries for the window, rank by
   `total_score` (tiebreak: lower average response time), write `standings`, award coins by
   placement bracket + streak bonus (ledger rows), apply rating deltas, update streaks, set window
   `SETTLED`.

### Coins by placement (v1, tunable)
1st: 100 · 2nd: 70 · 3rd: 50 · top third: 30 · else: 15 · + streak bonus `(streak+1)*2`.

### Rating
Elo-style vs the field: `delta = round(((field_size - place)/(field_size - 1) - 0.5) * K)`, `K≈64`.
Division derived from rating (Bronze→Silver→Gold→Platinum→Diamond→Apex). Persist before/after.

### Integrity / anti-cheat (v1 baseline)
- **Seeded pools:** the ranked **Daily Royale is a shared per-window seed** (same questions for all,
  Wordle-style, for a comparable leaderboard) — leakable within the 24h window, an accepted trade-off
  (currency-only, server-validated). Non-ranked modes (practice/category/campaign/duels) keep per-run
  seeds.
- **Answers never leave the server** (`client_spec` vs `server_answer` split).
- **One entry per window** enforced by unique constraint; entry seed is fixed at creation (no reroll).
- **Server recomputes scores** for trivia/math/memory; client score is provisional only.
- **Mini-games are validated, not trusted.** Server can't fully recompute a reaction game, so
  `score()` does plausibility checks: score within possible bounds, timings humanly plausible,
  input count consistent with the seed; suspicious → `valid=false`, flagged, excluded from payout.
  Design mini-game scoring so the meaningful, payout-affecting part is server-checkable.
- **Rate limiting** on enter/submit endpoints; reject submissions after `close_at`.
- **~~Cold-start bot fill~~ — REMOVED.** Settlement once padded a thin field with in-memory
  synthetic entries so placement felt real. It was built as an explicitly removable launch crutch
  and has now been removed: the Daily Royale field, the per-round field endpoint, standings, and
  share snapshots are **real entries only**. A one-entry field settles as 1st of 1 and moves no
  rating. The only synthetic opponent left in the game is the **duel rival** (§13a) — a disclosed
  1v1 practice partner, never a leaderboard entrant.

---

## 8. API surface (initial)

```
POST /auth/register            POST /auth/login            POST /auth/refresh
GET  /me                       -> profile + balances + equipped theme + streak/rating
GET  /contests/current         -> open window (if any) + next window open time per slot
POST /contests/{id}/enter      -> creates entry, returns round client_specs
POST /entries/{id}/submit      -> batched round results; returns provisional score
GET  /contests/{id}/standings  -> settled standings (after close)
GET  /me/history               -> past entries/placements
GET  /store/themes             -> themes + owned + equipped
POST /store/themes/{id}/buy    -> ledger debit, grant ownership
POST /store/themes/{id}/equip
GET  /me/coins/ledger          -> coin history
```

---

## 9. Background jobs
- **Window scheduler** (daily, ~00:30 ET; startup provisions today+tomorrow immediately): create the
  next day's single `royale` `SCHEDULED` window with ET-correct `open_at`/`close_at` and the
  `dr_8_trivia` template (`PROVISIONED_SLOTS = ("royale",)`).
- **State transitioner** (frequent, e.g. each minute): flip `SCHEDULED→OPEN` and `OPEN→CLOSED` by time.
- **Settlement worker** (gated to 12:15 AM ET): settle `CLOSED` windows (§7) only once
  `now >= settle_at` (`close_at + SETTLE_DELAY_MINUTES`, =15). Driven by a **targeted 12:15-ET
  settle** — the daemon's ET cron (`CronTrigger(hour=0, minute=15, timezone=ET)`) and Render's
  dual-UTC cron `15 4,5 * * *` (04:15 + 05:15 UTC = 12:15 AM ET in EDT/EST; the gate makes the
  DST-correct one effective) — **plus** the frequent transition/heartbeat tick as a fallback.
  Settlement is **never lazy/on-read**, exactly-once (FOR UPDATE + `state==CLOSED`), and never
  commits partially.
- **Push notifications**: at window open ("Today's Daily Royale is live — play before midnight ET");
  optional streak-at-risk nudge. Via Capacitor Push + a provider (FCM/APNs) / Web Push.

---

## 10. The hub (interactive area)
A persistent **Phaser scene** the player returns to between contests. v1 contents:
- Player's room/board reflecting equipped theme art style.
- Live status of the **Daily Royale** (the Home A–F states: before-open / live-not-entered / entered
  & score-locked / closed-settling / results-ready / result-viewed), not three windows.
- Coins, streak (flame), rating + division, sharpness.
- Tap-to-enter the open contest; entry to practice; entry to the store.
Keep v1 hub simple but make it the home surface — it's where cosmetics/themes are shown off, which
is what gives coins their purpose. No social feed, no avatars-trading in v1.

---

## 11. Theming (port from RotRoyale.jsx)
- Theme tokens are CSS variables applied at the root; art `style` (`soft`/`pixel`/`mono`) swaps
  fonts/shape/texture via a root class. Keep the one-object-per-theme schema so adding a theme is
  a single object. Phaser scenes must read the same token palette so the hub re-skins with the app.
- Themes (`vars`) can live in shared code; **ownership/equipped state lives in the DB** (§6).

---

## 12. Milestones (build in this order)

**M0 — Scaffold.** Monorepo, `frontend` (Vite+React+TS+Capacitor init), `backend`
(FastAPI+SQLAlchemy async+Alembic), `docker-compose` Postgres, CI lint/typecheck, `CLAUDE.md`
with conventions. *Done when:* both apps boot, DB connects, one health endpoint, one rendered screen.

**M1 — Auth & profile.** Register/login/refresh (JWT), `profiles` with rating/coins/streak/theme,
`GET /me`. Frontend auth flow + session. *Done when:* a user can sign up, log in, and see their profile.

**M2 — Contest engine + windows + trivia module.** `contest_windows`, scheduler + state
transitioner (ET/DST-correct), `entries` with seeded randomized pools, the round-module registry
(server + client), the **trivia** module end-to-end, `enter`/`submit` with server-authoritative
scoring, the contest UI ported from the reference (category splash, timer, scoring). *Done when:* a
user can enter an open window, play seeded trivia, and get a server-scored provisional total; a
second user gets different questions.

**M3 — More modules.** Add **rapid_math** and **memory_flash** as modules (no engine changes).
Contest templates per slot. *Done when:* a contest renders a mixed round set from a template.

**M4 — Settlement + ladder + results.** Settlement worker, `standings`, coin payouts via
`coin_ledger`, rating deltas, streak update, results screen, history, ladder/division display.
*Done when:* a closed window settles, placements/coins/rating/streak apply, and
results show on next open. (Shipped with cold-start bot fill; that fill has since been removed —
see §7.)

**M5 — Hub + themes + store + coins.** Phaser hub scene, theme port (soft/pixel/mono), store
(buy/equip with ledger), balances. *Done when:* a player can win coins, buy/equip a theme, and see
the hub + app re-skin.

**M6 — Categories + review-gated content ingestion (§6).** Lock the canonical six categories, widen
the question schema (`difficulty` enum, `status`, `explanation`), build the `ingest` command, and add
category-scoped 10-question trivia sessions with a difficulty mix — ranked windows stay mixed across
categories. *Done when:* a reviewed JSON bank ingests as approved-only content and a player can pick a
category for scoped trivia while ranked stays mixed. (An earlier M6 shipped two visual mini-games
`pattern_sequence`/`odd_one_out` and an even earlier `tap_target` Phaser game; all were removed —
untestable or too-easy. Phaser is reserved for the §10 hub scene only.)

**M7 — Capacitor packaging + push.** iOS/Android builds, push notifications on window open.
*Done when:* installable dev builds on both platforms with working push.

---

## 13. v1 NON-GOALS (do not build)
- Real money, payments, withdrawals, deposits, or any wager/prize-with-entry-fee mechanic.
- Purchasable or cashable coins; peer-to-peer coin transfer.
- Live/synchronous multiplayer for the **Daily Royale / contest** path — that stays async-windows
  only. **EXCEPTION (now in scope, §13a):** the opt-in **friend duel** is a real-time 1v1 played
  over a WebSocket. The realtime path is scoped to friend duels; contests never go realtime.
- Social **feed, chat, DMs.** **EXCEPTION (now in scope, §13a):** a minimal **friends graph**
  (username friend requests → accept) exists, but only to gate friend duels — no feed/chat/DMs.
- Creator-hosted games, sponsorships, ad system.
- Crypto/wallets/token economy.
- Complex avatar/marketplace systems beyond cosmetic themes.

Keep these out of scope but don't architecturally preclude money later — the `coin_ledger`,
server-authoritative scoring, and standings tables are the seams it would plug into.

## 13a. Social duels (added past the original non-goal list)

Two players who are **friends** can challenge each other to a **live** best-of-7 trivia duel. This
deliberately relaxes two original §13 non-goals (friends graph + realtime multiplayer), scoped
tightly so the rest of the product stays async and stake-free:

- **Friends graph** (`friendships` table, `services/friends.py`, `/friends`): friend a player by
  **username**, accept/decline requests, list friends. Mutual "add" auto-accepts. This is the whole
  social surface — no feed, chat, or DMs.
- **Live friend duel** (`friend_duels` / `friend_duel_rounds` / `friend_duel_submissions`,
  `services/friend_duel.py`, `/friend-duels` + the `/friend-duels/ws/{id}` WebSocket): challenge a
  friend → they accept → both play the **same seeded** best-of-7 in real time. A round resolves only
  once **both** have answered; the server is the sole authority (scores each answer via the
  canonical `module.score()`, adjudicates head-to-head with the existing `duel_logic` rules, never
  sends answers before the round resolves). State is DB-backed (`friend_duel_submissions`) so a
  reconnect never loses progress; the WebSocket is a thin transport over the service.
- **Free — no Gems/stakes.** A friend duel pays nothing and stakes nothing; it rolls into the same
  `DuelUserStats` **training** counters (training W/L + duel XP/tier + perfect/comeback honors) as a
  bot training duel. The bot-Gem-duel daily cap is untouched.
- **Honesty rules still apply** (DESIGN §7): friend-facing copy is bragging-rights framing — never
  cash/prize/bet/wager/gambling; never a fabricated "player" count.

The WebSocket is the **only** realtime gameplay seam in the product; the Daily Royale and all
contest/campaign/practice play stay strictly async + server-settled.

## 14. Open decisions (resolve as we go)
- Submission model: per-round POST vs single batched submit at end (default: **batched** for fewer
  round-trips; revisit if anti-cheat wants per-round timing server-side).
- Bank size per module needed to make seeded pools meaningfully non-overlapping at expected
  concurrency (start: ≥10× rounds-per-contest per module).
- Difficulty model: static per template vs adaptive (v1: **static per template**).
- Practice mode: client-only sharpness vs server-tracked (v1: server-tracked so it persists).
