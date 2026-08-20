# CLAUDE.md — Rot Royale repo conventions

Working conventions for Claude Code on this repo.

**`PLAN.md` is the authoritative spec** (product scope, data model, milestones). Build in the
milestone order in PLAN.md §12. Do not over-build past v1 scope (PLAN.md §13).

> **Section numbers are an API.** Code comments cite them (`CLAUDE.md §8`, `§5a`, `§6`, …).
> **Add sections; never renumber existing ones.** That is why the order below runs
> 7 → 7b → 8 → 8a rather than straight through.

---

## 0. Working contract

How to operate in this repo. Everything below §0 is domain knowledge; this section is method.

### Authority order

1. **The user's instruction in this conversation** — beats everything here.
2. **PLAN.md** — the spec. If this file disagrees with it, PLAN.md wins; fix this file in the same
   change.
3. **This file**, then `DESIGN.md` (visual spec), then `.claude/skills/`.
4. **Inference** — last.

**If this file disagrees with the CODE, the code wins.** Update this file in the same change. A
stale convention is worse than no convention: it gets trusted and repeated. Reality drifts, so treat
every claim here as checkable, and check the ones you are about to rely on.

### The invariants

Never break these without an explicit instruction to do so. Each is expanded in its own section.

| # | Invariant | Where |
|---|-----------|-------|
| 1 | Answers never leave the server; client scores are never trusted | §5 |
| 2 | Coins and Gems move ONLY through their append-only ledgers | §8 |
| 3 | Window times computed in ET via `zoneinfo` — never a hardcoded UTC offset | §6 |
| 4 | Schema changes ONLY via Alembic — never `create_all`, never hand-edited | §2 |
| 5 | The Daily Royale field is real entries only — no synthetic entrants | §7b |
| 6 | Player-facing copy: no money/gambling framing, and never an invented count | §7 |
| 7 | On this machine: never kill a process by name; never touch :8000 | §4 |

### Verification gates — "done" means you ran it

| Change touches | Must pass before you call it done |
|---|---|
| Backend logic | `uv run ruff check .` · **`uv run ruff format --check .`** · `uv run mypy app` · `uv run pytest` |
| Frontend logic | `npm run typecheck` · `npm run lint` · `npx vitest run` |
| Anything visual | the frontend three **plus** looking at the running app at mobile width |
| Production surface | `npm run build` (catches what dev-mode hides) |
| DB schema | a migration + `uv run alembic upgrade head` + the backend suite |
| An asset in `public/` | measure the file, and bump its `?v=` (see §7) |

Report what you ran and what it said. **Never describe a suite as green without having run it**, and
if you skipped a gate, say which and why. A failing test reported honestly is worth more than a
passing claim.

**A green CI tick is not the same as these gates, and a stale one is worth less still.** Until
2026-08-02 neither CI job ran its test suite, and `ruff format --check` was in CI but missing from
the table above — so both drifted from what CI actually enforced. Both suites now run in CI, but the
older lesson stands on its own: a PR's checks were run against the base commit it was opened on. If
`main` has moved, re-verify the MERGED result locally before merging, not the branch in isolation.
PR #38 sat green for eight days and would have broken `main` the moment it landed.

### Evidence over assertion

Measure; don't eyeball. The tools are there:

- Tuning a number against artwork → read the image's pixels (alpha, rims, bounding boxes) and derive
  the value, rather than nudging until it looks close.
- Tuning layout → query the live DOM for real rects instead of reasoning about JSX.
- Claiming data is missing/present → query it.

A value you can justify from a measurement survives the next redesign; a magic number does not.
Leave the derivation in a comment next to it.

### Plan first, or just do it?

**Just do it** — bug fixes, well-specified tweaks, mechanical refactors, anything reversible and
covered by tests. Say what you did and show the verification.

**Plan and get agreement first** — a new screen or system, a redesign, a schema or API-contract
change, anything touching an invariant above, or work spanning many files with real alternatives.
Keep the plan short enough to read in one pass; the point is the decision, not the document.

**UI / game-feel work has its own workflow**: load `.claude/skills/game-ui-design/SKILL.md` first
(§7). It defines the plan-before-coding step for design work.

When a genuine either/or affects the outcome, ask once, with a recommendation — don't ask about
things you can determine yourself.

### Working the local loop

Backend :8001, frontend :5173 (§4) — usually already running; check before starting another.

For UI work, drive the real app. Transiently patching the DOM or a `fetch` response **in the
browser** is a legitimate way to see a state the seed data can't reach (a podium wearing cosmetics
nobody has equipped, a dark theme's tokens) — it touches nothing server-side. Restore what you
patched when you're done.

**Never mutate real account or DB state to preview something** — don't equip, purchase, or spend to
see how it looks. Prefer a test that pins the behaviour permanently over a one-off manual check.

### Parallelism

Independent tool calls belong in one batch. Push wide "where is X / what references Y" sweeps to a
subagent so the main thread keeps its context for the decision rather than the file dump.

### Keeping this file true

Write down what a future session would otherwise get wrong: non-obvious invariants, the reason
behind a surprising choice, traps that already cost a debugging session. Leave out what the code
says plainly — this file should not restate signatures.

When you remove a system, say so **here** and say why, so it doesn't get rebuilt (see the removed
mini-games in §5 and the removed cold-start bots in §7b).

---

## 1. What this is

Rot Royale — a **windowed-async skill-contest game**. The ranked event is the **Daily Royale**: one
8-question trivia run per ET day, inside a 24-hour window, scored against everyone else who played
that day (§6). A contest is an ordered list of **round modules** (§5).

**No real money, payments, or gambling.** Two in-game currencies, both closed-loop and earned-only:
**coins** (the spendable one — campaign/practice earn them, the Vault spends them) and **Gems** (the
scarce one — Daily Royale placement and streak milestones grant them). Both are ledger-backed (§8).

`RotRoyale.jsx` (repo root) is the **frontend feel reference** — port from it, don't redesign. It is
the source of truth for the theme schema and the art styles.

---

## 2. Stack

**Frontend** (`frontend/`) — one codebase for web + wrapped mobile:
- Vite + React + TypeScript SPA. All current round modules are DOM/React.
- Zustand for session/UI state. `@tanstack/react-query` is installed and its provider is mounted in
  `main.tsx`, but **nothing calls `useQuery` yet** — screens fetch through the typed client in
  `src/api/client.ts` and hold results in local state. Don't describe the app as Query-driven.
- Phaser 3 is a **dependency with no importers** — forward scaffolding for the planned hub scene
  (§5). The build emits no phaser chunk.
