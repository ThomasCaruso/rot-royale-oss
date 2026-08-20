# AI Question Intelligence & Silent Personalization

> "LLM categorizes the questions. Gameplay categorizes the user. The recommendation engine
> matches both."

Three layers, all feature-flagged, all personalization-only (nothing here ever touches scores,
coins, rating, or standings):

1. **Question classification** — a batch LLM job writes structured metadata
   (`question_ai_metadata`) for each trivia question. The LLM is **never** called during gameplay.
2. **Taste profiles** — gameplay sends small fire-and-forget interaction events
   (`question_interaction_events`); the server folds them into a per-user profile
   (`user_taste_profiles`) with bounded, clamped increments. No onboarding questions, ever.
3. **Personalized ranking** — when a no-stakes session starts, the fetched question bank is
   trimmed to a pool that targets the zone between what the user knows, almost knows, and finds
   interesting (50% proven interests / 25% adjacent / 15% weak-but-interesting / 10% exploration).

## Competitive fairness (do not weaken)

- The **ranked Daily Royale is NOT personalized**. `contest.enter` routes through the same
  `personalize_bank(..., mode="ranked")` gate, which is a no-op unless `PERSONALIZE_RANKED_DAILY=true`
  — and it defaults (and should stay) `false`: per-user ranked pools break leaderboard
  comparability and entry-regeneration reproducibility.
- Duels / friend duels are never personalized (two players share one seeded set).
- Campaign levels are authored question lists — nothing to select.
- Personalized modes: **practice, quick play, category sessions** only.

## Where the API key goes

Put real credentials in `backend/.env` (gitignored). **Never commit them.**

The live provider is **NVIDIA NIM** (OpenAI-compatible; verified working with the classifier's
strict-JSON `response_format` request shape):

```
ROT_AI_ENABLED=true
ROT_AI_PROVIDER=nvidia_nim
ROT_AI_API_KEY=<nvapi-… key>
ROT_AI_BASE_URL=https://integrate.api.nvidia.com/v1
ROT_AI_MODEL=mistralai/mistral-medium-3.5-128b
ROT_AI_CLASSIFICATION_TIMEOUT_MS=60000
```

Any other OpenAI-compatible endpoint works the same way (e.g. `https://api.openai.com/v1` +
`gpt-4o-mini`). Windows console note: set `PYTHONIOENCODING=utf-8` before job runs — the default
cp1252 console can't print the report's unicode arrows.

With `ROT_AI_ENABLED=false` or any credential blank, the app runs normally, all tests pass, and
the classify job exits with a clear message (exit code 2).

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `ROT_AI_ENABLED` | `false` | master switch for the LLM classifier |
| `ROT_AI_PROVIDER` | `openai_compatible` | recorded on each metadata row |
| `ROT_AI_API_KEY` | *(empty)* | provider key — `backend/.env` only |
| `ROT_AI_BASE_URL` | *(empty)* | OpenAI-compatible base URL |
| `ROT_AI_MODEL` | *(empty)* | model id |
| `ROT_AI_CLASSIFICATION_TEMPERATURE` | `0` | strict-JSON classification |
| `ROT_AI_CLASSIFICATION_TIMEOUT_MS` | `30000` | per-request timeout |
| `ROT_AI_BATCH_SIZE` | `25` | flush cadence during batch runs |
| `ROT_AI_MAX_RETRIES` | `2` | provider retries with backoff |
| `PERSONALIZATION_ENABLED` | `true` | taste-profile updates + bank ranking |
| `PERSONALIZE_RANKED_DAILY` | `false` | **keep false** — ranked fairness |
| `PERSONALIZATION_DEBUG` | `false` | exposes `GET /personalization/me/profile` in production |
| `VITE_PERSONALIZATION_DEBUG` (frontend) | `false` | dev-only taste-profile inspector on the practice results screen |

## Commands

```bash
# migration (already applied locally): aa11bb22cc33_personalization_ai_metadata_taste_
cd backend && uv run alembic upgrade head

# classify — batch, idempotent (skips already-classified unless --force)
uv run python -m app.jobs.run classify --dry-run          # list candidates, no LLM calls
uv run python -m app.jobs.run classify --limit 50         # classify up to 50 unclassified
uv run python -m app.jobs.run classify --id <uuid> --force  # re-run one question
uv run python -m app.jobs.run classify --force            # reclassify everything (prompt change)
```

`classification_version` (currently `"v1"`, `app/services/ai_classifier.py`) is stored per row —
bump it when the prompt changes so stale rows are identifiable for a `--force` re-run.

## How it behaves

- **Universal capture (sub-project A):** every mode records a server-authoritative answer signal at
  its per-round scoring point — practice/campaign (`answer_practice_round`), Daily Royale
  (`answer_round`), bot duel (`submit_duel_round`), friend duel (`submit_answer`) — via
  `taste_profile.record_answer_signal`. Correctness and speed come from the server's own judgement
  (never client-reported). The `POST /personalization/events` client channel is now an
  engagement-only supplement (explanation-read / share) and is count-neutral, so `interaction_count`
  equals the number of answers. Ranked play is recorded but selection stays un-personalized.
- **Validation gate** (`app/schemas/ai_metadata.py`): scores clamped to 0..1, tags normalized/
  deduped/capped at 8, and `needs_review` is forced true when `llm_confidence < 0.75`,
  `ambiguity_risk > 0.35`, `controversy_risk > 0.5`, or `quality_score < 0.65`. Structurally
  malformed LLM output is rejected and reported, never stored.
- **Events** (`POST /personalization/events`): the client sends `entry_id + idx`; the server
  resolves the bank `question_id` from the stored round answers. The client-side tracker
  (`frontend/src/lib/interactionTracker.ts`) can never throw into gameplay; a lost event is fine.
- **Cold start**: ranking is a pass-through until a user has ≥20 interactions AND the bank is
  >24 questions AND at least some of it is classified. New/unclassified questions score neutral,
  so fresh content still circulates.
- **needs_review** questions carry a −0.50 ranking penalty (they remain servable — the
  `status in (approved, live)` gate is unchanged and stays the single serving gate).
- **Determinism**: a session's personalized pool is a pure function of (bank, profile, entry
  seed) — exploration noise is seeded from the entry seed.
- Embeddings are deliberately **not** part of v1; the schema can grow a nullable `embedding`
  column via a future migration if/when pgvector lands.

## Key files

Backend: `app/models/personalization.py`, `app/schemas/ai_metadata.py`,
`app/schemas/personalization.py`, `app/services/ai_classifier.py`,
`app/services/taste_profile.py`, `app/services/personalization.py`,
`app/api/personalization.py`, hooks in `app/services/practice.py` + `app/services/contest.py`,
CLI in `app/jobs/run.py`, migration `alembic/versions/aa11bb22cc33_*.py`.

Frontend: `src/lib/interactionTracker.ts`, `src/lib/personalizationFlags.ts`,
`src/screens/dev/PersonalizationDebug.tsx`, wiring in `src/screens/Practice.tsx`,
API surface in `src/api/client.ts`.
