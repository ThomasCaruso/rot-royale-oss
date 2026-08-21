# Rot Royale

A windowed-async skill-contest game. One eight-question **Daily Royale** per ET day, inside a
24-hour window, scored against everyone else who played that day.

FastAPI + PostgreSQL behind a Vite/React SPA, wrapped for iOS and Android with Capacitor.

---

## What this repository is

**The engine, complete and runnable.** Clone it, point it at a Postgres, and you get a working game
— contest windows, scoring, settlement, campaign, cognition rounds, duels, the lot — running on a
synthetic sample corpus authored for this purpose.

**What it does not contain is the production content.** The real question banks, the campaign
topology, the change-detection imagery and the artwork are not here. That is deliberate:

- Publishing the questions would spoil live answers for people playing today.
- The artwork is the game's visual identity, and it is not being given away.

Those live in a private package the deployment fetches at build time, pinned to an immutable
revision (`backend/scripts/fetch_private_content.py`). Everything needed to *run* the game is in
this repository; what is missing is the specific game rather than the machinery.

Artwork ships here as dimension-accurate placeholders — flat panels at the exact sizes of the real
assets. The app builds and lays out correctly; it just wears different clothes.

---

## Running it

Prerequisites: Python 3.12+, Node 20+, PostgreSQL 16, and [uv](https://docs.astral.sh/uv/).

```bash
# database
createdb rot_royale
psql -c "CREATE ROLE rot_royale LOGIN PASSWORD 'rot_royale';" -c "ALTER DATABASE rot_royale OWNER TO rot_royale;"

# backend
cd backend
cp .env.example .env
uv sync
uv run alembic upgrade head

# Load the synthetic sample corpus. This is the same chain the deployment runs, so a local
# database ends up in the same shape as a real one — with sample content instead of production.
uv run python -m app.jobs.run seed             # legacy trivia seed (30 questions)
uv run python -m app.jobs.run ingest           # the categorised bank (180 questions)
uv run python -m app.jobs.run ingest-estimate  # Fermi estimation items
uv run python -m app.jobs.run ingest-change    # change-detection pairs

uv run uvicorn app.main:app --port 8000 --reload

# frontend, in another shell
cd frontend
npm install
npm run dev
```

No configuration is required for the content: with `ROT_CONTENT_DIR` unset and `APP_ENV` anything
other than production, the app reads the committed sample corpus at `backend/content/sample/`.

### Tests

```bash
cd backend  && uv run pytest            # needs the DB migrated first
cd frontend && npx vitest run
```

---

## The parts worth reading

**The content boundary** (`backend/app/core/config.py`, `backend/content/package.py`). Production
refuses to start without an explicit private content root. There is deliberately no fallback:
silently serving placeholder questions into a ranked contest would be worse than not booting.

**Round modules** (`backend/app/modules/`, `frontend/src/modules/`). A contest is an ordered list of
round modules; adding a game mode means adding a module, and the contest engine is never touched.
Each module returns a `client_spec` that must never contain the answer, and a `server_answer` that
never leaves the server.

**Determinism** (`backend/app/services/engine.py`). The Daily Royale is seeded per *window*, not per
player, so everyone gets the identical eight questions in the identical option order — the property
that makes a leaderboard and a "beat my score" share meaningful.

**Windows and DST** (`backend/app/core/timezone.py`). Contest times are defined in America/New_York
wall clock and stored as UTC instants. Getting this wrong drifts every window by an hour for eight
months of the year, so it is computed with `zoneinfo` and never with a fixed offset.

**Ledgers** (`backend/app/services/ledger.py`, `gem_ledger.py`). Both currencies are append-only.
Balances are caches that must always equal their ledger sum; nothing mutates a balance without
writing a row.

`CLAUDE.md` is the working reference for all of it — conventions, invariants, and the reasoning
behind decisions that look arbitrary until you know what broke.

---

## Currencies

Coins and Gems are in-app, closed-loop, and **earned only**. They cannot be purchased, cashed out or
transferred. There is no real money and no gambling anywhere in this project, and player-facing copy
is checked against a banned-terms list in every supported language (`frontend/src/i18n/copyGuard.ts`).

---

## Licence

Code is [Apache-2.0](LICENSE).

The trademarks, name, logo and brand assets are **not** covered by that licence — see
[TRADEMARKS.md](TRADEMARKS.md). Third-party components and bundled fonts are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

To report a vulnerability, see [SECURITY.md](SECURITY.md). To contribute, see
[CONTRIBUTING.md](CONTRIBUTING.md).

---

## Why the history starts at one commit

Because removing a file from a repository's HEAD does not remove it from the repository. The
development history contained production questions and artwork in files that were later moved or
deleted, and all of it stayed reachable in the object database.

Starting from a clean root makes their absence a property of this repository rather than the result
of a rewrite someone has to trust. The full history still exists privately.
