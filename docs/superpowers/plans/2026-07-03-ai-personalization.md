# AI Question Intelligence & Silent Personalization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LLM classifies questions into structured metadata once (batch, never in gameplay); gameplay silently builds a per-user taste profile from interaction events; a ranking service pre-filters question banks toward each user's interest/skill zone — practice-first, ranked Daily Royale untouched by default.

**Architecture:** Three new tables (`question_ai_metadata`, `user_taste_profiles`, `question_interaction_events`) via one Alembic migration. An OpenAI-compatible classifier service invoked only through the existing `python -m app.jobs.run` CLI. A `/personalization` router records events fire-and-forget and applies bounded profile updates in-request. Ranking hooks into `start_practice` (and, gate-only, `contest.enter`) by **trimming the fetched bank** to a personalized pool before `build_round_set` — the engine/modules never learn about personalization (same pre-filter pattern as category scoping).

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + pydantic-settings (backend), httpx (moved to main deps), Vite/React/TS + vitest (frontend).

**Conventions honored:** services never commit; JSONB fields reassigned, never mutated in place; UUID PKs, timestamptz; env-driven config; no secrets committed; user asked for no commits → no git steps.

---

## Locked design decisions (from repo inspection)

1. **Question linkage:** trivia `server_answer` already carries `question_id` (`app/modules/trivia.py:63-67`). The event endpoint accepts `entry_id + idx` and resolves `question_id` server-side from `round_answers` (falls back to a client-sent `question_id`, else null). Client-sent correctness/timing is accepted — personalization only affects that user's own question mix, never scores/coins/rating.
2. **Ranking = bank trimming.** `TriviaModule.generate` does `rng.choice(pool)` — order-insensitive. `personalize_bank()` therefore returns a **subset** (top-scored pool with the 50/25/15/10 mix), keeping ≥6 questions per difficulty when available so `CATEGORY_SESSION`'s difficulty slots still resolve. Banks ≤ 24 questions are returned unchanged. Deterministic per entry: exploration noise seeded from the entry seed.
3. **Ranked fairness:** `contest.enter` calls `personalize_bank(..., mode="ranked")`, which returns the bank **unchanged** unless `PERSONALIZE_RANKED_DAILY=true` (default false). Duels/friend duels are NOT hooked (one shared set for two players — per-user trimming would bias it). Campaign levels are authored `question_keys` — nothing to select, not hooked.
4. **Classification is CLI-only** (`python -m app.jobs.run classify ...`), matching the `ingest` convention. No admin endpoints (no admin auth exists in the repo — building one is out of scope).
5. **Settings:** new fields on the existing `Settings` singleton (pydantic-settings maps `rot_ai_api_key` ↔ `ROT_AI_API_KEY`). Tests toggle via `monkeypatch.setattr(settings, ...)`; all flag reads happen at call time, never import time.
6. **Migration chain:** `down_revision = "b8c9d0e1f2a3"` (current head).
7. **`user_taste_profiles` PK** = `user_id` (matches `profiles` pattern; the spec's separate `id` adds nothing).

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `backend/app/core/config.py` | ROT_AI_* + PERSONALIZATION_* settings, `ai_classification_ready` property |
| Modify | `backend/.env.example` | env placeholders + "put your key here" docs |
| Modify | `backend/pyproject.toml` | move `httpx` to main dependencies |
| Create | `backend/app/models/personalization.py` | 3 ORM models |
| Modify | `backend/app/models/__init__.py` | export them |
| Create | `backend/alembic/versions/aa11bb22cc33_personalization_ai_metadata_taste_.py` | migration |
| Create | `backend/app/schemas/ai_metadata.py` | strict LLM-output schema: clamping, tag normalization, auto needs_review |
| Create | `backend/app/schemas/personalization.py` | `InteractionEventIn`, `TasteProfileOut` |
| Create | `backend/app/services/ai_classifier.py` | OpenAI-compatible client, prompts, classify one/batch, idempotency, version |
| Create | `backend/app/services/taste_profile.py` | get-or-create profile, bounded signal updates, weak/disliked topic logic |
| Create | `backend/app/services/personalization.py` | scoring formula, penalties, mix buckets, `personalize_bank` |
| Create | `backend/app/api/personalization.py` | POST `/personalization/events`, GET `/personalization/me/profile` (debug-gated) |
| Modify | `backend/app/main.py` | register router |
| Modify | `backend/app/services/practice.py` | `personalize_bank` hook after `fetch_bank` |
| Modify | `backend/app/services/contest.py` | gate-only ranked hook |
| Modify | `backend/app/jobs/run.py` | `classify` command (`--limit --force --dry-run --id`) |
| Create | `backend/tests/test_ai_metadata_schema.py` | schema tests |
| Create | `backend/tests/test_ai_classifier.py` | classifier gating/idempotency/graceful failure (fake chat client) |
| Create | `backend/tests/test_taste_profile.py` | profile update signal tests |
| Create | `backend/tests/test_personalization_ranking.py` | ranking + ranked-fairness tests |
| Create | `backend/tests/test_personalization_api.py` | event endpoint + debug gate tests |
| Modify | `frontend/src/api/client.ts` | event POST + profile GET + types |
| Create | `frontend/src/lib/interactionTracker.ts` | fire-and-forget tracker (never throws) |
| Create | `frontend/src/lib/interactionTracker.test.ts` | tracker tests |
| Modify | `frontend/src/screens/Practice.tsx` | send events on reveal-continue / quit; debug panel mount |
| Create | `frontend/src/screens/dev/PersonalizationDebug.tsx` | flag-gated profile viewer |
| Create | `frontend/src/screens/dev/PersonalizationDebug.test.tsx` | hidden-unless-enabled test |
| Modify | `frontend/.env.example` | `VITE_PERSONALIZATION_DEBUG=false` |
| Create | `docs/personalization.md` | operator docs: env vars, commands, API-key location, fairness rules |

---

### Task 1: Settings + env placeholders

**Files:** Modify `backend/app/core/config.py`, `backend/.env.example`, `backend/pyproject.toml`.

- [ ] Add to `Settings` (after the VAPID block):

```python
    # ── AI question classification (LLM, batch-only — NEVER called during gameplay) ──
    # Put your real key in backend/.env as ROT_AI_API_KEY=... (never commit it).
    rot_ai_enabled: bool = Field(default=False)
    rot_ai_provider: str = Field(default="openai_compatible")
    rot_ai_api_key: str = Field(default="")
    rot_ai_base_url: str = Field(default="")  # e.g. https://api.openai.com/v1
    rot_ai_model: str = Field(default="")
    rot_ai_classification_temperature: float = Field(default=0.0)
    rot_ai_classification_timeout_ms: int = Field(default=30000)
    rot_ai_batch_size: int = Field(default=25)
    rot_ai_max_retries: int = Field(default=2)

    # ── Silent personalization (taste profiles + question ranking) ──
    personalization_enabled: bool = Field(default=True)
    personalize_ranked_daily: bool = Field(default=False)  # ranked Daily Royale stays fair
    personalization_debug: bool = Field(default=False)

    @property
    def ai_classification_ready(self) -> bool:
        return bool(
            self.rot_ai_enabled and self.rot_ai_api_key and self.rot_ai_base_url and self.rot_ai_model
        )
```

- [ ] `.env.example`: append the full ROT_AI_*/PERSONALIZATION_* block with comments (key placeholder empty).
- [ ] `pyproject.toml`: add `"httpx>=0.28"` to `[project] dependencies` (keep dev copy; uv dedupes). Run `uv sync`.
- [ ] Run `uv run pytest tests/ -x -q` smoke (nothing should break).

### Task 2: Models + migration

**Files:** Create `backend/app/models/personalization.py`; modify `backend/app/models/__init__.py`; create migration.

- [ ] Models: `QuestionAIMetadata` (`question_ai_metadata`, `question_id` unique FK→questions CASCADE; strings for category/subcategory/knowledge_type/freshness_type/model_name/provider_name/classification_version; `Float` scores; JSONB `topic_tags/audience_tags/related_topics/raw_llm_json`; `needs_review` bool; created_at/updated_at server defaults). `UserTasteProfile` (`user_taste_profiles`, PK `user_id` FK→users CASCADE; JSONB affinity dicts + lists; Float prefs default 0.5; `interaction_count` int 0; `confidence_score` float 0). `QuestionInteractionEvent` (`question_interaction_events`, UUID PK; `user_id` FK indexed; `question_id` nullable FK indexed; `mode` String(16); `session_id` UUID nullable; per-spec signal columns; created_at).
- [ ] Migration `aa11bb22cc33`, `down_revision="b8c9d0e1f2a3"`, hand-written in repo style (`sa.Uuid()`, `postgresql.JSONB`, `server_default=sa.text(...)`, named unique constraint `uq_question_ai_metadata_question`).
- [ ] `uv run alembic upgrade head` (dev DB); test DB migrates itself in conftest.
- [ ] Sanity test in `tests/test_personalization_api.py` (started here): insert+read back a `QuestionAIMetadata` row via `db_session`.

### Task 3: LLM-output schema (validation core)

**Files:** Create `backend/app/schemas/ai_metadata.py`, `backend/tests/test_ai_metadata_schema.py`.

- [ ] TDD: tests first — accepts the spec's example JSON; rejects missing category / non-list topic_tags / unknown knowledge_type; clamps out-of-range scores to 0..1; normalizes+dedupes+caps tags at 8; auto-forces `needs_review=True` for `llm_confidence<0.75`, `ambiguity_risk>0.35`, `controversy_risk>0.5`, `quality_score<0.65`.
- [ ] Implement `AIMetadataPayload(BaseModel)`:

```python
_SCORE_FIELDS = ("difficulty_score", "humor_score", "brainrot_score", "educational_score",
                 "controversy_risk", "ambiguity_risk", "quality_score", "llm_confidence")

def _norm_tags(v: list[str], cap: int = 8) -> list[str]:
    out: list[str] = []
    for t in v:
        s = " ".join(str(t).split()).strip().lower()
        if s and s not in out:
            out.append(s)
    return out[:cap]

class AIMetadataPayload(BaseModel):
    category: str = FieldP(min_length=1)
    subcategory: str | None = None
    topic_tags: list[str]
    audience_tags: list[str] = []
    related_topics: list[str] = []
    # scores: float, clamped via field_validator(mode="before") → max(0.0, min(1.0, float(v)))
    knowledge_type: Literal["common_knowledge","specific_fact","niche_fact","logic","visual","current_event","wordplay","other"]
    freshness_type: Literal["evergreen","recent","time_sensitive","outdated_risk"]
    needs_review: bool = False
    # model_validator(mode="after"): needs_review |= thresholds
```

### Task 4: Classifier service + provider client

**Files:** Create `backend/app/services/ai_classifier.py`, `backend/tests/test_ai_classifier.py`.

- [ ] TDD with a `FakeChat` (returns canned JSON / raises): `classify_question` raises `AIClassifierUnavailable` with a clear message when `rot_ai_enabled=False` or key missing (monkeypatch settings); skips existing metadata unless `force=True`; stores validated row with `classification_version`, `model_name`, `provider_name`, `raw_llm_json`; malformed LLM JSON → counted as failed, nothing stored; `classify_batch` respects `limit`, `dry_run` (no writes), and reports `classified/skipped/failed`.
- [ ] Implement: module-level `SYSTEM_PROMPT` + `build_user_prompt(question)` exactly per spec (question text, choices, correct answer from `payload`, explanation). `OpenAICompatChat.complete()` → httpx POST `{base_url}/chat/completions` with `{"model", "temperature", "messages", "response_format": {"type": "json_object"}}`, timeout from settings, `rot_ai_max_retries` retries with 1s backoff, strips ```json fences defensively. `CLASSIFICATION_VERSION = "v1"`. Never called from any gameplay path.

### Task 5: `classify` CLI command

**Files:** Modify `backend/app/jobs/run.py`.

- [ ] Add `classify` to `_COMMANDS`; parse `--limit N`, `--force`, `--dry-run`, `--id <uuid>` from `sys.argv`; run `classify_batch`, print a report line per ingest style; exit non-zero on `AIClassifierUnavailable` (clear message) or any failures. Docs: `uv run python -m app.jobs.run classify --limit 50 --dry-run`.

### Task 6: Taste profile service

**Files:** Create `backend/app/services/taste_profile.py`, `backend/tests/test_taste_profile.py`.

- [ ] TDD: profile auto-created; fast-correct (+0.06 to category/sub/topics, difficulty nudge up); slow-correct +0.02; wrong+explanation-read → interest + topic enters `weak_but_interesting_topics`; wrong+quit −0.06 and (after repeats) topic enters `disliked_topics`; timeout −0.03; all affinities clamped to [-1, 1]; `interaction_count` increments; `confidence_score = min(1, n/50)`; humor/brainrot EMA moves toward engaged questions' scores; increments scaled by `0.5 + 0.5*confidence` early-gentleness.
- [ ] Implement `get_or_create_profile`, pure `apply_event(profile_dict_snapshot, event, meta) -> updates`, and `update_profile_from_event(session, user_id, event)` that loads `QuestionAIMetadata` (topic source) — falls back to `Question.category` + difficulty when no AI metadata. **Reassign JSONB dicts/lists (never mutate in place).** Bounded lists: disliked ≤ 20, weak ≤ 20, last_seen_topic_tags ≤ 30, last_seen_categories ≤ 10. Fast/slow thresholds from `time_limit` context: fast < 40% of 10s, slow > 80%. Difficulty EMA: `pref += 0.02` on fast-correct, `-= 0.02` on wrong/timeout, clamp 0..1.

### Task 7: Ranking service + safe-mode hooks

**Files:** Create `backend/app/services/personalization.py`, `backend/tests/test_personalization_ranking.py`; modify `practice.py`, `contest.py`.

- [ ] TDD: `score_question` favors high-affinity category/topics; penalizes disliked (−0.30), recently-seen topic (−0.25), needs_review (−0.50), too-hard (−0.20)/too-easy (−0.10) vs `difficulty_preference`; `personalize_bank` returns bank unchanged when: flag off, mode "ranked" with `personalize_ranked_daily=False`, no profile, `interaction_count < 20`, or bank ≤ 24; personalized pool keeps ≥6 per available difficulty; same seed → same pool (determinism); a liked-topic question ranks into the pool ahead of a disliked one.
- [ ] Implement per the spec formula (weights 0.20/0.20/0.25/0.15/0.10/0.05/0.05; novelty = 1 − recency overlap; exploration noise from `Random(f"personalize:{seed}")`), mix buckets 50/25/15/10 (adjacent = shares `related_topics`/`audience_tags`/category-not-subcategory with liked topics), then per-difficulty top-up. Questions without AI metadata score neutral 0.45 + noise (new content still circulates).
- [ ] Hook `start_practice`: `bank = await personalize_bank(session, user_id, bank, mode=..., seed=seed)` (mode = "quick"/"practice"/"category"). Hook `contest.enter` line ~123 with `mode="ranked"`. Existing practice/contest tests must still pass (default path unchanged for fresh users).

### Task 8: Events API + debug profile endpoint

**Files:** Create `backend/app/schemas/personalization.py`, `backend/app/api/personalization.py`, `backend/tests/test_personalization_api.py`; modify `main.py`.

- [ ] TDD: POST `/personalization/events` with `entry_id+idx` resolves question_id from `round_answers`, creates event row + updates profile; works with `personalization_enabled=False` (event stored, profile untouched); invalid payload → 422; GET `/personalization/me/profile` returns profile when `personalization_debug=True`, 404 when `app_env="production"` and debug off; auth required.
- [ ] Implement router (`prefix="/personalization"`), event insert + `update_profile_from_event` best-effort (`except Exception: log` — a profile bug must never 500 the event write), register in `main.py`.

### Task 9: Frontend tracking + debug panel

**Files:** per file map above.

- [ ] `client.ts`: `QuestionInteractionPayload` type + `api.recordQuestionInteraction` + `api.getTasteProfile`.
- [ ] `interactionTracker.ts`: `trackInteraction(payload): void` — calls the api, `.catch(() => {})`, guarded so it can never throw into gameplay. Tests: sends payload; rejection swallowed.
- [ ] `Practice.tsx`: capture `elapsed_ms`/`choice` in `onRoundComplete`; stamp `revealAtRef` when reveal shows; on Continue send event `{entry_id, idx, mode, selected_answer, is_correct, response_ms, timed_out, explanation_opened, explanation_read_ms}`; `useEffect` cleanup sends `quit_after: true` for an answered-but-unfinished session. Mode string: category → "category", mode==="quick" → "quick", else "practice".
- [ ] `PersonalizationDebug.tsx`: returns `null` unless `import.meta.env.VITE_PERSONALIZATION_DEBUG === "true"` (read via exported `isPersonalizationDebugEnabled()` for testability); fetches profile, renders top category affinities, top topics, disliked, weak-but-interesting, confidence. Mounted on Practice result phase only. Test: hidden when flag unset.
- [ ] `frontend/.env.example`: add `VITE_PERSONALIZATION_DEBUG=false`.

### Task 10: Docs + full verification

- [ ] `docs/personalization.md`: env vars table, **where the API key goes** (`backend/.env` → `ROT_AI_API_KEY`), commands, fairness rules, schema notes, migration name.
- [ ] Backend: `uv run ruff check . && uv run ruff format . && uv run mypy app && uv run pytest`.
- [ ] Frontend: `npm run typecheck && npm run lint && npx vitest run && npm run build`.

## Self-review notes

- Spec coverage: metadata schema (T3), classifier (T4), batch path (T5), events (T8+T9), profile updates (T6), ranking (T7), flags/fallbacks (T1, gates in T4/T7/T8), tests (every task), docs/key location (T10). Admin endpoints intentionally replaced by CLI (spec: "CLI scripts, admin endpoints, or both depending on repo patterns"; repo pattern is CLI, no admin auth exists).
- Embeddings deliberately omitted (spec: not required; schema extensible later — a nullable `embedding` column can be added by a future migration; pgvector not installed).
- No commits: user's CLAUDE.md says commit only when asked; working tree already has unrelated uncommitted changes.
