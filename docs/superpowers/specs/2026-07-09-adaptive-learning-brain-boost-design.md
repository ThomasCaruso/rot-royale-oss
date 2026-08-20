# Adaptive Learning Engine (Brain Boost) — Design

**Date:** 2026-07-09
**Status:** Design approved; pending spec review → implementation plan
**Scope:** The **improvement/learning** pillar of "make non–Daily-Royale play feel catered, genuinely improve you, and be fun/retentive." Retention wiring and broader felt-personalization are **separate, later** specs.

---

## 1. Goal & framing

Turn the non-ranked daily ritual (**Brain Boost**) into a genuine adaptive-learning experience: it picks questions that **target your weak spots at a fun-first difficulty**, tracks a **mastery** estimate per category, and lets you **feel yourself getting better** over time.

**What we are upgrading is the internal _skill scoring_ (a model of what you know) — NOT the game's points formula.** Points (`round((100 + time_frac*60) * (1 + min(streak,5)*0.12))`, `services/scoring.py`) are unchanged. This is a **selection + mastery-tracking** engine.

### Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| First pillar | Improvement/learning engine (retention layered on later) |
| Mastery granularity | **Hybrid** — category-level mastery shown to the player; topic-level targeting internally |
| Push intensity | **Fun-first** — ~80–85% target success; ~25–30% of a session is weak-spot/stretch |
| Surface | **Upgrade Brain Boost** into the flagship adaptive "daily training" |
| Model | **Knowledge-tracing (heavy/precise)**, made viable via hierarchical shrinkage + cold-start fallback |

### Non-goals (this spec)

- No change to Daily Royale (ranked) selection or scoring — it stays fair and unpersonalized (`personalize_ranked_daily=false`).
- No change to the points formula, coins, gems, or rating.
- No retention mechanics (training streak, missions, XP, goals) — that's the next pillar; we leave a clean seam.
- No change to Campaign (authored, curated) selection.
- Category sessions keep the player's chosen category; they may receive **difficulty targeting** but not weak-category re-routing.

---

## 2. The engine — hierarchical knowledge-tracing

The known failure mode of BKT/IRT here is **sparsity**: hundreds of LLM topic tags, most seen 1–2× per user → per-topic estimates are noise. We solve it with **partial pooling** (a topic borrows strength from its category until it earns independence). This is exactly why the granularity decision is "category mastery + topic targeting."

- **Category ability `θ_cat`** (6 categories) — the dense, reliable backbone, IRT-style. A question's difficulty `b` is seeded from the existing `QuestionAIMetadata.difficulty_score` (0–1 mapped onto an ability scale). Correct on a **hard** question moves `θ` more than an easy one; wrong on an **easy** question drops it more. Each category also carries an **uncertainty** (shrinks as attempts grow) used for gating and display confidence.
- **Per-topic knowledge `P(known)`** (BKT-style) — estimated per (user, topic), but **shrunk toward `θ_cat`** when topic attempts are below a threshold (`TOPIC_INDEPENDENCE_MIN`). Thin topics inherit a sane prior instead of swinging wildly; well-sampled topics diverge to reflect real strength/weakness.
- **Online update, per answer.** Hooked at the existing server-side signal chokepoint `services/taste_profile.py::record_answer_signal` (already called by practice/quick/category/Brain Boost scoring), using **server-derived** `is_correct` + `time_frac` + question difficulty — never client-reported scores. A response updates `θ_cat`, the relevant topic `P(known)`, and the topic's review schedule.
- **Cold start.** Below `CATEGORY_MIN_RESPONSES` for a category, the engine does **not** assert targeting; selection falls back to today's interest-based `personalize_bank`. Mastery is shown as "warming up" (or hidden) until earned. Existing behavior is the safety net.

**Model math kept explicit in the plan:** the exact update rules (IRT logistic for `θ`, BKT transition/guess/slip for `P(known)`, the shrinkage weight as a function of attempts) get pinned down with priors in the implementation plan. Priors: item difficulty from LLM `difficulty_score`; BKT `P(L0)`/`P(T)`/`P(G)`/`P(S)` start from literature-sane defaults, tunable in `core/constants.py`. No per-user param fitting in v1 (deferred as an optional batch job).

---

## 3. Data model

- **New `user_skill_state`:**
  - per (user_id, category): `theta` (ability), `uncertainty`, `attempts`, `updated_at`.
  - per (user_id, topic): `p_known`, `attempts`, `last_correct_at`, `review_due_at`, `updated_at`.
  - Shape TBD in the plan (two tables vs one table with a `scope` discriminator vs JSONB on a single per-user row). Leaning: a compact per-user row with JSONB maps (mirrors `user_taste_profiles`), reassigned-never-mutated per the JSONB convention.
- **Training data already exists:** `QuestionInteractionEvent` (correctness, response_ms, timed_out, question_id → topics/difficulty via `QuestionAIMetadata`). No new capture needed; we consume the same signal.
- **Item parameters:** difficulty from `QuestionAIMetadata.difficulty_score`. A batch refit of item params from the event log is **deferred** (heavy, optional).
- **Migration:** one Alembic migration for `user_skill_state`. No changes to existing tables.

---

