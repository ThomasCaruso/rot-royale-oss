# Contributing

Thanks for looking. A few things worth knowing before you spend time.

## What this project can and cannot accept

This is the engine for a **live game**. The production questions and artwork are not in this
repository, so some things cannot be reviewed here at all:

- **Content changes** — questions, campaign structure, artwork. These live in a private package.
  Feel free to open an issue suggesting something, but there is no file here to edit.
- **Anything that changes what a shipped mobile client receives.** Installed App Store binaries
  cannot be updated on demand, so the API can widen what it accepts but must never narrow or reshape
  what it returns. [`docs/architecture.md`](docs/architecture.md) §11 explains why, with the
  outage that taught it.

Everything else is fair game: bugs, performance, accessibility, tests, documentation, tooling.

## Before you start something large

Open an issue first. A new screen, a schema change, a new round module or anything touching the
invariants below is worth agreeing on before it is written.

## The invariants

These are not style preferences. Breaking one is a correctness bug:

1. **Answers never leave the server.** A `client_spec` must not contain its own answer, and
   client-reported scores are never trusted.
2. **Currency moves only through the ledgers.** Balances are caches of an append-only ledger sum.
3. **Window times are computed in ET via `zoneinfo`.** Never a hardcoded UTC offset.
4. **Schema changes only via Alembic.** Never `create_all`, never a hand-edited migration.
5. **Placement, rating, gems and share links describe real entries only.** The live in-progress
   board of a thin day is the single padded surface, and it is provisional by construction —
   see [`docs/architecture.md`](docs/architecture.md) §7 for the exact boundary.
6. **No money or gambling framing in player-facing copy**, and never an invented count.

[`docs/architecture.md`](docs/architecture.md) documents each of these with the reasoning.

## Verification

Run these before opening a PR. "It works on my machine" is not a state anyone can review:

```bash
cd backend
uv run ruff check .          # lint
uv run ruff format --check . # formatting
uv run mypy app              # types
uv run pytest                # requires `uv run alembic upgrade head` first

cd frontend
npm run typecheck
npm run lint
npx vitest run
npm run build                # catches what dev mode hides
```

Anything visual: look at it at mobile width. Screenshots in the PR are appreciated.

## Style

Match the surrounding code. The one thing this codebase asks for that many do not: **comments should
explain why, not what.** A comment that restates the line above is noise; a comment recording the
bug that made a line necessary is the reason the line survives a future refactor.

## Tests

New behaviour needs a test. A test that would pass with the feature removed is worth less than no
test, so prefer asserting the property rather than the implementation — and if you can, check that
your test fails when you break the thing it covers.
