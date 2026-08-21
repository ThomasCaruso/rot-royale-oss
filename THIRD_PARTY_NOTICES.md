# Third-party notices

This project depends on open-source software, and redistributes a small number of third-party files
directly. Dependencies resolved at install time are listed by their lockfiles —
`backend/uv.lock` and `frontend/package-lock.json` — which are the authoritative record of exact
versions.

This document covers what is **committed to this repository** rather than fetched, because those are
the files that travel with a clone and carry obligations that must be reproduced.

## Bundled typefaces

Three fonts are committed at `backend/app/assets/fonts/`. They are not a convenience: the share card
(`GET /c/{id}/og.png`) is rendered server-side by Pillow for link unfurls, and a crawler never
executes the web app's CSS. Without real font files, Pillow falls back to a bitmap face that is
illegible at headline sizes.

| File | Licence | Copyright |
|---|---|---|
| `PlayfairDisplay-Bold.ttf` | SIL Open Font License 1.1 | 2017 The Playfair Display Project Authors, Reserved Font Name "Playfair Display" |
| `Manrope-Bold.ttf` | SIL Open Font License 1.1 | 2018 The Manrope Project Authors |
| `LuckiestGuy-Regular.ttf` | Apache License 2.0 | Astigmatic (AOETI) |

Full licence texts sit alongside the files, with `NOTICE.md` recording why each is present.

**Under OFL-1.1** these files keep their Reserved Font Names, must not be sold on their own, and any
derivative font must not use the reserved name. Bundling them inside an application is expressly
permitted. **Do not rename the TTFs** — the notice identifies them by filename.

## Principal dependencies

Not exhaustive; see the lockfiles. Listed because these shape the project and their licences are
worth knowing up front.

**Backend** — FastAPI (MIT), Starlette (BSD-3-Clause), Uvicorn (BSD-3-Clause), SQLAlchemy (MIT),
Alembic (MIT), Pydantic (MIT), asyncpg (Apache-2.0), APScheduler (MIT), PyJWT (MIT), argon2-cffi
(MIT), httpx (BSD-3-Clause), Pillow (MIT-CMU), pywebpush (MPL-2.0), tzdata (Apache-2.0).

**Frontend** — React and React DOM (MIT), Vite (MIT), TypeScript (Apache-2.0), Zustand (MIT),
TanStack Query (MIT), Capacitor and its plugins (MIT), Phaser (MIT), Workbox / vite-plugin-pwa
(MIT), idb-keyval (Apache-2.0), Vitest (MIT), Testing Library (MIT).

Licence identifiers are given in good faith from each project's published metadata. If you are
making redistribution decisions, verify against the lockfiles rather than this summary — it is a
convenience, not a legal instrument.

## Content and artwork

The sample question corpus at `backend/content/sample/` was authored for this repository and is
covered by the project licence.

The production content and artwork are **not in this repository** and are not licensed for reuse.
See [TRADEMARKS.md](TRADEMARKS.md).

## Corrections

If something here is wrong or missing, please open an issue — attribution errors are worth fixing
quickly.