## 4. Scheduler + session composer (makes Brain Boost adaptive)

Each daily Brain Boost session (~8 trivia questions) is composed server-side:

1. **Pick the target** = the weakest **category** that is review-due (lowest `θ_cat` with enough data, tie-broken by review urgency). This is "Today's training: <category>."
2. **Compose to the 80–85% rule** (fun-first):
   - **~6 comfortable** — interest topics near your ability; difficulty chosen so predicted `P(correct) ≈ 0.85` (wins that still count).
   - **~2–3 weak-spot stretch** — low-`P(known)`, review-due topics in the target category; difficulty at your edge (`P(correct) ≈ 0.70`).
   - Overall session targets ~80–85% success.
3. **Spaced repetition is per _topic_ with _fresh_ questions.** A weak topic resurfaces on **expanding intervals** (miss → next session; each success pushes `review_due_at` out further as `P(known)` rises — Leitner-style, driven by the BKT estimate). **Never the same question twice** (anti-memorization; trivia rewards re-encountering the *topic*, not recalling a specific item's answer) — enforced via the existing last-seen ring + a not-recently-served guard.
4. **Implementation:** add a **"learning-need" scorer** alongside the existing interest scorer inside `services/personalization.py::personalize_bank`, and blend by the fun-first ratio. The existing 50/25/15/10 mix is generalized so the "weak-but-interesting" bucket becomes a **scheduled, mastery-driven** targeting bucket rather than a heuristic one. `personalize_bank` stays the single selection chokepoint.
5. **Optional in-session micro-adaptation** (plan may defer): nudge the next pick easier/harder based on running success, layered on top of the pre-composed set.

---

## 5. What the player feels (the payoff)

- **Brain Boost tile / session start:** "Today's training: **Geography**" — names the targeted weak area.
- **Post-session:** the category **mastery level** ticks up (e.g. ◉◉◉○○ → **Level 3**), with a specific, honest callout ("you're sharpening **Astronomy**" / "leveled up **Geography**"). The latent math is hidden; the player sees clean levels + movement.
- **"Your Growth"** (`services/growth.py`) already trends per-category accuracy; the new mastery estimate becomes the more meaningful spine of that surface (integration detail in the plan).
- Copy obeys DESIGN §7 (no casino/gambling language; honest, motivating).

*(The daily-training streak/goal that rewards showing up is the **retention** pillar — a later spec. We expose the mastery/target data cleanly so that layer can consume it.)*

---

## 6. Guardrails

- **Ranked untouched:** the engine never affects Daily Royale selection or scoring; `personalize_ranked_daily` stays `false`.
- **Points formula unchanged.**
- **Server-authoritative:** skill updates use server-derived signals only; client-reported correctness/scores are ignored (consistent with the anti-cheat contract).
- **Best-effort:** a skill-update failure never sinks the surrounding score write (same pattern as `record_answer_signal` today).
- **Cold-start graceful fallback** to the existing interest-based selection.
- **Feature-flagged:** a settings flag (e.g. `adaptive_learning_enabled`, default on but killable) so it can be disabled without a deploy revert.

---

## 7. Testing

- **Pure-function unit tests** (no DB): the KT update moves `θ`/`P(known)` correctly for correct/incorrect on easy/hard items; **shrinkage** — a sparse topic tracks its category prior, a well-sampled topic diverges; **difficulty targeting** picks items whose predicted success ≈ target; **scheduler** — weak topics resurface on the expanding schedule and **never repeat a question**.
- **Integration tests:** a full Brain Boost composition (targets the weakest data-rich category, honors the ~fun-first ratio, no repeat questions, respects cold-start fallback).
- **Fairness test:** ranked Daily Royale selection is byte-for-byte unaffected by any skill state.
- **Backend gate:** ruff + ruff format + mypy + full pytest green; frontend typecheck + lint + vitest green for any UI.

---

## 8. Phasing (this is a multi-phase build)

Because "heavy/precise" is genuinely the largest option, the plan should stage it so each phase is shippable and verifiable:

1. **Phase 1 — Skill model + capture.** `user_skill_state` table + migration; the KT/shrinkage update wired into `record_answer_signal`; unit tests. No behavior change yet (silent learning).
2. **Phase 2 — Adaptive selection.** Learning-need scorer + scheduler in `personalize_bank`; Brain Boost session composed adaptively; difficulty targeting; cold-start fallback; tests.
3. **Phase 3 — Felt improvement (UI).** Brain Boost "Today's training" framing + category mastery levels + post-session movement; wire mastery into Your Growth.
4. **(Deferred)** optional batch item-param refit; in-session micro-adaptation; the retention layer (separate pillar).

---

## 9. Open questions to resolve in the plan

- Exact KT/IRT update equations + prior constants (and where they live — `core/constants.py`).
- `user_skill_state` physical shape (JSONB-on-row vs normalized).
- Thresholds: `CATEGORY_MIN_RESPONSES`, `TOPIC_INDEPENDENCE_MIN`, review-interval schedule, target-success bands.
- How mastery `θ` maps to the displayed level buckets (◉◉◉○○) — fixed cut-points vs percentile.
- Whether category sessions get difficulty targeting in Phase 2 or later.