- **Screens are code-split, and the shell is the only thing on the cold-start path.** Every screen
  reached from an App-level flag goes through `src/app/lazyScreens.ts`, Home's tap-opened overlays
  through `src/screens/home/lazyOverlays.ts`, and the public legal/download routes through
  `main.tsx` — all `React.lazy` behind one `<Suspense>` per owner. **Do not statically import a
  screen into `App.tsx`, `Home.tsx` or `main.tsx`**; add it to the matching lazy module instead, or
  the whole thing folds back into the initial chunk (it was one 645 KB `main`; splitting took the
  critical path from 953 KB / 258 KB gz to 394 KB / 118 KB gz).
  - Locale dicts are split the same way: `loadDict()` fetches one non-English dict on demand and the
    store holds it, so `useT()` stays synchronous. `@/i18n/dicts` (all four, statically) is
    **test-only** — importing it from app code puts ~112 KB of unread copy back in the shared chunk.
  - `warmScreens()` re-fetches every split chunk on idle after first paint, so splitting never turns
    into a dead-feeling tap. React keeps the current screen mounted while a chunk loads, which is
    also why a test that navigates must wait on the DESTINATION's own content — a label Home shares
    (like the nav's "Home") resolves before the swap.
- Capacitor wraps the SPA into iOS/Android builds + push.

**Backend** (`backend/`):
- FastAPI (async) + PostgreSQL, async throughout.
- SQLAlchemy 2.x async + Alembic. **All schema changes via Alembic migrations only** — never
  `create_all` against a real DB, never hand-edit schema. *(Invariant 4.)*
- JWT auth (access + refresh) — §8a.
- APScheduler / Render cron for the window scheduler + settlement jobs (§5, §7b).
- Server-authoritative: the server is the source of truth for answers, scores, coins, gems, rating
  and standings.
- Python dep management: **uv** (`backend/pyproject.toml` + `uv.lock`). Reproducible installs only.

Deploy target: Render.

---

## 3. Repository structure

Monorepo; PLAN.md §3 has the full tree.

```
frontend/            Vite + React + TS SPA (+ Capacitor)
backend/             FastAPI + SQLAlchemy async + Alembic
docker-compose.yml   local Postgres (see the DB note in §4)
PLAN.md              authoritative spec
DESIGN.md            visual spec
RotRoyale.jsx        frontend feel reference
```

Backend: `app/core` (config, security, db session, timezone), `app/models` (SQLAlchemy),
`app/schemas` (Pydantic), `app/api` (routers), `app/modules` (round modules + `registry.py`),
`app/services` (contest engine, scoring, settlement, ledgers), `app/jobs` (scheduler/worker
entrypoints), `content/` (banks + ingest — §5a).

Frontend: `src/app` (shell/routing), `src/screens`, `src/modules` (round modules + `registry.ts`),
`src/game` (Phaser scaffolding), `src/theme`, `src/ui` (shared primitives — §7), `src/i18n`,
`src/api`, `src/store`.

---

## 4. Local dev & commands

> **DB deviation — read this.** PLAN.md §3 specifies `docker-compose.yml` for local Postgres. On
> this dev machine **Docker is not installed**; a local **PostgreSQL 16** service
> (`postgresql-x64-16`) runs on `localhost:5432` instead. Both paths use the **same credentials** so
> one `DATABASE_URL` works for either: role `rot_royale` / password `rot_royale` / db `rot_royale`.
> The compose file stays committed per spec for environments that do have Docker. `psql` lives at
> `C:\Program Files\PostgreSQL\16\bin`.

One-time DB setup (local, no Docker):
```
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres `
  -c "CREATE ROLE rot_royale LOGIN PASSWORD 'rot_royale';" `
  -c "CREATE DATABASE rot_royale OWNER rot_royale;"
```
With Docker: `docker compose up -d` brings up Postgres with the same creds.

`DATABASE_URL` = `postgresql+asyncpg://rot_royale:rot_royale@localhost:5432/rot_royale` (async driver
= asyncpg). Config is env-driven via pydantic-settings; copy `backend/.env.example` → `backend/.env`.

**Backend** (from `backend/`):
- Install: `uv sync`
- Run dev: `uv run uvicorn app.main:app --port 8001 --reload`
- Migrations: `uv run alembic revision --autogenerate -m "msg"` / `uv run alembic upgrade head`
- Lint/format: `uv run ruff check .` / `uv run ruff format .`
- Typecheck: `uv run mypy app`
- Tests: `uv run pytest` — runs against the real `rot_royale` DB inside a per-test transaction that
  is rolled back; nothing persists, because services never commit (`tests/conftest.py`).
  **Prerequisite:** `uv run alembic upgrade head` first — the harness uses the existing schema and
  does not create tables, so a fresh DB gives table-not-found errors.
  Autogenerated migrations routinely include unrelated drops — **read every generated migration
  before applying it** and trim it to the intended change.

**Frontend** (from `frontend/`):
- Install: `npm install`  ·  Run dev: `npm run dev`
- Build: `npm run build`  ·  Typecheck: `npm run typecheck`  ·  Lint: `npm run lint`
- Tests: `npx vitest run`

**Health check:** `GET http://localhost:8001/health` → `{"status":"ok","db":"ok"}` (runs `SELECT 1`).

> **Port note (this machine).** Port 8000 is taken by a **different project** (a separate uvicorn
> `api.main:app`). Rot Royale's backend runs on **8001** locally; point the frontend at it via a
> gitignored `frontend/.env.local` containing `VITE_API_BASE=http://localhost:8001`. The canonical
> default stays 8000 in `.env.example` — this is a local-only workaround.

> **⚠️ OPS RULES (do not violate).** *(Invariant 7.)*
> - Rot Royale's backend runs on **:8001 only**. The frontend runs on **:5173**.
> - **NEVER kill processes by name** (`uvicorn`, `python`, `node`, …). The **Nova** project runs its
>   own uvicorn on **:8000** on this machine — a name-based kill takes it down.
> - Stop/restart Rot Royale **by port (:8001) or by a specific PID only**: find the listener with
>   `Get-NetTCPConnection -LocalPort 8001 -State Listen`, `Stop-Process` that exact PID, then start a
>   new one. Never touch :8000 or any process you did not start.
> - Check whether a server is already up before starting another.

---

## 5. Round-module plugin system (core architecture)

A contest is an ordered list of **round modules**. **Adding a game mode = adding a module; the
contest engine is never touched.** Both sides register in a `registry` keyed by `type`.

**The anti-cheat split — `client_spec` vs `server_answer` — is non-negotiable** *(Invariant 1)*:
- `generate(rng, difficulty, ctx) -> (client_spec, server_answer)`. `client_spec` goes to the client
  and **must never contain the answer** (trivia: prompt + options, no `correctIndex`).
  `server_answer` is stored server-side only (`round_answers`) and used to score. **Answers never
  leave the server.** `ctx` (`GenerationContext`) carries loaded content (e.g. the trivia bank) so
  modules stay stateless singletons; generated modules ignore it.
- The client submits a result; the server's `score(server_answer, submission)` is canonical. The
  client score is provisional/display only, and the client cannot reveal correctness during play
  because it has no answer — correctness comes back from the server on submit.
- `correctIndex` is **positional**: it indexes the options array as sent. Reordering options without
  moving the index silently corrupts the question.

Server interface: `backend/app/modules/base.py` (`RoundModule` Protocol: `type`, `time_limit_ms`,
`generate`, `score`). `score()` returns a `RoundJudgement {correct, time_frac, valid, flags}` —
**not** points. Client interface: `frontend/src/modules/types.ts` (`type`, `Component`, `surface`).

**Reproducibility:** `services/engine.build_round_set(seed, template, ctx)` is a PURE function — same
inputs, same rounds. An entry is regenerable from its stored `seed`; `entries.round_set` JSONB is an
audit copy, not the source of truth. The bank is fetched ordered by id (stable order required).

**Scoring — one server-side place (`services/scoring.py`):**
`points = correct ? round((100 + time_frac*60) * (1 + min(streak,5)*0.12)) : 0`
where `streak` = consecutive correct **within the contest**, incremented BEFORE the multiplier (first
correct = streak 1 = ×1.12). The module judges correct/time_frac; the scoring service owns points.
`time_frac = clamp((limit_ms − elapsed_ms)/limit_ms, 0, 1)` using the SERVER's `limit_ms` — client
`elapsed_ms` is clamped, never trusted, and client-sent scores are ignored entirely.

**Windows are driven by a scheduler daemon** (`app/jobs/daemon.py`, APScheduler `AsyncIOScheduler`,
started in the FastAPI lifespan when `scheduler_enabled`): a transition tick every
`scheduler_tick_seconds` (default 60) flips SCHEDULED→OPEN→CLOSED; a 00:30-ET cron provisions the
next day's single Daily Royale window (startup also provisions today + tomorrow immediately); and a
targeted **12:15-AM-ET cron** (`CronTrigger(hour=0, minute=15, timezone=ET)`) runs the gated settle.
On Render, run the one-shot entrypoint as cron instead — `python -m app.jobs.run both` on a frequent
heartbeat (`*/2`) plus a targeted `15 4,5 * * *` settle cron (04:15 + 05:15 UTC = 12:15 AM ET in
EDT/EST; the gate makes the DST-correct one effective) — with `scheduler_enabled=false` on the web
service so jobs run exactly once. **Transitions** are *also* applied lazily on read
(`GET /contests/current`, `enter`) as a defensive fallback; **settlement is NEVER lazy** — it fires
only once `now >= settle_at` (§7b). Tests disable the daemon (the lifespan doesn't run under httpx
ASGITransport) and drive the transitioner directly with an injected `now`, including forced
spring-forward / fall-back days (`tests/test_dst_transitions.py`).

**v1 modules** (all implemented, all DOM/React): `trivia` (content-backed MC drawn from the questions
bank via the GenerationContext), `rapid_math` (generated MC — multi-digit and precedence-bearing
two-operator expressions, bounded for ~9s mental math), and `memory_flash` (Simon-style sequence).
The ranked **Daily Royale is trivia-only**; `rapid_math` and `memory_flash` stay registered for
legacy/practice templates and the plugin system still supports mixing them. Category sessions are
trivia-only too (§5a).

`memory_flash`'s sequence is the on-screen stimulus, so it appears in `client_spec`; the anti-cheat
property is that submitted taps are server-validated against the stored sequence (with per-tap
timestamps for plausibility checks). Mini-games are **validated, not trusted** — `score()` does
server-side checks; suspicious → `valid=false`, flagged, excluded.

> **Removed — do not reintroduce without a product reason.**
> - `pattern_sequence` and `odd_one_out` (visual mini-games): testers found them incoherent / too
>   easy. Nothing references them.
> - `tap_target` (the original Phaser mini-game): real-time canvas hit-detection failed for real
>   users and wasn't auto-testable. Phaser remains only as scaffolding for the planned hub scene
>   (`src/game/`, PLAN.md §10) — the dependency, the `surface: "phaser"` module-type option and the
>   vite PWA `phaser-chunk` rules stay, but **no module imports it**.

**Submit is module-agnostic:** each round's submission carries an opaque `result` dict
(`{idx, result}`); the submit endpoint maps `idx → result` and the module's `score()` reads its own
fields — adding a module never touches submit/engine/scoring. **Templates are per-slot**
(`services/templates.py`): the provisioned `royale` slot uses the single `DAILY_ROYALE`
(`dr_8_trivia`) template — a flat 8× trivia. The frontend presents four round-blocks (Opening /
Pressure / Crown Climb / Final Crown, 2 questions each) — **presentation only, no scoring weight**.
The legacy morning/midday/night mixed templates and the original `dr_20_trivia` are **retained for
history** and never provisioned. The client registry mirrors the server, so a new module = a client
component + a registry entry on each side.

---

## 5a. Categories, content bank & review-gated ingestion

> **One canonical content tree.** ALL content data lives in the `backend/content/` package next to
> its code — `content/bank/*.json` (trivia banks, per-category names like `science.json`),
> `content/campaign/plan/*.json` (world→category maps), and the built
> `content/campaign/campaign_levels.json`. The deploy ingest (`render.yaml`) and the campaign builder
> (`build_manifest.py`) BOTH read this one tree, so campaign `question_key`s always resolve against
> the ingested DB. There is no repo-root `content/` tree — a stale duplicate was consolidated away;
> don't recreate one.

The `questions` table is the content bank for `trivia`. Every row carries `category`, `difficulty`
(`easy|medium|hard`), `explanation` (review aid / post-answer reveal), `status`
(`draft|approved|live`) and `payload` (`{prompt, options, correctIndex}`).

- **Serving gate (the one gate):** ONLY `status in (approved, live)` rows are ever served.
  `fetch_bank` / `list_categories` enforce it, so `draft` (staged) content never reaches a player.
  The category list and session-start use the SAME gate, so a draft-only category never appears and
  never 500s on start. The old `active` column is **vestigial** — nothing reads it; don't add a
  second gate.
- **Canonical categories — EIGHT** (`content/categories.py`, `CANONICAL_CATEGORIES`, which carries
  the reasoning for each): the original six `Science & Nature`, `History`, `Geography`,
  `Arts & Literature`, `Sports`, `Pop Culture & Entertainment`, plus `Money & Business` and
  `Street Smarts`. Ingest **rejects any other category** so a typo can't spawn a near-duplicate;
  adding one is a deliberate edit to that tuple. The legacy nine-category placeholder seed was
  folded in (remapped `trivia.json` + the `b3c4d5e6f7a8` data migration via `LEGACY_CATEGORY_MAP`).
  > This list said "LOCKED — exactly six" long after the seventh and eighth shipped. The two newest
  > are also the two that match the audience (§5c) — so the stale line was hiding the most important
  > content decision in the repo. `content/categories.py` is the source of truth; check it, not this.
- **Ingestion:** `python -m app.jobs.run ingest <file.json>` → `content/ingest.py::ingest_bank`.
  Input is a JSON array of `{category, question, options[4], correct_index 0..3, difficulty,
  explanation, confidence}`. Files are human-reviewed before ingestion, so valid rows land as
  `status='approved'`; `confidence` is a review aid, **never stored**. Each row is validated (4
  options, `correct_index` 0–3, canonical category, valid difficulty, non-empty explanation), then
  **upserted** on `(question, category)`: new rows insert; an existing row whose content changed
  (options / correct index / explanation / difficulty / icon) is **refreshed in place** (files are
  the source of truth, so the deploy's re-ingest keeps the DB in sync with edited banks — `status` is
  preserved, so a `live` row is never demoted); unchanged rows are a no-op. The run reports
  added/updated/skipped/rejected-with-reason, and malformed rows are rejected **loudly** (non-zero
  exit), never silently dropped. **A stem edit changes the key**, so it inserts a new row and orphans
  the old one — that case needs a category **re-seed** (delete + ingest) via
  `backend/scripts/reseed_category.py "<Category>" <bank>`, not a plain re-ingest.
- **Translations** (`models/question_translation.py`, `services/translation_io.py`). Content is
  translated offline into the `question_translations` table and staged as `draft`, with risky rows
  flagged for human review; only `SERVABLE_TRANSLATION_STATUSES` are served. The seam is the
  **`display` dict** built by `content/loader.py::fetch_bank` — localized `{prompt, options,
  explanation}` when an approved translation exists, English otherwise. Two rules make it safe:
  **`payload` stays canonical English** (campaign `question_key`s hash the English prompt, so
  translating in place would orphan every level), and `display["options"]` must keep the **same
  length and order** as `payload["options"]` because `correctIndex` is positional — a translation
  whose option count drifted is refused, not served. Fallback is **per question**, so a partly
  translated bank still serves a complete round set.
- **Category sessions (no-stakes):** `GET /categories` lists servable categories with counts;
  `POST /practice/start {category}` runs a **category-scoped 10-question trivia session**
  (`CATEGORY_SESSION` template) with a weighted difficulty mix (easy×4 / medium×4 / hard×2, with
  graceful fallback when a difficulty is thin). No category → the unchanged 5-round mixed practice.
  **The ranked Daily Royale never takes a category** — its 8 rounds stay mixed across all categories
  for fair comparability. Scoping is done by **pre-filtering the bank** (the contest engine never
  learns about categories); the difficulty mix lives in the template (`RoundSlot.difficulty`, where
  `None` = any difficulty, used by ranked/mixed slots).

---

## 5b. Social: friends graph & LIVE friend duels (PLAN.md §13a)

> **Scope note.** This layer **intentionally relaxes two original PLAN.md §13 non-goals** (friends
> graph + realtime multiplayer); PLAN.md §13/§13a were updated to match. The relaxation is tight: the
> realtime WebSocket path is **friend-duels only** — the Daily Royale and all
> contest/campaign/practice play stay strictly async + server-settled. Friend duels are **free** (no
> Gems, no stakes).

- **Friends graph** (`models/social.Friendship`, `services/friends.py`, `api/friends.py`): friend a
  player by **username** (`Profile.username`, the public handle — the `User` row carries only email).
  One row per `(requester, addressee)`; `status` walks `pending → accepted` (or `declined`).
  Membership checks **both** orderings. A mutual add (B invited A, then A adds B) **auto-accepts**
  instead of duplicating. This is the entire social surface — **no feed, chat, or DMs.**
- **Live friend duel** (`models/social.{FriendDuel,FriendDuelRound,FriendDuelSubmission}`,
  `services/friend_duel.py`, `api/friend_duel.py`): challenge an accepted friend → they accept →
  both play the **same seeded** best-of-7 (`DUEL_BO7`) in real time. Lifecycle
  `pending → active → completed` (or `declined/cancelled/expired`). One open duel per friend pair.
  - **WebSocket** `/friend-duels/ws/{duel_id}?token=<access>` is the live transport; an in-process
    `LiveDuelHub` routes messages between the two sockets. The handler is **thin** — all authority
    lives in the service. Client sends `{type:"answer", idx, result}`; server pushes `state` /
    `answer_ack` / `opponent_answered` / `round_result` / presence / `error`.
  - **A round resolves only once BOTH players have answered.** Each answer is recorded in
    `friend_duel_submissions` (DB-backed, so a reconnect never loses one); when both exist the round
    adjudicates via the pure `duel_logic` (`round_outcome`, `match_decision`, `final_tiebreak`) —
    knowledge first, speed breaks a clear both-correct tie — and `submit_answer` locks the duel row
    (`FOR UPDATE`) so concurrent submits serialize and a round resolves **exactly once**.
    Server-authoritative throughout: `server_answers` never leave the server before a round resolves.
  - **Stats:** a finished friend duel rolls into the **same `DuelUserStats` training counters** as a
    rival duel (`training_wins/losses` + duel XP/tier + perfect/comeback honors), for both players.
    No Gems, no ranked `wins/losses`. (Rival Gem duels are **uncapped** — the former per-ET-day
    `DUEL_BOT_GEM_CAP_PER_DAY` limit was removed; the constant now feeds only an informational "used
    today" counter, not a spending gate.)
  - **Expiry:** unaccepted challenges and accepted-but-unfinished duels both expire
    (`expire_stale_friend_duels`, wired into the daemon tick + `python -m app.jobs.run both`).
- **Frontend:** `src/screens/friends/FriendsScreen.tsx` + `LiveDuel.tsx` (the WebSocket play screen,
  reusing `MultipleChoiceRound` + the duel reveal styling). `api/client.ts` carries the
  friends/friend-duel REST + `friendDuelSocketUrl`. Copy honesty (§7) still applies — bragging-rights
  framing, never cash/bet/gambling, never a fabricated count.

---

## 5c. Who this is for, and what a Rot Royale question is

**The questions are the product.** Everything else — the streak, the grid, the vault, the duels — is
packaging around eight questions a day. A session is 90 seconds long; if those eight are boring, no
amount of polish elsewhere rescues it. Treat content quality as a first-class engineering concern,
not as data someone else fills in.

### The player

**18–30, mobile-first, and quietly worried their attention span is cooked.** They play for ninety
seconds while the kettle boils. They share when the result is impressive *or* funny. The job the app
does for them is not "test my knowledge" — it is **"give me evidence my brain still works, in a form
I can post."**

This is not inferred from nothing: the score ladder runs `Cooked Beyond Repair` → `Brain Rot
Detected` → `Guess Merchant` → `Barely Online` → `Functioning Adult` → `Final Boss`, the tagline is
"Prove your brain isn't cooked", and Brain Boost sells a Brain Score and tracked weaknesses. Nobody
builds that for someone who wants to *prove* they are clever. It is built for someone who is afraid
they are getting duller.

**The corollary that matters:** a pub-quiz question is off-target even when it is a *good* pub-quiz
question. "What is the atomic number of carbon?" is knowledge sport for a 45-year-old quiz-league
player. It cannot make anyone feel sharper, and nobody has ever screenshotted it.

### The four question shapes

Aim for roughly **⅓ recall, ⅔ thinking**. A run of eight identical-feeling questions is the failure
mode, and it is a failure of SHAPE, not of topic — eight subjects asked the same way is still one
question repeated eight times.

| Shape | What it does | Example |
|---|---|---|
| **Scenario** | Second person, a situation you could be in. Feels useful. | *"A raise pushes part of your income into a higher bracket. What actually gets taxed at the higher rate?"* |
| **Why** | A mechanism you can reason to from scratch. | *"Why do gyms price a year cheaper per month than month-to-month?"* |
| **Gut-check** | Punishes a confident wrong intuition. **The most shareable shape** — people argue about it. | *"What keeps you awake at night: the blue light, or the content?"* |
| **Recall** | Name the thing. Keep it, but make it **canon this audience actually holds** — internet, platforms, games, music — not exam syllabus. | *"Rickrolling sends you to which song?"* |

### Rules for writing one

- **Reasonable-from-scratch beats known-or-not.** The best questions can be worked out by someone
  who has never seen the fact, and still teach them something. That is what makes a run feel like
  getting sharper rather than being graded.
- **Wrong answers must be tempting.** Three obviously-wrong options turn a gut-check into a freebie.
  The distractors ARE the question.
- **The `explanation` is the payoff, not paperwork.** It is shown after the answer. Write the
  sentence that makes someone go "huh" — that is the thing they repeat to somebody else.
- **Evergreen-modern, not current.** "Modern" is the goal; "this month's meme" is a trap. Banks are
  ingested and persist, so a question about a specific trend, chart position or who-is-famous-now
  rots within a year and there is no expiry mechanism to catch it. Prefer the durable layer:
  how algorithms and platforms behave, creator and subscription economics, scams and dark patterns,
  sleep/caffeine/attention, internet history that has become canon.
- **No advice.** Money and health questions are general knowledge, never personal financial or
  medical advice (§5a, and the same honesty rule as §7).

`Money & Business` and `Street Smarts` were the first categories written this way and are the
reference for tone — read them before writing new content.

---

## 5d. Cognition rounds & the Daily Royale

Two cognitive round types — `estimate` and `change_detection` — in their own
**`cognition` Postgres schema** (`models/cognition.py`, `services/cognition.py`,
`api/cognition.py`), registered in the SAME round-module registry as trivia (§5). `estimate` and
`change_detection` are also **Daily Royale round types** (see the last bullet). A standalone daily
"gauntlet" was an intermediate step; it was **removed** as a player surface once cognition types
folded into the Royale — its sequencing/pinning/share-grid logic lives in `services/royale_*`.

- **Turn-by-turn state lives in `round_instance` + `attempt`** (not Entry/RoundAnswer): these
  rounds are interactive (3 estimate guesses, a change-detection tap), which one-shot
  generate/score can't hold. Modules still implement the full `RoundModule` protocol so a
  transcript can be judged in one call. Attempt 0 is a **draw-marker** pinning the drawn
  item/prompt at start; player inputs are attempts 1+. The unique `(instance, attempt_index)` is
  the double-submit backstop.
- **Anti-cheat per type:** Estimate's answer AND `components` (which let a client derive it)
  never leave the server until `resolve`; feedback is direction + close/far band
  (`acceptable_pct` = correctness, `close_pct` = band, NULL → 2×). Change detection's bbox is
  server-only, **normalized 0–1 coords, tolerance as a fraction of image dimension** — screen
  size must never change difficulty; content arrives via `content/change_manifest.py`
  (`run ingest-change`).

> **REMOVED pre-launch — do not rebuild without a product reason** (migration `e0f1a2b3c4d5`
> dropped `span_result`, `crowd_response` and both `round_type` rows):
> - **`crowd`** (crowd prediction) scored against crowd SHARE, going live only above a
>   `seed_threshold` of ~300 responses per prompt and using a seeded distribution below it. At
>   launch scale every round would have been graded against that seeded distribution — a fabricated
>   count presented as a real crowd, which Invariant 6 forbids. It needed traffic it could only get
>   by shipping dishonest first.
> - **`span`** (digit span) reads as clinical brain-training, not as this game (§5c). It was never
>   in the Royale pool, and its only player-facing route was the pre-launch playtest harness.
- **Estimate content ops** (`content/estimate_ingest.py`, admin routes in `api/cognition.py`): the
  Fermi set loads via `python -m app.jobs.run ingest-estimate <file.json>` — **all-or-nothing**
  (any invalid item rejects the whole file and writes nothing), upserting by the file's string `id`
  held in `estimate_item.source_id` (the PK stays a UUID).
  > **The committed source of truth is `content/estimate/fermi.json`** (hand-authored, ids
  > `est_hNNNN`). It REPLACED an earlier ~314-item machine-generated bank (formula-dump reveals,
  > false-precision answers, duplicates) that was never in the repo — those rows were retired via
  > `active=false` (kept, not deleted, so any already-pinned window plan still resolves them). Answers
  > are whole counts (the frontend slider rounds guesses to whole under 100, 2 sig figs above — §5f-ish
  > guess granularity in `modules/estimate/logScale.ts`); `estimate_item.answer` is `Numeric(20,6)` so
  > an answer must stay under 1e14. **Deploy:** the web service's `startCommand` runs
  > `ingest-estimate content/estimate/fermi.json --retire-missing` on every start, so the FILE is the
  > active set — editing it and deploying is the whole content-release process, and no manual DB step
  > exists any more. `--retire-missing` deactivates tracked rows the file dropped and reactivates ones
  > it carries again (so reverting the file restores prod); it sits inside the all-or-nothing gate, so
  > a malformed file retires nothing and fails the deploy instead. It is OFF by default — a plain
  > `ingest-estimate` never touches `active`.
  > **Comparison must be representation-proof**: Postgres stores JSON numbers as `numeric`, so a
  > component written `1.41e+18` reads back `1410000000000000000`. Raw-JSON comparison marked those
  > items changed on every single ingest — harmless when ingest was manual, a permanent rewrite loop
  > now that it runs on every deploy. `_canonical()` normalizes every number through `Decimal`; don't
  > replace it with a plain `json.dumps`.
  The file's
  `_flags` land in the diagnostic `flags` column — **never** in a client_spec/reveal/scoring/draw.
  Admins capture a `playtest_verdict` (`good|boring|unfair|repetitive|broken`; `repetitive` = the
  reasoning path recurred, deliberately distinct from `boring`) via
  `POST /cognition/estimate/items/{id}/verdict`, worklist at `GET …/items/unrated`; ingest never
  touches verdicts, so re-ingest preserves them. `export-estimate-verdicts` pairs flags+verdicts.
- **Admin auth** (`api/deps.get_admin_user`): there is no role column — admin = the user's email is
  in the env-driven `ADMIN_EMAILS` allowlist (config `admin_emails`), layered on the normal
  bearer-JWT auth (403 otherwise). This is the pattern for any future admin/content-ops route.
- **`round_instance.scoring_version`** (currently 2, `COGNITION_SCORING_VERSION`): bump it when
  scoring semantics change — leaderboards must never mix versions.
- **Round UI** (§7 for the shared chrome). Two traps specific to these rounds: the estimate dial's
  hero readout is absolutely positioned ABOVE the rail, so `LogSlider`'s top padding is the only
  thing reserving its space (shrink it and it overlaps the caller's preceding line); and the handle
  and readout are `clamp()`ed into the track, because after a wrong guess the value is clamped onto
  the NEW bound, putting it at exactly t=0 or t=1 — the common case, where an unclamped handle is
  sliced in half by the rail's rounded end. Change detection's `time_limit_ms` auto-submits a miss
  and now shows the countdown that governs it; it previously ran invisibly, so a player could be
  timed out with no warning.
- **Daily Royale integration** (`services/royale_sequencing.py`, `services/royale_rounds.py`): a
  Royale round can be a cognition type instead of trivia — the Royale stays the single daily
  object. **Two round classes:** ATOMIC (trivia/rapid_math/memory_flash) keep the unchanged
  one-opaque-submit contract; INTERACTIVE (`estimate`, `change_detection`) own a cognition
  `round_instance` **bound to `(entry_id, round_idx)`** (unique — no replay, and an instance
  played outside a Royale can't be submitted in), played through the standalone cognition
  endpoints, then finalized once via `/entries/{id}/answer`, which **bridges** the instance's
  outcome onto `(correct, time_frac)` → the ONE `compute_points` formula (no second economy;
  `entries.scoring_version = 3`). Types are a **constrained shuffle** pinned once on
  `contest_windows.round_plan` (slot 1 = visual/reaction opener, slot 8 = hardest available, ≤2 of
  any verb in 2–7, absent types dropped + backfilled; trivia-only day → the unchanged build path).
  Every registered cognition type is now Royale-eligible. The spoiler-free share grid moves onto
  the Royale results screen.

---

## 5e. Rot Rating (Glicko-2 sharpness rating)

The **headline profile "sharpness" number**, measuring how sharp a player is independent of who
else played that day. It is **PARALLEL to the placement Elo** (`profiles.rating`, §7b) and **must
never be merged with it** — placement Elo drives divisions/Gems/leaderboard; Rot Rating is the
profile number. Pure math in `services/glicko2.py` (validated against Glickman's published vector)
+ `services/rot_rating.py`; DB seam + wiring in `services/rot_rating_store.py`; tables in
`models/rot_rating.py`. **Never labeled or described as IQ** anywhere player-facing.

- **Round-as-opponent, updated at RUN COMPLETION.** Each Daily Royale round is one Glicko-2 game,
  **pass/fail** (the same `correct` the points bridge uses). One run = one rating period of 8
  games; the update fires in `contest.answer_round` when a royale entry's last round is answered —
  independent of the field and of settlement. Guests are excluded (a rating needs a saved profile,
  same rule as settlement). A trivia-only Royale is simply 8 `know` games.
- **Speed NEVER enters Rot Rating** — points reward speed, Rot Rating measures sharpness. Two
  numbers, two jobs; do not let them collapse. (This is why the round contributes only pass/fail.)
- **RD floor = 200** (`ROT_RD_FLOOR`), deliberately high: the number must visibly MOVE after a
  strong run, so we trade precision for responsiveness (retune DOWN once real distributions exist).
  Because RD never drops below the floor, **"provisional" keys off rounds played, not RD**
  (`ROT_PROVISIONAL_ROUNDS` / `ROT_SUB_PROVISIONAL_ROUNDS`).
- **Three sub-ratings** (`notice`/`estimate`/`know`), each a Glicko-2 updated only from that verb's
  rounds. The **headline is DERIVED** — precision-weighted mean of the played sub-ratings — so it
  can never disagree with its parts (an unplayed verb's prior is excluded).
- **Difficulty behind a resolvable key** (`difficulty_key` → `"<verb>:<band>"` today,
  `"<verb>:item:<uuid>"` later with no rewrite), seeded from the band (`ROT_DIFFICULTY_SEED`).
  **Trivia (`know`) difficulties are the FIXED ANCHOR** — never converge, so the 956-item corpus is
  the stable reference scale. **Only `estimate`/`notice` float** (`ROT_FLOATING_VERBS`): they
  converge on observed pass rate in a **once-daily batch** (`converge_difficulties`, CLI
  `run rot-converge`), which then **re-centres each verb's pool to its seed mean** so a strong
  cohort can't co-inflate player + item ratings. The batch is **NOT idempotent** (game counts
  accumulate), so it **claims the ET day EXACTLY-ONCE** (`rot_difficulty_batches`, INSERT … ON
  CONFLICT DO NOTHING) — a redundant fire is a clean no-op. It runs at **12:15 AM ET alongside
  settle**: the daemon `rot_difficulty_converge` cron and the Render `rot-royale-rot-converge` cron
  (dual-UTC `15 4,5`); it targets `now_ET − 1 day` (always a closed day), and the guard makes the
  DST-wrong / redundant fire a no-op. **Never fold it into the `both` heartbeat.**
- **Exposure:** `GET /me/rot-rating` → headline rating, provisional, rounds played, `last_change`
  (up/down/flat — stored, not derivable), version, and the three sub-ratings. Seed payload before a
  first ranked run. `ROT_RATING_VERSION` pins semantics; exposures must not mix versions.

---

## 5f. Daily Royale trivia second-chance

A WRONG **first pick** on a ranked **Daily Royale trivia** round (base timer stays **10s**) does NOT
end the round: the picked option greys out (unclickable) and the player gets a fixed
`TRIVIA_RETRY_MS` (=4000) window to pick once more for **HALF points**
(`compute_points(..., half=True)`). Ranked Daily Royale trivia ONLY — practice/campaign/duels and
`rapid_math` are unchanged (`retry_eligible = window.slot=="royale" and module_type=="trivia"`).

- **Opt-in per client — the offer is a BREAKING protocol change.** `AnswerRoundRequest.supports_retry`
  defaults to **False**, and only a request that sets it can be offered a retry. Withholding the
  `RoundResult` is correct for a client that knows to re-answer the same `idx` and **fatal** for one
  that does not: the shipped App Store binary predates §5f, read the offer as an ordinary reveal,
  advanced, and then wedged on the sequence guard at the next round — a white screen, mid-run, with
  no recovery. Native binaries cannot be rolled back, so a change to what `/answer` RETURNS is only
  safe behind a flag the old build cannot set (§7c: widen inputs freely, never narrow — and never
  change a response shape a shipped client already parses).
- **Two-attempt protocol, server-authoritative.** `contest.answer_round` is called twice for the
  same `idx`. Attempt 1 wrong+picked → sets `round_answers.retry = {choice, at}`, returns
  `retry_available/eliminated/retry_ms` and does **NOT** create a `RoundResult` (so the sequence
  guard still blocks the next idx) — the round is unfinalized; see the opt-in above. Attempt 2 reads/clears `retry`,
  scores, and finalizes. A **TIMEOUT (choice is None)** has no option to grey, so it finalizes as a
  normal miss (no retry) — otherwise the client, unable to re-arm, would desync from a pending round.
- **A retry-correct COUNTS as correct** — it continues the in-run streak and is a Rot Rating **pass**
  (`RoundResult.correct=True`, flag `retry`); only the points are halved. A second wrong pick,
  re-sending the greyed option, or a lapsed window ends the round at **0**.
- **Anti-cheat.** The answer is **NEVER revealed on the offer** (`server_answer={}`); the client
  learns only that its own pick was wrong (3 options remain) — a bounded, deliberate relaxation of
  Invariant 1. The retry re-arms the SAME round (no reveal/splash), so its speed is scored against
  the **base limit** (not the 4s window) with the elapsed floored to the server-measured retry gap
  (the 4s is the deadline) — this keeps a round's `time_frac` reconstructing identically whether or
  not it was retried, which the Rot Report rebuild (§rot_report) depends on.
- **Client** (`MultipleChoiceRound` + `pacing` `RETRY` event): on `retry_available`, Contest
  dispatches `RETRY` (holding → playing, no reveal) and the module greys `eliminated`, restarts the
  countdown on the retry window, and accepts one more pick. Scoped by the server only sending
  `retry_available` for royale trivia; the props are optional across the shared module contract.

---

## 6. Timezone / DST rules

**CRITICAL — get this wrong and every window drifts an hour for ~8 months of the year.**

One daily contest — the **Daily Royale** — defined in **wall-clock America/New_York**:

| Slot   | Opens (ET)      | Closes (ET)           | Settles (ET)          |
|--------|-----------------|-----------------------|-----------------------|
| royale | 12:00 AM        | 12:00 AM the next day | 12:15 AM the next day |

A full **24-hour window** — no time limit, open all day, midnight-to-midnight ET; the player takes
their one run whenever they like that day. The window's `close_is_next_day` flag means close is read
on the next calendar date, so on a DST-change date the window is 23h (spring forward) or 25h (fall
back). `settle_at = close_at + SETTLE_DELAY_MINUTES` (=15). One `royale` window per ET date.

> **Legacy slots (history only).** `WINDOW_SLOTS` (`app/core/timezone.py`) keeps the legacy
> `morning`/`midday`/`night` entries so `window_bounds_utc` still computes correct UTC instants for
> old data, history, admin/debug and legacy tests. **`PROVISIONED_SLOTS = ("royale",)` is the only
> slot created going forward** (`create_windows_for_date` loops `PROVISIONED_SLOTS`).

Rules *(Invariant 3)*:
- Compute all window times in `America/New_York` with `zoneinfo` (`ZoneInfo("America/New_York")`).
  The helper lives in `backend/app/core/timezone.py`.
- **Never hardcode a UTC offset** (`-05:00` / `-04:00`). ET shifts with DST; a fixed offset silently
  moves every window by an hour for most of the year.
- Store `open_at`/`close_at` as UTC `timestamptz`, **computed from** the ET wall-clock definition for
  each calendar date.
- All DB timestamps are `timestamptz` (UTC); all ids are UUID v4.
- **Time LABELS in the UI are viewer-local** — the client formats the UTC instants in the viewer's
  locale and timezone — while the contest itself is **defined in ET wall-clock**. These never
  conflict: ET defines when the window opens/closes/settles; the UI just shows that instant in the
  player's own time. i18n number/date formatting follows the **in-app** language, not the browser
  locale (`src/i18n/format.ts`).

---

## 7. Theming, visual identity & copy honesty

> **For UI / game-feel work, load `.claude/skills/game-ui-design/SKILL.md` first** (or invoke
> `/game-ui-design`). It is the working method — premium game-UI direction, quest/progression design,
> the plan-before-coding step, reduced-motion and performance expectations. `DESIGN.md` remains the
> visual spec. Neither is duplicated here.

One object per theme: `{ id, name, cost, style, blurb, vars, art? }`. `style` ∈
`arcade | soft | pixel | mono` (swaps fonts/shape/texture via a root class `rr-root s-<style>`).
`vars` are CSS custom properties applied at the root. Theme `vars` live in shared code; **ownership +
equipped state live in the DB** (`user_themes`, `profiles.equipped_theme`).

> **THE THREE UNIQUE THEMES ARE FROZEN.** `blank_light` (Minimal Light), `blank` (Minimal Dark) and
> `royale` (Rot Champion) are not skins — they carry no `art` set and render through different
> branches, and their look must NOT be changed by Starter-system work. An instruction about "the
> app", "the card" or "the screen" means the Starter system and its skins; these three change only
> when named explicitly. See `UNIQUE_THEME_IDS` / `isUniqueTheme()` in `theme/tokens.ts`.

**Default theme is `starter`** (style `mono`) — the app's main identity: a premium ivory world with
royal-purple + gold accents, an elegant display serif, and the Starter art set
(`frontend/public/assets/themes/starter/`; `Theme.art` + `useThemeArt()`). **Every catalog theme
except the Minimal pair and Rot Champion is a SKIN of the Starter system** (shared `STARTER_SHAPE` +
art, different palette). The Minimal pair (`blank_light` / `blank`) keeps its art-less ink-on-paper
minimalism; `royale` ("Rot Champion", style `arcade`) is the founder exclusive; `daylight` is free
but earned. **Green = correct, red = wrong/live** throughout. Every theme carries
`--brand`/`--brand-2`/`--faint` and a non-blue `--cyan`. `DEFAULT_THEME_ID` is `starter` on both
sides (`theme/tokens.ts`, `core/constants.py`).

**Roughly half the catalog is light and half is dark.** Prefer deriving a colour from a theme token
(`color-mix(… , var(--panel))`, `var(--text)`) over hardcoding a hex or branching on theme id — one
definition then renders correctly everywhere, and a new theme inherits it for free.

- **Reusable motion/UI primitives** live in `frontend/src/ui/` — `Confetti`, `CountUp`,
  `CountdownRing`, `AnswerPill`, `GoldButton`, `GlassCard`, `Display`, `PromptText`, `RoundHeader`,
  `CategorySplash`, `Starfield`, `useReducedMotion`. Reuse them; don't re-roll effects per screen.
  > **Every DOM round module wears the same chrome**: `RoundHeader` above the card, `GlassCard`
  > around it, `PromptText` for the question, `GoldButton` for the commit action. The two
  > interactive cognition rounds (estimate, change detection) were exempt from this for a long time
  > and shipped into the ranked Royale as literal white boxes with `2px solid #111` borders — their
  > own docstrings said "deliberately unthemed", which stopped being true the day they entered the
  > Daily Royale. `RoundHeader` takes an optional `label` (a verb, for rounds with no category) and
  > an optional `right` slot (estimate is guess-limited, not timed, so it shows guess pips rather
  > than faking a countdown). All are
  `prefers-reduced-motion`-aware (`@media` in `global.css` + the hook): decorative motion drops,
  state changes stay. Keep effects GPU-cheap (transform/opacity).
- **Anti-cheat shapes the UX:** the client never has the answer mid-round, so questions stay calm
  (ring timer + select-lock); the green/red reveal, confetti and score count-up happen on the
  **results** screen, where the submit response surfaces each round's server answer post-lock.
- **The share card is themed SERVER-side, from a generated palette.** `…/c/<id>/og.png` (the link
  unfurl — the product's main acquisition surface) and the `ChallengeLanding` both paint themselves
  in the **sharer's currently equipped theme**, read live from their profile rather than snapshotted
  at share time, so re-equipping restyles links already sent. Pillow can't read `tokens.ts`, so
  `frontend/scripts/export-theme-palette.mjs` transpiles it and writes
  `backend/content/theme_palette.json`. **Never hand-edit that JSON** — change the theme in
  `tokens.ts` and run `npm run export:palette`; `backend/tests/test_theme_palette.py` regenerates
  and diffs, so a stale palette fails the suite. Only flat colours are exported: CSS gradients
  (`--bg`, `--cta`) can't be evaluated by Pillow, and the card derives its own ramp instead.
  The display faces are **committed** at `backend/app/assets/fonts/` for the same reason — a crawler
  never runs the Google-Fonts `@import`, and Pillow's built-in bitmap face is illegible at headline
  sizes. See `NOTICE.md` there for the licences (OFL-1.1 / Apache-2.0; don't rename the TTFs).
- **Assets in `public/` are NOT content-hashed by Vite.** Re-exporting art under the same URL leaves
  every browser that already fetched it serving the old bytes forever. **Bump the `?v=` on the token
  in `theme/tokens.ts` whenever you replace one.** When adjusting art, measure the file (alpha,
  rims, bounding boxes) rather than trusting a preview — a transparency checkerboard flattened into
  real pixels looks identical to transparency until you read the alpha channel.
- **Ship art at 3× its render size, not at master resolution.** `frontend/scripts/optimize_images.py`
  owns this: it resizes to 3× the measured display size (3× covers the densest phone; targets are
  derived from `getBoundingClientRect` on the running app plus the `size=` call sites, and are listed
  in the script). Re-run it after adding or re-exporting art; it prints the `public/` files whose
  `?v=` then needs bumping. Every image once shipped at master res — Home pulled **1.78 MB** to paint
  37–46 px avatars and 44 px icons, which was 15× the whole JS bundle. It is now ~179 KB. **The
  bottleneck on this app is images, not JavaScript** — check the image payload before optimising
  anything else.
  - **Quantisation is gated on whether the render size is KNOWN, and that distinction is load-bearing
    — it was learned the hard way.** A single RMSE limit for everything shipped a regression:
    `background_art_starter.png`, the full-screen backdrop behind the new-user screen, collapsed from
    128 colours to six and lost the golden halo through its centre, at an RMSE of 3.84 — because
    per-pixel error barely moves when a large low-contrast wash loses its structure. Only assets with
    a `RESIZE_TARGETS` entry (measured render size, so quantisation noise is averaged away by a 6×
    downscale, and each was checked by eye at that size) get the loose gate. Backdrops, scenes and
    glows must be near-lossless or they keep full colour. **Don't "improve" compression by widening
    the strict gate** — that is exactly the change that broke it.
  - **No WebP.** `ios/App` pins `IPHONEOS_DEPLOYMENT_TARGET = 13.0` and WKWebView only gained WebP in
    iOS 14, so WebP would silently break every image for iOS 13 users. It is worth ~3× more; raising
    the deployment target is the prerequisite, not a detail to skip.
  - **Known defect, deliberately not fixed:** the four Blank-theme line-art marks
    (`public/avatars/{knight,bishop,rook,crescent}.png`) each carry a transparency checkerboard
    flattened into opaque pixels — alternating 246–252 grey squares, alpha 255 everywhere. That noise
    is why they cost ~90 KB each instead of ~3 KB. They are in the script's `PRESERVE_COLOR` list so
    compression cannot quietly repaint them; cleaning the checkerboard is an art call and needs a
    human. (Only the Blank pair renders these, so they are not on the default cold-start path.)

**Honesty / copy rules (DESIGN §7) are mandatory in any player-facing string** *(Invariant 6)*:
- Coins and Gems — never cash / prize / bet / jackpot / gambling framing, in **any** language.
  `frontend/src/i18n/copyGuard.ts` is the single source of truth for the banned lists and is enforced
  by tests across every locale and on rendered markup.
- "Windowed / open until", never broadcast-live. **No fake chat and no concurrent-viewer counts.**
- **Counts must be real, never invented.** Field counts come from real entries. Saying "**8
  players**" is correct and preferred — the field is real entries only (§7b), so the count is true.
  ("player" was banned only while cold-start bots padded the field; that ban is gone. What stays
  banned is a fabricated number, in any wording.)
- i18n is compile-enforced: `Dict = typeof en`, so `es`/`fr`/`tr` must supply every key or the build
  fails. Server error **codes** (snake_case) map to localized text in `i18n/errors.ts` — **never
  render a raw server string to a player.**

---

## 7b. Settlement

`services/settlement.py::settle_window` ranks SUBMITTED entries (score desc, then faster average
`time_frac`), applies Elo rating + division, advances the daily streak, writes `standings`, and marks
the window SETTLED.

- **The streak keys off `window.contest_date`, NOT settlement wall-clock.** The Daily Royale closes
  at midnight and settles at 12:15 AM the *next* ET date, so keying off the clock would break every
  streak. A single missed day is forgiven once per ISO week (the weekly grace).
- **Ranked pays NO coins:** every coin constant is 0 and settlement writes no coin ledger rows —
  coins are earned in campaign/practice and spent in the Vault. It does grant **Gems** (royale slot
  only): a one-time starter grant plus the single highest applicable placement tier (tiers never
  stack), and streak-milestone rewards at days 3/5/7. All gem grants are idempotency-keyed, so a
  re-settle never double-grants.
- **Gated to 12:15 AM ET:** settlement runs only once `now >= settle_at`
  (`close_at + SETTLE_DELAY_MINUTES`), enforced by `jobs/tasks.py::settle_due_windows`. Driven by the
  targeted 12:15-ET settle (daemon ET cron + Render `15 4,5 * * *` dual-UTC cron) with the heartbeat
  tick as a fallback. **Never lazy / on-read.**
- **Exactly-once + atomic:** `settle_window` locks the window row (`FOR UPDATE`) and acts only if
  `state == CLOSED`; it **never commits** — the worker commits once, so the SETTLED flip and every
  profile/standing write land in one transaction. Safe under multiple instances.
- **Guests are excluded** from ranking/rating/streak/standings/gems at settle time: leaderboard
  permanence requires a saved profile. Play paths are never gated.
- **The field is REAL ENTRIES ONLY — there are no bots in the Daily Royale** *(Invariant 5)*.
  Cold-start bots once padded a thin field in memory; they were removed along with `MIN_FIELD_SIZE`.
  A placement always describes people who actually played, so "3rd of 8" means eight humans entered.
  A solo day settles as 1st of 1 and moves no rating (`rating_delta` returns 0 for `field_size <= 1`)
  rather than inventing an opponent. **Duel rivals are the one exception** — an explicit, disclosed
  1v1 practice partner, never a leaderboard entrant and never counted in a field size
  (`services/bots.py` keeps `make_duel_rival` + `window_seed` and nothing else).
  `tests/test_no_synthetic_field.py` pins this, including that the field-fill helpers stay deleted.
- Surfaced via `GET /contests/{id}/standings` and `GET /me/history` (results-on-next-open).

---

## 7b2. One-time prompts (`services/prompts.py`, `screens/prompts/`)

Notification opt-in, the App Store rating ask, and one-off apologies are **decided on the server**
(`GET /me/prompt` → one id or null; `POST /me/prompt/ack` retires it). The client renders what it's
told and nothing else, so the timing rules below are tunable on a deploy rather than an App Store
release — §7c is the reason.

- **Never on first open.** Nothing is offered until the player has FINISHED a Daily Royale
  (`royales_completed`, SUBMITTED entries only). On iOS the OS permission alert fires exactly once
  per install; spending it on a player who hasn't enjoyed anything yet buys a permanent no.
  Notifications ride the 1st finished run, the rating ask waits for the 3rd.
- **One at a time.** Both can come due together; the queue drains one per return-to-home in priority
  order (apology → notifications → rating). Stacking asks is how an app gets muted.
- **Never a pointless ask.** A player with any `push_subscriptions` row is skipped past the
  notification prompt; the apology only shows to accounts that actually hold a goodwill ledger row.
- **Unknown ids render nothing.** A prompt shipped to newer clients must be silently ignored by
  older ones — the forward-compatible half of §7c, and the exact mistake §5f made in reverse.
- Acks are SERVER-side (`user_prompt_acks`), so an answer survives a reinstall and doesn't reappear
  on a second device. Asking twice reads as nagging.
- The rating ask uses Apple's native **SKStoreReviewController** (@capacitor-community/in-app-review),
  falling back to a store link on web and on any binary built before the plugin existed. Apple
  throttles the sheet (~3/year) and shows NOTHING when it declines — no callback, no error — so a
  link fallback on native is impossible: we can't tell suppression from shown-and-dismissed. That
  silence is why the ask is rationed to the third completed run. **It never appears in TestFlight
  builds** — that is Apple, not a bug.
- The rating ask is TWO steps: "enjoying it?" → yes goes to the store sheet, **no goes to /support**.
  With only three prompts a year and no signal about what happened, spending one on an unhappy
  player wastes it and invites a one-star review. A feedback answer is never acked as a rating.

## 7a2. Change detection announces each frame

The cycle is **beat → base → beat → altered**, looping. Each titled beat ("First image" / "Second
image") LEADS the frame it names, staged in the category splash's language (diamond hairline +
Display serif) but sized to the image frame rather than the screen. Before this the player was shown
two pictures with nothing naming them and had to infer which was which from the image changing under
them.

- `flicker_label_ms` is a NEW spec field (§7c), not a change to `flicker_blank_ms`. The shipped
  binary knows only the blank; stretching that from 80ms to ~1s would slow its wipe to a crawl.
- **The wipe and the announcement are separate.** Frames 0/2 always hide both images (that gap is
  what prevents a direct visual comparison); the TEXT is drawn only when `flicker_label_ms >=
  MIN_READABLE_LABEL_MS`. A legacy round plan carries only the 80ms blank, and a word flashed for
  80ms is noise, not an announcement.
- The header's per-frame countdown is hidden during a beat — the beat is the announcement, and a
  second countdown just races the words being read.
- **Cycle budget — load-bearing, and asserted** (`test_two_full_cycles_fit_the_round_limit`).
  1.3 + 5 + 1.3 + 7 = 14.6s, so two COMPLETE cycles (29.2s) fit the 30s limit with ~0.8s spare. The
  altered frame is 7s rather than 8s precisely to buy that: at 8s the second look was cut ~1.2s
  short, and two clean looks beat one long look plus a truncated one — a frame that vanishes
  mid-search reads as the game taking it away. Costs 0.8s of total viewing (14s vs 14.8s).
  `CHANGE_TIME_LIMIT_MS` cannot simply be raised to make room: points slide MAX→MIN across it, so
  stretching it re-prices every round. Move the phases and the limit together, or not at all.

## 7a1. A round module owns its REVEAL (`RoundModule.Reveal`)

The generic reveal can only render a trivia option list. Every other type fell through to one line
of grey text ("counted" / "no points"), which threw away the round's payoff: a change round never
showed WHERE the change was, and a Fermi estimate never said the answer — the single most
interesting thing about that question type.

- A module may export an optional `Reveal`. `RevealView` renders it INSTEAD of the fallback line.
- It receives `answer` (the server_answer, released only after the round is finalized, so showing it
  is safe under Invariant 1) and `result` — what the module itself reported at completion. The wire
  carries neither the tap the player made nor their final guess, so the module passes its own memory
  up: `ChangeRound` adds `tap`, `EstimateRound` adds `final_guess`. Sending a player's OWN input back
  is not a leak.
- Looked up with **`tryGetModule`**, never `getModule` — the latter throws, and a decoration must
  never be able to unmount the app over an unrecognised type (§ErrorBoundary).
- Estimate expresses the miss as a **RATIO** ("1.8x low"), not a difference: these questions span
  orders of magnitude, where "450 off" is a good guess of a thousand and a terrible guess of ten.

## 7b1. Touch feedback (`lib/haptics.ts`)

**iOS does not implement `navigator.vibrate`** — not in Safari, not in a WKWebView. Every haptic in
the app was a silent no-op on iPhone until this module existed. Anything that wants to be felt on a
phone must go through `feedback()`, which routes to `@capacitor/haptics` (UIImpactFeedbackGenerator /
UINotificationFeedbackGenerator) on native and degrades to `vibrate` on the web.

- **Speak in INTENT, not milliseconds** (`selection` / `light` / `medium` / `heavy` / `success` /
  `warning` / `error`). iOS exposes STYLES, not durations; a number can only be approximated, and
  approximating it is how haptics end up feeling like a cheap rumble. `sfx.haptic(ms)` still works
  for old call sites but maps onto these.
- **Fire on POINTER DOWN, never on click.** The tick has to land with the finger; waiting for the
  click event puts it after the decision and reads as lag. This is most of the difference between
  an app that feels responsive and one that doesn't.
- An OUTCOME (correct/wrong) uses the notification styles, which are patterns — distinct from the
  tap that caused it. Key the effect on the round index so it fires once per reveal, not per render.
- Governed by the existing sound preference (`setSfxEnabled`), applied at module load so a muted
  player is muted from the first call.

## 7b2b. iOS push registration + provisional (quiet) authorization

**`AppDelegate.swift` MUST post the two Capacitor notifications** (`didRegisterForRemoteNotifications
WithDeviceToken` / `didFailToRegister…`). They were missing, and nothing about that failure is
visible: `registerAndGetToken()` simply waits out its 8s timeout, returns null, and the toggle stays
off. Every iOS opt-in had failed silently, which is why production held ZERO iOS subscriptions. If
iOS push ever goes quiet again, check this file first.

**Provisional authorization** is requested at launch for every install: permission with NO prompt,
delivered quietly to Notification Center. It does **not** consume the one-time system alert, so the
in-app ask can still upgrade the player to prominent delivery later — it is additive, not a trade.

- **Quiet registration is REACH, NOT CONSENT.** `push_subscriptions.provisional` marks it, and
  `prompts._has_push` counts only non-provisional rows, so a quietly-registered player is still
  asked to upgrade. Getting this backwards would strand them on notifications nobody notices.
- **Percentage rollout** (`push_provisional_rollout_pct`, default **0** — off). The evidence for
  provisional is thin (one growth team measured no difference in opt-in or retention), so it rolls
  out by cohort. Membership is a stable hash of the user id: raising the percentage only ever ADDS
  players, never orphaning a device that already registered a quiet token.
- Accepting the real prompt re-registers the SAME token with `provisional=False`; the upsert writes
  the flag, or the player would be asked forever.

## 7b3. Daily pushes are scheduled in the PLAYER'S timezone

At most **two automated pushes a day**, both in the player's own evening (`profiles.timezone`,
reported by the client; ET when unknown — see `services/localtime.py`).

- **14:00 local — daily reminder.** Only to subscribers who haven't played the open window. The hour
  is a FLOOR, not an exact time: the heartbeat sends at or after it and the once-per-ET-day gate
  stops a repeat, so a missed cron tick still delivers instead of skipping the day. Quiet hours
  close the band at 21:00.
- **20:00 local — streak risk.** Only for `streak_count >= 3` and still unplayed. Distinct from
  `streak_saved`, which reports a streak that ALREADY survived. Six hours after the reminder, so
  the two can never read as one burst and the player has the whole evening to act.
- **Quiet hours are LOCAL (21:00–08:00), not ET.** This was the trap: 8 PM in California is 11 PM
  ET, so the old ET-only guard silently blocked the very push it was meant to time. Any new
  evening-scheduled send must pass the player's zone to `can_send`.
- **Spacing.** No automated push within `MIN_AUTOMATED_GAP_MINUTES` (30) of the last, so a heartbeat
  that first sees a player after BOTH are due defers the second instead of firing them together.
  Claims stamp `created_at` with the CALLER's clock so the rule is testable under an injected time.
- `jobs.run play-times` prints when players actually finish runs, in their own local hours — the
  evidence for tuning the reminder hour. A flat histogram means too small a sample; leave it alone.

## 7c. Two release trains: the web deploy and the app binary

**The server must never require a client change.** rotroyale.live updates the moment you deploy;
the iOS/Android binary updates when Apple says so. Every installed app is running whatever web
bundle was frozen into it, so the oldest binary in the wild — not the current source — is the
compatibility floor.

Both halves of the 2026-08-14 outage were this one mistake, and both were SILENT:

- **A tightened schema is a breaking change.** Change-detection timeouts were narrowed from
  "any coordinate" to 0..1, but every shipped binary sends `(-1, -1)` for "timed out, no tap". The
  422 left the cognition instance unresolved and the Royale bridge 409ing behind it — players
  stranded mid-run, unable to finish. The server now accepts the legacy sentinel and will keep
  doing so until the installed base turns over. Widen inputs freely; never narrow them.
- **Relative asset URLs resolve against the APP BUNDLE.** Capacitor has no `server.url` (it loads
  `webDir` from disk), so `/assets/change/x.jpg` is looked up inside the binary, not on the server.
  Content added after a binary shipped simply 404s there: a blank frame, nothing to find, a
  guaranteed miss, and nothing in any log to notice. `services/cognition._asset_url` makes those
  absolute against `web_base_url`. Anything a shipped client cannot resolve must be resolved FOR
  it, server-side.

**The service worker must never run inside the native app** (`main.tsx`; `injectRegister: null` in
vite.config so registration is ours to gate, not auto-injected into index.html). On the web it is
the PWA; inside Capacitor it earns nothing — the build is already on disk — and it is what would
break over-the-air updates, because the bundled build and any live-updated build share one origin.
A worker precaching index.html would keep serving the OLD one and its old hashed chunk names: the
update silently never applies, or the app white-screens on chunks the new bundle does not contain.
The native branch also unregisters workers left by earlier binaries.

## 8. Currency invariants — coins & Gems

Coins and Gems are in-app closed-loop currencies: **earned only, never purchasable, cashable or
transferable in v1.** Cosmetics bought with them never grant a competitive advantage.

**Both ledgers are append-only and are the source of truth** *(Invariant 2)*. Every movement is an
immutable row with a `reason` + reference; `profiles.coins_balance` and `profiles.gems_balance` are
**caches that must always equal their ledger sum**. **Never mutate a balance without writing a
ledger row** — `services/ledger.py::record_coin_delta` and `services/gem_ledger.py::record_gem_delta`
are the only chokepoints. Zero-value writes are skipped so the ledgers never carry no-op rows.

The gem ledger adds two guarantees the coin ledger does not have:
- **Idempotency** — pass a stable `idempotency_key` for a one-time grant; a repeat returns the
  existing row and writes nothing (DB-enforced by a partial unique index, race-safe via a SAVEPOINT).
- **Non-negative balance** — a debit that would drive `gems_balance` below 0 raises
  `InsufficientGemsError` and writes nothing.

Build on the ledgers even where v1 has no money: they are the seam money plugs into later
(PLAN.md §6, §13). Services never commit — the request boundary commits once.

---

## 8a. Auth & sessions

- **Password hashing:** argon2 (`app/core/security.py`) — never store or log plaintext.
- **JWT:** stateless HS256; a `type` claim separates `access` (~30 min) from `refresh` (~30 days).
  `SECRET_KEY` + TTLs are env-driven and the dev default is insecure — it must be overridden in prod.
  No server-side session/revocation table in v1 (intentional).
- **Frontend token handling:** the access token lives in memory only (Zustand, never persisted); the
  refresh token lives in Capacitor Preferences (`tokenStorage.ts`) so a session survives app
  restarts. First render is gated on session restore (`status: "bootstrapping"`) so a cold start
  never flashes the login screen. A 401 triggers a single-flight refresh-and-retry. Preferences is
  Keychain/Keystore-adjacent on native; on web it is backed by localStorage (a dedicated
  secure-storage plugin is the native upgrade path, not built in v1).
- **Tunable economy/game constants** (`STARTING_COINS`, `STARTING_GEMS`, `STARTING_RATING`,
  `DEFAULT_THEME_ID`, `RATING_K`, `SETTLE_DELAY_MINUTES`) live in `app/core/constants.py`. Any
  starting balance flows through its ledger, never straight onto the cache.

---

## 9. Working conventions

- **Server-authoritative everything** that affects scores, coins, gems, rating or standings. Treat
  all client input as untrusted.
- **Settlement happens at window close**, not at submit. Placement/rating/streak/gems finalize in the
  settlement job (§7b) and surface to the player on next open.
- **One entry per user per window** (unique constraint on `entries(window_id, user_id)`); the entry
  `seed` is fixed at creation — no reroll.
- **Seed source depends on the mode.** The ranked **Daily Royale uses a SHARED per-window seed**
  (`window_seed(window)` = `contest_date` + slot): every player that day gets the **identical 8
  questions in the identical option order** — Wordle-style — so the leaderboard and "beat my score"
  shares are apples-to-apples (`services/contest.py::enter_contest`). This deliberately **reverses
  the older per-entry anti-cheat seed, for the Daily Royale only**: same-for-all is leakable within
  the 24h window, an accepted trade-off for a currency-only, server-validated contest (answers still
  never leave the server; client scores are still ignored). **Every other mode keeps its own
  per-run seed** — practice, category sessions, campaign and duels aren't leaderboard-comparable, so
  per-run variety stays. An entry remains regenerable from its stored seed.
- **Share links expire** when their Daily Royale window closes: a public snapshot carries a username,
  score and placement, and once the link can no longer do its job that exposure has no purpose.
  Expired links are indistinguishable from nonexistent ones, and the rows are purged.
- Keep modules self-contained; the contest engine iterates the registry and never knows module
  internals.
- Don't architecturally preclude later money/multiplayer, but don't build v1 non-goals (PLAN.md §13).
- **Git:** a feature branch per unit of work. **Commit and push only when the user asks.**
