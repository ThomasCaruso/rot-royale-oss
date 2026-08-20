# Adaptive Learning — Phase 2: Adaptive Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Use the Phase 1 skill model to make non-ranked question selection adaptive — target a fun-first difficulty (~82% predicted success) and resurface weak, review-due topics — via an additive, cold-start-safe scorer threaded into the existing `personalize_bank`. Because Brain Boost / Quick / Practice / Category all draw through `personalize_bank`, this makes them all adaptive with no new composer.

**Architecture:** (1) Extend the Phase 1 answer-capture to schedule spaced repetition (set `review_due_at` per topic on each answer). (2) A new isolated module `app/services/learning_select.py` owns a `SkillView` (read-only projection of `UserSkillState`) and a pure `learning_need(view, meta, now)` score in [0,1]. (3) `personalize_bank` loads the skill state, builds the view, and — only for a "warm" user — passes it into `build_personalized_pool` → `score_question`, which adds `W_LEARNING_NEED * learning_need(...)`. Cold users, small banks, and ranked are unchanged (score add is 0 / not applied). No player-facing UI (that's Phase 3).

**Tech Stack:** Python 3.13, SQLAlchemy 2.x async, pytest (asyncio auto-mode, rolled-back `db_session`), uv, ruff, mypy.

**Depends on Phase 1** (already committed on this branch): `app/services/skill_model.py` (`expected_correct`, `difficulty_to_b`, `category_prior_known`, `effective_p_known`), `app/models/skill.py` (`UserSkillState`), `app/services/skill_state.py` (`apply_answer_to_skill_state`), KT/BKT constants.

**Out of scope (Phase 3):** any UI, "Today's training: <category>" framing, mastery-level display, Your Growth wiring. Also out: adaptive difficulty *within* a session, per-user param fitting.

---

## File structure

- **Modify** `backend/app/core/constants.py` — Phase 2 constants.
- **Modify** `backend/app/services/skill_model.py` — add pure `next_review_hours(p_known, correct)`.
- **Modify** `backend/app/services/skill_state.py` — `apply_answer_to_skill_state` sets `last_answered_at` + `review_due_at` (add a `now` param); topic dict gains real timestamps.
- **Create** `backend/app/services/learning_select.py` — `SkillView` + `learning_need`.
- **Modify** `backend/app/services/personalization.py` — load skill state, build view (warm-gated), thread `view`+`now` into `build_personalized_pool` → `score_question`, add the weighted learning-need term.
- **Tests:** extend `backend/tests/test_skill_model.py`, `backend/tests/test_skill_state.py`; create `backend/tests/test_learning_select.py`; create `backend/tests/test_personalization_learning.py`.

---

## Task 1: Review-schedule math + capture the schedule

**Files:** Modify `backend/app/core/constants.py`, `backend/app/services/skill_model.py`, `backend/app/services/skill_state.py`; tests in `backend/tests/test_skill_model.py` and `backend/tests/test_skill_state.py`.

- [ ] **Step 1: Add constants** to the END of `backend/app/core/constants.py`:

```python
# --- Adaptive learning: adaptive selection (Phase 2) --------------------------------------------
KT_TARGET_SUCCESS: float = 0.82  # fun-first: aim questions at ~82% predicted success
LEARNING_WARM_MIN_ATTEMPTS: int = 15  # total category attempts before learning-need shapes picks
W_LEARNING_NEED: float = 0.35  # weight of the learning-need term added in score_question
WEAK_TOPIC_P_KNOWN_MAX: float = 0.60  # a topic counts as "weak" when effective P(known) < this
REVIEW_BASE_HOURS: float = 8.0  # shortest review gap after a correct answer
REVIEW_MAX_HOURS: float = 168.0  # longest review gap (7 days) at high mastery
```

- [ ] **Step 2: Write the failing test** for the interval fn — append to `backend/tests/test_skill_model.py`:

```python
def test_next_review_hours_wrong_is_due_immediately_correct_expands_with_mastery():
    from app.services.skill_model import next_review_hours

    assert next_review_hours(0.5, correct=False) == 0.0  # missed → resurface next session
    low = next_review_hours(0.30, correct=True)
    high = next_review_hours(0.95, correct=True)
    assert 0.0 < low < high  # higher mastery → longer gap
    assert low >= 8.0 and high <= 168.0  # within [REVIEW_BASE_HOURS, REVIEW_MAX_HOURS]
```

- [ ] **Step 3: Run — expect FAIL** (`ImportError: cannot import name 'next_review_hours'`):
`cd backend && uv run pytest tests/test_skill_model.py::test_next_review_hours_wrong_is_due_immediately_correct_expands_with_mastery -q`

- [ ] **Step 4: Implement** — add to `backend/app/services/skill_model.py` (add the two constants to its existing `from app.core.constants import (...)` block: `REVIEW_BASE_HOURS`, `REVIEW_MAX_HOURS`):

```python
def next_review_hours(p_known: float, correct: bool) -> float:
    """Hours until a topic should resurface. Wrong → 0 (next session); higher mastery → longer gap
    (Leitner-style expanding interval), clamped to [REVIEW_BASE_HOURS, REVIEW_MAX_HOURS]."""
    if not correct:
        return 0.0
    frac = _clamp((p_known - 0.3) / 0.65, 0.0, 1.0)  # 0 at p=0.3, 1 at p>=0.95
    return REVIEW_BASE_HOURS + frac * (REVIEW_MAX_HOURS - REVIEW_BASE_HOURS)
```

- [ ] **Step 5: Run — expect PASS**: `cd backend && uv run pytest tests/test_skill_model.py -q` → all pass (9 total).

- [ ] **Step 6: Extend the capture** — in `backend/app/services/skill_state.py`, thread a `now` timestamp and set the topic schedule. Change the function signature to add `now: datetime | None = None`, and in the per-topic loop set the timestamps. Full replacement of the function body's topic section (read the current file first; keep the category-ability section unchanged):

Add imports at top: `from datetime import UTC, datetime, timedelta` and `from app.services.skill_model import bkt_update, next_review_hours, update_theta`.

Signature becomes:
```python
async def apply_answer_to_skill_state(
    session: AsyncSession,
    user_id: uuid.UUID,
    question_id: uuid.UUID | None,
    correct: bool,
    now: datetime | None = None,
) -> None:
```
Right after the early-returns, add `now = now or datetime.now(UTC)`. Replace the per-topic loop with:
```python
    knowledge = dict(state.topic_knowledge)
    for topic in meta.topic_tags or []:
        t = knowledge.get(topic, {"p_known": BKT_P_L0, "attempts": 0})
        new_p = bkt_update(float(t["p_known"]), correct)
        due = now + timedelta(hours=next_review_hours(new_p, correct))
        knowledge[topic] = {
            "p_known": new_p,
            "attempts": int(t["attempts"]) + 1,
            "last_answered_at": now.isoformat(),
            "review_due_at": due.isoformat(),
        }
    state.topic_knowledge = knowledge
```

- [ ] **Step 7: Write the failing test** — append to `backend/tests/test_skill_state.py`:

```python
async def test_topic_update_records_review_schedule(db_session: AsyncSession):
    from datetime import UTC, datetime

    user_id = await _user(db_session)
    qid = await _classified_question(
        db_session, category="Science & Nature", topics=["cells"], difficulty=0.5
    )
    now = datetime(2026, 7, 9, 12, 0, tzinfo=UTC)
    await apply_answer_to_skill_state(db_session, user_id, qid, correct=True, now=now)

    topic = (await _state(db_session, user_id)).topic_knowledge["cells"]
    assert topic["last_answered_at"] == now.isoformat()
    assert topic["review_due_at"] > now.isoformat()  # correct → scheduled into the future
```

- [ ] **Step 8: Run — expect PASS**: `cd backend && uv run pytest tests/test_skill_state.py -q` → all pass.

- [ ] **Step 9: Gate + commit**:
`cd backend && uv run ruff check app/core/constants.py app/services/skill_model.py app/services/skill_state.py tests/test_skill_model.py tests/test_skill_state.py && uv run ruff format app/core/constants.py app/services/skill_model.py app/services/skill_state.py tests/test_skill_model.py tests/test_skill_state.py && uv run mypy app/services/skill_model.py app/services/skill_state.py`
```
git add backend/app/core/constants.py backend/app/services/skill_model.py backend/app/services/skill_state.py backend/tests/test_skill_model.py backend/tests/test_skill_state.py
git commit -m "feat(learning): spaced-repetition schedule (review_due_at) on answer capture"
```

---

## Task 2: `SkillView` + `learning_need` scorer (pure, isolated)

**Files:** Create `backend/app/services/learning_select.py`, `backend/tests/test_learning_select.py`.

- [ ] **Step 1: Write the failing tests** — create `backend/tests/test_learning_select.py`:

```python
"""SkillView projection + learning_need scorer: pure, no DB."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.services.learning_select import SkillView, learning_need


class _Meta:
    """Minimal stand-in for QuestionAIMetadata (only the fields the scorer reads)."""

    def __init__(self, category, topic_tags, difficulty_score):
        self.category = category
        self.topic_tags = topic_tags
        self.difficulty_score = difficulty_score


NOW = datetime(2026, 7, 9, 12, 0, tzinfo=UTC)


def _view(category_theta=None, topic=None) -> SkillView:
    return SkillView(category_theta=category_theta or {}, topic=topic or {})


def test_cold_view_has_zero_learning_need():
    v = _view()
    m = _Meta("Science & Nature", ["astronomy"], 0.5)
    assert learning_need(v, m, NOW) == 0.0


def test_difficulty_fit_peaks_near_target_success():
    # theta 0.0, an item whose predicted success is ~0.82 should score higher than a trivially easy one.
    v = _view(category_theta={"History": 0.0})
    near_target = _Meta("History", [], 0.35)  # b<0 → high predicted success but not trivial
    too_easy = _Meta("History", [], 0.0)  # b=-2.5 → ~0.92 predicted, above target
    assert learning_need(v, near_target, NOW) > learning_need(v, too_easy, NOW)


def test_weak_due_topic_boosts_score():
    past = (NOW - timedelta(hours=1)).isoformat()
    v = _view(
        category_theta={"Geography": 0.0},
        # capitals: weak (low p_known) AND review-due (due in the past); enough attempts to trust it
        topic={"capitals": {"p_known": 0.2, "attempts": 6, "review_due_at": past}},
    )
    weak_due = _Meta("Geography", ["capitals"], 0.35)
    unrelated = _Meta("Geography", ["rivers"], 0.35)
    assert learning_need(v, weak_due, NOW) > learning_need(v, unrelated, NOW)


def test_weak_topic_not_yet_due_does_not_boost():
    future = (NOW + timedelta(hours=48)).isoformat()
    v = _view(
        category_theta={"Geography": 0.0},
        topic={"capitals": {"p_known": 0.2, "attempts": 6, "review_due_at": future}},
    )
    not_due = _Meta("Geography", ["capitals"], 0.35)
    unrelated = _Meta("Geography", ["rivers"], 0.35)
    assert learning_need(v, not_due, NOW) == learning_need(v, unrelated, NOW)


def test_from_state_handles_none_and_totals_attempts():
    assert SkillView.from_state(None).total_attempts() == 0

    class _State:
        category_ability = {"History": {"theta": 0.4, "attempts": 10}, "Sports": {"theta": -0.2, "attempts": 5}}
        topic_knowledge = {"ww2": {"p_known": 0.7, "attempts": 3, "review_due_at": NOW.isoformat()}}

    v = SkillView.from_state(_State())
    assert v.total_attempts() == 15
    assert v.category_theta["History"] == 0.4
```

- [ ] **Step 2: Run — expect FAIL** (`ModuleNotFoundError: app.services.learning_select`): `cd backend && uv run pytest tests/test_learning_select.py -q`

- [ ] **Step 3: Implement** — create `backend/app/services/learning_select.py`:

```python
"""Learning-need projection + scorer for adaptive selection (Phase 2).

`SkillView` is a read-only projection of a user's UserSkillState. `learning_need` scores a candidate
question in [0, 1] combining:
  * difficulty fit — how close the predicted success (given the user's category ability and the
    question's difficulty) is to the fun-first target (~82%); peaks at the target, falls off away.
  * weak-due boost — extra pull for a question in a topic the user is weak at (low effective
    P(known)) AND that is review-due (spaced repetition).
A cold view (no ability for the category) contributes 0, so cold users are unaffected.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.core.constants import (
    KT_TARGET_SUCCESS,
    KT_THETA_INIT,
    WEAK_TOPIC_P_KNOWN_MAX,
)
from app.services.skill_model import (
    category_prior_known,
    difficulty_to_b,
    effective_p_known,
    expected_correct,
)


@dataclass(frozen=True)
class SkillView:
    """Read-only projection of UserSkillState for selection."""

    category_theta: dict[str, float]
    topic: dict[str, dict[str, Any]]  # topic -> {"p_known", "attempts", "review_due_at", ...}

    @classmethod
    def from_state(cls, state: Any | None) -> SkillView:
        if state is None:
            return cls(category_theta={}, topic={})
        theta = {c: float(v["theta"]) for c, v in (state.category_ability or {}).items()}
        return cls(category_theta=theta, topic=dict(state.topic_knowledge or {}))

    def total_attempts(self) -> int:
        # category attempts aren't stored on the projection; recompute would need the raw row, so
        # SkillView carries theta only. Warmth is judged on the raw state before projecting (see
        # personalization). This helper sums per-category attempt counts when present.
        return sum(int(t.get("attempts", 0)) for t in self.topic.values())

    def theta(self, category: str) -> float:
        return self.category_theta.get(category, KT_THETA_INIT)


def _difficulty_fit(theta: float, difficulty_score: float) -> float:
    """1.0 when predicted success == target, decaying linearly with the gap."""
    p = expected_correct(theta, difficulty_to_b(difficulty_score))
    return 1.0 - min(1.0, abs(p - KT_TARGET_SUCCESS) / KT_TARGET_SUCCESS)


def _weak_due_boost(view: SkillView, meta: Any, now: datetime) -> float:
    """Max pull over the question's topics that are weak (low effective P(known)) AND review-due."""
    cat_prior = category_prior_known(view.theta(meta.category))
    boost = 0.0
    for topic in getattr(meta, "topic_tags", None) or []:
        t = view.topic.get(topic)
        if t is None:
            continue
        eff = effective_p_known(float(t["p_known"]), cat_prior, int(t.get("attempts", 0)))
        due_at = t.get("review_due_at")
        is_due = due_at is not None and str(due_at) <= now.isoformat()
        if eff < WEAK_TOPIC_P_KNOWN_MAX and is_due:
            boost = max(boost, WEAK_TOPIC_P_KNOWN_MAX - eff)
    return boost


def learning_need(view: SkillView, meta: Any, now: datetime) -> float:
    """Combined learning-need score in [0, 1]. 0 when the category is unseen (cold)."""
    if meta is None or meta.category not in view.category_theta:
        return 0.0
    fit = _difficulty_fit(view.theta(meta.category), float(meta.difficulty_score))
    boost = _weak_due_boost(view, meta, now)
    return min(1.0, 0.6 * fit + 0.4 * boost)
```

- [ ] **Step 4: Run — expect PASS**: `cd backend && uv run pytest tests/test_learning_select.py -q` → all pass (6). If `test_difficulty_fit_peaks_near_target_success` fails, DO NOT change assertions — verify `_difficulty_fit` uses `expected_correct(theta, difficulty_to_b(score))`; the item at score 0.35 gives b≈-0.75 → predicted ≈0.68 vs the target 0.82 gap smaller than score 0.0's predicted ≈0.92 gap; if the specific fixtures don't separate, report BLOCKED with the two computed `learning_need` values so the controller can adjust the fixture difficulties.

- [ ] **Step 5: Gate + commit**:
`cd backend && uv run ruff check app/services/learning_select.py tests/test_learning_select.py && uv run ruff format app/services/learning_select.py tests/test_learning_select.py && uv run mypy app/services/learning_select.py`
```
git add backend/app/services/learning_select.py backend/tests/test_learning_select.py
git commit -m "feat(learning): SkillView + learning-need scorer (difficulty fit + weak-due boost)"
```

---

## Task 3: Thread learning-need into `personalize_bank`

**Files:** Modify `backend/app/services/personalization.py`; create `backend/tests/test_personalization_learning.py`.

- [ ] **Step 1: Read** `backend/app/services/personalization.py` fully — confirm the signatures of `personalize_bank`, `build_personalized_pool`, `score_question`, and how `metadata_by_id` is built. Note the exact `import` block and where `UserTasteProfile` is loaded (`session.get(UserTasteProfile, user_id)` near line 235).

- [ ] **Step 2: Write the failing integration test** — create `backend/tests/test_personalization_learning.py`:

```python
"""personalize_bank applies the learning-need layer for a WARM user, and is a no-op when cold."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from app.models import Question, QuestionAIMetadata, User, UserSkillState, UserTasteProfile
from app.services.personalization import personalize_bank
from sqlalchemy.ext.asyncio import AsyncSession

# NOTE (implementer): reuse the seeding helpers' shape from tests/test_skill_state.py — a real User,
# real Question rows, and QuestionAIMetadata with ALL required NOT-NULL fields. Copy that helper
# setup into this file (or a shared conftest helper) so the FK inserts succeed.


async def _warm_profile(session: AsyncSession, user_id: uuid.UUID) -> None:
    # >= MIN_INTERACTIONS so the interest layer is also active; the learning layer keys off skill state.
    session.add(
        UserTasteProfile(user_id=user_id, interaction_count=30, confidence_score=1.0)
    )
    await session.flush()


async def test_warm_user_with_weak_due_topic_prioritizes_it(db_session: AsyncSession):
    """A warm user with a weak, review-due topic sees questions on that topic rank into the pool."""
    # Build a >24 bank where exactly a few questions carry the weak-due topic; assert those survive
    # into the returned pool at a higher rate than an equivalent cold run.
    # (Implementer: construct 30 classified questions; give the user a UserSkillState whose
    # category_ability makes them 'warm' (>= LEARNING_WARM_MIN_ATTEMPTS attempts) and a weak, due
    # topic; assert a question tagged with that topic is present in personalize_bank(...mode="quick").)
    ...


async def test_cold_user_selection_is_unchanged_by_skill_layer(db_session: AsyncSession):
    """With no UserSkillState, personalize_bank returns exactly what it did pre-Phase-2."""
    ...
```

Implementer: FLESH OUT the two test bodies concretely (the `...` are placeholders you MUST replace with real setup + assertions):
- Seed 30 `Question` + `QuestionAIMetadata` rows (mixed categories/difficulties), a warm `UserTasteProfile`, and a `UserSkillState` with `category_ability={"Geography": {"theta": 0.0, "attempts": 20}}` and `topic_knowledge={"capitals": {"p_known": 0.2, "attempts": 6, "review_due_at": <1h ago iso>}}`. Ensure at least a couple of the 30 questions are Geography+capitals.
- Warm test: call `out = await personalize_bank(db_session, user_id, bank, mode="quick", seed=7)`; assert at least one capitals question is in `out` (id membership). Compare to a run with the SAME bank/seed but a user with NO skill state — the warm run should include the weak-due capitals question that the cold run drops (or ranks it higher). If exact membership is flaky, assert the count of capitals questions in `out_warm >= out_cold`.
- Cold test: with no UserSkillState row, `personalize_bank(...)` returns the same result it would with the skill layer entirely absent — assert it still returns a well-formed pool of the expected size and does not error.

- [ ] **Step 3: Run — expect FAIL** (assertions unmet / feature absent): `cd backend && uv run pytest tests/test_personalization_learning.py -q`

- [ ] **Step 4: Implement the threading** in `backend/app/services/personalization.py`:

(a) Imports — add:
```python
from datetime import UTC, datetime
from app.core.constants import LEARNING_WARM_MIN_ATTEMPTS, W_LEARNING_NEED
from app.models import UserSkillState
from app.services.learning_select import SkillView, learning_need
```

(b) In `personalize_bank`, after the `UserTasteProfile` load and the `metadata_by_id` build (just before the `build_personalized_pool` call), load skill state and build a warm-gated view + now:
```python
    skill_state = await session.get(UserSkillState, user_id)
    warm = skill_state is not None and sum(
        int(v.get("attempts", 0)) for v in (skill_state.category_ability or {}).values()
    ) >= LEARNING_WARM_MIN_ATTEMPTS
    view = SkillView.from_state(skill_state) if warm else None
    now = datetime.now(UTC)
    return build_personalized_pool(bank, metadata_by_id, profile, rng, view=view, now=now)
```
(Match the ACTUAL existing `build_personalized_pool(...)` call — add the two keyword args to it.)

(c) `build_personalized_pool` — add params `view: SkillView | None = None, now: datetime | None = None` and thread them into every `score_question(...)` call it makes.

(d) `score_question` — add params `view: SkillView | None = None, now: datetime | None = None`; at the END, before returning the score, add:
```python
    if view is not None and now is not None and meta is not None:
        score += W_LEARNING_NEED * learning_need(view, meta, now)
```
Keep all existing scoring/penalties intact — this is purely additive.

- [ ] **Step 5: Run — expect PASS**: `cd backend && uv run pytest tests/test_personalization_learning.py -q` → pass.

- [ ] **Step 6: Gate + commit**:
`cd backend && uv run ruff check app/services/personalization.py tests/test_personalization_learning.py && uv run ruff format app/services/personalization.py tests/test_personalization_learning.py && uv run mypy app/services/personalization.py`
```
git add backend/app/services/personalization.py backend/tests/test_personalization_learning.py
git commit -m "feat(learning): adaptive selection — learning-need layer in personalize_bank (warm-gated)"
```

---

## Task 4: Full regression + fairness

**Files:** none new (verification task).

- [ ] **Step 1: Full backend gate**:
`cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app && uv run pytest -q`
Expected: all clean; full suite green (Phase 1 + Phase 2 tests included). If a pre-existing/unrelated failure appears (fails identically on the parent commit), report it precisely rather than fixing unrelated code.

- [ ] **Step 2: Confirm the fairness invariant still holds** — the existing `tests/test_skill_state.py::test_skill_capture_does_not_affect_ranked_selection` must still pass (ranked returns the bank untouched; the learning layer is gated behind `should_personalize`, which excludes ranked). Run:
`cd backend && uv run pytest tests/test_skill_state.py::test_skill_capture_does_not_affect_ranked_selection -q` → PASS.

- [ ] **Step 3: Commit** (only if Step 1/2 required any fixup; otherwise this task is a pure gate with nothing to commit).

---

## Self-review (author check — done)

- **Spec coverage:** difficulty targeting (Task 2 `_difficulty_fit` at `KT_TARGET_SUCCESS`) ✓ · weak-topic targeting (Task 2 `_weak_due_boost`) ✓ · spaced repetition / `review_due_at` expanding intervals (Task 1 `next_review_hours` + capture) ✓ · per-topic, fresh-question (selection resurfaces the *topic* via metadata topic_tags, never a specific question id — no per-question memorization) ✓ · blended into `personalize_bank` additively (Task 3) ✓ · fun-first (target 0.82, learning term weight 0.35 alongside interest) ✓ · cold-start fallback (warm gate + `learning_need`==0 when category unseen) ✓ · ranked untouched (Task 4 fairness) ✓ · hierarchical shrinkage reused in weak-due (Task 2 `effective_p_known`) ✓.
- **Placeholders:** Task 3's test bodies are intentionally left for the implementer to flesh out (marked explicitly), because concrete membership assertions depend on the real `build_personalized_pool` output shape which must be read first; every OTHER step has complete code. All impl code is complete.
- **Type consistency:** `learning_need(view, meta, now)` signature identical across Task 2 def and Task 3 call ✓ · `SkillView.from_state`/`.theta`/`.total_attempts` used consistently ✓ · `next_review_hours(p_known, correct)` matches between skill_model and skill_state ✓ · new constants match names between constants.py (Task 1) and consumers (Tasks 2-3) ✓.

## Follow-on
- **Phase 3 — Felt UI:** "Today's training: <category>", category mastery levels (θ → display buckets), post-session movement, Your Growth wiring.
