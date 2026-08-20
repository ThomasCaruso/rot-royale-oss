# Rot Royale

Windowed-async skill-contest game. See **[PLAN.md](./PLAN.md)** for the full spec and
**[CLAUDE.md](./CLAUDE.md)** for repo conventions, commands, and the ET/DST + module-registry rules.

## Layout

```
frontend/   Vite + React + TS SPA (+ Phaser, Capacitor)
backend/    FastAPI + SQLAlchemy async + Alembic
docker-compose.yml   local Postgres (this machine uses native Postgres 16 instead — see CLAUDE.md §4)
```

## Quick start (local dev)

1. **Postgres** — create the role + db once (no Docker on this machine):
   ```
   & 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres `
     -c "CREATE ROLE rot_royale LOGIN PASSWORD 'rot_royale';" `
     -c "CREATE DATABASE rot_royale OWNER rot_royale;"
   ```
   (With Docker: `docker compose up -d`.)
2. **Backend** — `cd backend; uv sync; uv run uvicorn app.main:app --reload` → http://localhost:8000
   Health check: `GET /health` → `{"status":"ok","db":"ok"}`.
3. **Frontend** — `cd frontend; npm install; npm run dev` → http://localhost:5173

Current milestone: **M2 (contest engine + windows + trivia)** complete — ET/DST-correct windows
with scheduler + lazy state transitions, seeded reproducible round sets, the round-module registry
(server + client), the trivia module end-to-end with the `client_spec`/`server_answer` anti-cheat
split, `enter`/`submit` with server-authoritative scoring, and the ported contest UI (category
splash → timed round → server-scored results).

**M3 (scheduler daemon)** complete — APScheduler runs in the app lifespan: a transition tick flips
windows SCHEDULED→OPEN→CLOSED on a timer, and a 00:30-ET cron provisions next-day windows
(verified live; windows observably transitioned on the timer). Forced spring-forward/fall-back tests
pin the DST-correct UTC instants.

**M4 (more modules + templates)** complete — `rapid_math` and `memory_flash` added through the
existing registry (engine untouched); `memory_flash` submits taps + per-tap timestamps, scored
server-side against the stored sequence. Submit is now module-agnostic (opaque per-round `result`).
Per-slot mixed templates (morning/midday/night) produce different compositions; verified live — a
night contest rendered + scored a mixed trivia/rapid_math/memory_flash round set end-to-end.

**UI re-skin → `royale` identity** complete (presentation-layer only; engine/scoring/scheduler
untouched). New default theme `royale` + art style `arcade`: dark violet world, glowing gold CTAs,
gold circular countdown ring, green-correct/red-wrong answer pills with A/B/C/D badges, 3D display
headings, glassy cards, confetti + score count-up on results, starfield background. Reusable
motion primitives in `src/ui/`, `prefers-reduced-motion` honored, WCAG-AA on dark. Honesty rules
enforced (coins not cash, windowed not broadcast, real field counts — no fake chat/viewer numbers).
See **[DESIGN.md](./DESIGN.md)**.

**M5 (settlement)** complete — at window close, settlement ranks the field (score, then speed),
pays coins via the append-only ledger (placement bracket + streak bonus), applies Elo rating +
division, advances the daily ET streak, and writes standings. **Exactly-once + atomic** (window-row
`FOR UPDATE` + state guard; one commit so coins and the SETTLED flip land together). Cold-start
**bots pad the field in memory only** (never persisted/paid — so entry counts stay honest). Wired
into the daemon tick + a `python -m app.jobs.run settle` cron entrypoint. `GET
/contests/{id}/standings` + `GET /me/history`; results surface as a banner on next open. Verified
live: a closed window settled and placements/coins/rating/streak applied. Also hardened
memory_flash plausibility (payout-affecting).

**M6 (categories + review-gated content ingestion)** complete — the active round modules are now
**`trivia`, `rapid_math`, `memory_flash`** (the experimental `pattern_sequence`/`odd_one_out` visual
mini-games were removed — testers found them incoherent/too-easy; the earlier `tap_target` Phaser
game was removed before that). The questions schema was widened: `difficulty` enum (easy/medium/hard),
`status` enum (draft/approved/live), and `explanation` — and the **serving gate is `status`**, so
only `approved`/`live` content reaches a player (`draft` is staged). The **canonical six categories**
are locked — `Science & Nature`, `History`, `Geography`, `Arts & Literature`, `Sports`,
`Pop Culture & Entertainment` — with the legacy nine-category seed folded into them (data migration);
ingest rejects any other category so typos can't spawn near-duplicates. A **review-gated ingest
command** (`python -m app.jobs.run ingest <file.json>`) loads a reviewed JSON bank as `approved`,
validating each row (4 options, correct_index 0–3, canonical category, valid difficulty, non-empty
explanation), deduping on (question, category) against the DB and in-file, and reporting
added/skipped/rejected — malformed rows are rejected loudly (non-zero exit), never silently dropped
(`confidence` is a review aid, never stored). Players can pick a category for a **no-stakes
category-scoped 10-question trivia session** with a weighted difficulty mix; **ranked windows stay
mixed across all categories** (no category pick) for fair comparability. Verified: ingest
validate/dedupe/reject + serving-gate + category-scope + difficulty-mix tests (backend), category
picker render + scope (frontend), end-to-end CLI ingest against a placeholder bank. Phaser remains
unused scaffolding for the §10 hub scene. _(Roadmap reordered from PLAN.md §12 at the owner's
request.)_
