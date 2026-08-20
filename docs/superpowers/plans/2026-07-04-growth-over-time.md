# Growth Over Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the per-answer signal (from sub-project A) into a day-over-day trajectory and surface it in a "Your Growth" dashboard — a rolling Rot Score trend + per-category movers + consistency.

**Architecture:** A new `user_daily_stats` table is upserted incrementally by A's existing capture seam (`record_answer_signal`), so today's progress is always live with no rollup job. The Rot Score maths is extracted into a shared `rot_score.py` (one definition, reused by rot_check and growth). A read service computes a trailing-7-day rolling Rot Score + per-category series, exposed at `GET /me/growth` and rendered by a new `GrowthScreen` that replaces the Campaign pill on Home (Campaign keeps its nav-menu entry).

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, Alembic, pytest (async, rolled-back-transaction fixtures); React/TS, Vitest.

---

## Spec

`docs/superpowers/specs/2026-07-04-growth-over-time-design.md`. Key locked decisions: Rot Score + per-category; incremental daily snapshot upserted in A's seam; rolling-7-day smoothed trend; data layer + one "Your Growth" dashboard (layout B); Home swaps the Campaign pill for "Your Growth" (Campaign stays in `AppNav`). New `growth_tracking_enabled` flag (default true).

## Reference facts (verified in the codebase)

- **Rot Score maths** lives inline in `backend/app/services/rot_check.py`: constants `SCORE_MIN=300, SCORE_MAX=900, _SCORE_ACCURACY_WEIGHT=400, _SCORE_SPEED_WEIGHT=120, _SCORE_STREAK_WEIGHT=15, _SCORE_HARD_BONUS=5`, and `_score(accuracy, avg_time_frac, best_streak, hard_correct)` = `clamp(300 + accuracy*400 + avg_time_frac*120 + best_streak*15 + hard_correct*5, 300, 900)`.
- **Capture seam** (from A): `taste_profile.record_answer_signal(session, user_id, *, question_id, mode, is_correct, time_frac, limit_ms, streak_before=None, streak_after=None, session_id=None)`. Called at 4 chokepoints, each holding a `server_answer` dict (`answer.server_answer` for practice/contest/duel; `answer_row["server_answer"]` for friend_duel) which carries `"difficulty"` and `"question_id"`.
- **Alembic head:** `cc33dd44ee55`. Migrations: `cd backend && uv run alembic revision --autogenerate -m "..."` then `uv run alembic upgrade head`. Models must be imported in `app/models/__init__.py` (`__all__`) for autogenerate to see them.
- **Config flag pattern** (`app/core/config.py`): `personalization_enabled: bool = Field(default=True)`.
- **Frontend fetch pattern:** screens call `api.x()` inside `useEffect` with `useState` (see `Home.tsx` `rotCheckToday`). react-query is available but not required here.
- **Home Campaign pill:** `frontend/src/screens/Home.tsx` — two `monoRows` arrays (lines ~279-291) each end with `{ key: "campaign", label: t.nav.campaign, icon: <MapIcon size={19} />, onClick: onCampaign }`; arcade path renders `<HubTiles onCampaign={onCampaign} ... />` (line ~429). Campaign also wired through `AppNav` (`onCampaign`) in `App.tsx` — leave that.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `backend/app/services/rot_score.py` | Pure Rot Score maths (shared) | **Create** |
| `backend/app/services/rot_check.py` | Rot Check summary | Import `rot_score` (remove inline `_score`/constants) |
| `backend/app/models/personalization.py` | Personalization + growth models | Add `UserDailyStats` |
| `backend/app/models/__init__.py` | Model registry | Export `UserDailyStats` |
| `backend/alembic/versions/*_user_daily_stats.py` | Schema | **Create** (autogenerate) |
| `backend/app/core/config.py` | Settings | Add `growth_tracking_enabled` |
| `backend/app/services/growth.py` | Daily-stats upsert + growth read | **Create** |
| `backend/app/services/taste_profile.py` | Capture seam | `record_answer_signal` gains `difficulty`, calls growth upsert |
| `backend/app/services/{practice,contest,duel,friend_duel}.py` | Chokepoints | Pass `difficulty=` |
| `backend/app/schemas/growth.py` | API schema | **Create** |
| `backend/app/api/me.py` (or new `api/growth.py`) | Read endpoint | Add `GET /me/growth` |
| `backend/tests/test_growth.py` | Growth tests | **Create** |
| `frontend/src/api/client.ts` | API client | Add `getGrowth` + types |
| `frontend/src/screens/growth/GrowthScreen.tsx` | Dashboard | **Create** |
| `frontend/src/screens/Home.tsx` | Home | Swap Campaign pill → Growth |
| `frontend/src/screens/home/HubTiles.tsx` | Arcade tiles | Swap Campaign tile → Growth |
| `frontend/src/app/App.tsx` | Shell | Wire growth flow (mirror Vault) |
| `frontend/src/i18n/{en,es,tr}.ts` | Copy | Add `growth` group |

---

### Task 1: Extract the Rot Score maths into a shared module

**Files:**
- Create: `backend/app/services/rot_score.py`
- Modify: `backend/app/services/rot_check.py` (import from the new module)
- Test: `backend/tests/test_rot_score.py` (new) + existing `backend/tests/test_rot_check*.py` stay green (parity guard)

- [ ] **Step 1: Write the failing test** — create `backend/tests/test_rot_score.py`:

```python
"""Pure Rot Score maths (shared by rot_check + growth)."""

from app.services.rot_score import SCORE_MAX, SCORE_MIN, rot_score


def test_rot_score_matches_known_points() -> None:
    # 300 + 1.0*400 + 1.0*120 + 3*15 + 2*5 = 875
    assert rot_score(accuracy=1.0, avg_time_frac=1.0, best_streak=3, hard_correct=2) == 875


def test_rot_score_clamps_low_and_high() -> None:
    assert rot_score(accuracy=0.0, avg_time_frac=0.0, best_streak=0, hard_correct=0) == SCORE_MIN
    assert rot_score(accuracy=1.0, avg_time_frac=1.0, best_streak=100, hard_correct=100) == SCORE_MAX
```

- [ ] **Step 2: Run, expect FAIL** (module missing):
`cd backend && uv run pytest tests/test_rot_score.py -v`

- [ ] **Step 3: Create `backend/app/services/rot_score.py`:**

```python
"""The Rot Score — the single 300..900 measure of a player's sharpness (correctness + speed +
streak + difficulty spice). Pure maths, shared by the Rot Check (per-check) and growth (rolling
daily) so there is exactly one definition."""

from __future__ import annotations

SCORE_MIN, SCORE_MAX = 300, 900
_ACCURACY_WEIGHT = 400
_SPEED_WEIGHT = 120
_STREAK_WEIGHT = 15
_HARD_BONUS = 5  # per hard question answered correctly


def rot_score(*, accuracy: float, avg_time_frac: float, best_streak: int, hard_correct: int) -> int:
    """accuracy/avg_time_frac in 0..1 (higher time_frac = faster). Clamped to [SCORE_MIN, SCORE_MAX]."""
    raw = (
        SCORE_MIN
        + accuracy * _ACCURACY_WEIGHT
        + avg_time_frac * _SPEED_WEIGHT
        + best_streak * _STREAK_WEIGHT
        + hard_correct * _HARD_BONUS
    )
    return max(SCORE_MIN, min(SCORE_MAX, round(raw)))
```

- [ ] **Step 4: Rewire `rot_check.py`** to use the shared function without changing behaviour. At the top imports add:
```python
from app.services.rot_score import SCORE_MAX, SCORE_MIN, rot_score
```
Delete the local `SCORE_MIN, SCORE_MAX = 300, 900`, the four `_SCORE_*_WEIGHT`/`_SCORE_HARD_BONUS` constants, and the `def _score(...)` function. Replace the single call site (in `summarize_check`) `rot_score=_score(accuracy, avg_time_frac, best_streak, hard_correct)` with:
```python
        rot_score=rot_score(
            accuracy=accuracy,
            avg_time_frac=avg_time_frac,
            best_streak=best_streak,
            hard_correct=hard_correct,
        ),
```
If any other symbol in `rot_check.py` still references `SCORE_MIN`/`SCORE_MAX`, they now come from the import (keep them working).

- [ ] **Step 5: Run, expect PASS** (new maths test + ALL existing rot-check tests unchanged — this is the parity guard):
`cd backend && uv run pytest tests/test_rot_score.py tests/test_rot_check.py -v`
(If the rot-check test file has a different name, discover it: `cd backend && uv run pytest -k rot_check -v`.)
Then ruff: `cd backend && uv run ruff check app/services/rot_score.py app/services/rot_check.py tests/test_rot_score.py`

- [ ] **Step 6: Do NOT commit** (per user decision — version control deferred). Report.

---

### Task 2: `UserDailyStats` model + migration

**Files:**
- Modify: `backend/app/models/personalization.py` (add model), `backend/app/models/__init__.py` (export)
- Create: `backend/alembic/versions/<hash>_user_daily_stats.py` (autogenerated)

- [ ] **Step 1: Add the model** to `backend/app/models/personalization.py` (it already imports `Boolean, DateTime, Float, ForeignKey, Integer, String, func, text`, `JSONB`, `Mapped, mapped_column`, `uuid`, `datetime`; add `Date` to the `sqlalchemy` import and `date` to the `datetime` import):

```python
class UserDailyStats(Base):
    """One row per (user, ET calendar day): the raw daily rollup that the growth trajectory is
    computed from. Upserted incrementally as answers land (services/growth.py). Personalization/
    product-analytics only — never touches scores/coins/rating."""

    __tablename__ = "user_daily_stats"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    stat_date: Mapped[date] = mapped_column(Date, primary_key=True)

    answers: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    correct: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    sum_time_frac: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))
    best_streak: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    hard_correct: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    # {category: {"a": answers, "c": correct}}
    per_category: Mapped[dict[str, dict[str, int]]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
```

- [ ] **Step 2: Export it** in `backend/app/models/__init__.py`: add `UserDailyStats` to the `from app.models.personalization import (...)` block and to `__all__`.

- [ ] **Step 3: Autogenerate the migration:**
`cd backend && PYTHONIOENCODING=utf-8 uv run alembic revision --autogenerate -m "user daily stats"`
Open the generated file in `backend/alembic/versions/`. Verify: `down_revision = "cc33dd44ee55"`, and the ONLY schema change is `op.create_table("user_daily_stats", ...)` (composite PK on `user_id, stat_date`). If autogenerate added anything unrelated (drift from other models), delete those lines so the migration creates only `user_daily_stats` and its FK/index.

- [ ] **Step 4: Apply + verify:**
`cd backend && PYTHONIOENCODING=utf-8 uv run alembic upgrade head`
Then confirm the table exists: `cd backend && uv run python -c "import asyncio; from sqlalchemy import text; from app.core.db import engine; asyncio.run(__import__('app.core.db', fromlist=['engine']) and None)"` — simpler: run the model import test in Step 5 (it will fail table-not-found if the migration didn't apply).

- [ ] **Step 5: Smoke test** — create `backend/tests/test_growth.py` with an initial model test:

```python
"""Growth trajectory: daily-stats upsert, rolling Rot Score, per-category, /me/growth."""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserDailyStats

pytestmark = pytest.mark.asyncio


async def _user(session: AsyncSession) -> User:
    user = User(email=f"{uuid.uuid4().hex[:12]}@example.com", password_hash="x")
    session.add(user)
    await session.flush()
    return user


async def test_user_daily_stats_row_persists(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    db_session.add(UserDailyStats(user_id=user.id, stat_date=date(2026, 7, 4), answers=3, correct=2))
    await db_session.flush()
    row = (
        await db_session.execute(
            select(UserDailyStats).where(UserDailyStats.user_id == user.id)
        )
    ).scalar_one()
    assert row.answers == 3 and row.correct == 2 and row.per_category == {}
```

Run: `cd backend && uv run pytest tests/test_growth.py -v` → PASS. Ruff clean.

- [ ] **Step 6: Do NOT commit.** Report (include the generated migration filename).

---

### Task 3: `growth_tracking_enabled` config flag

**Files:** Modify `backend/app/core/config.py`; Test `backend/tests/test_growth.py`.

- [ ] **Step 1: Add the setting** near `personalization_enabled` in `app/core/config.py`:
```python
    growth_tracking_enabled: bool = Field(default=True)
```

- [ ] **Step 2: Verify** it loads:
`cd backend && uv run python -c "from app.core.config import settings; print(settings.growth_tracking_enabled)"` → prints `True`.

- [ ] **Step 3: Do NOT commit.** Report. (No standalone test — it's exercised by Task 5's gating test.)

---

### Task 4: `growth.update_daily_stats` (+ category resolver)

**Files:** Create `backend/app/services/growth.py`; Test `backend/tests/test_growth.py`.

- [ ] **Step 1: Add failing tests** to `backend/tests/test_growth.py` (add imports: `from app.services.growth import update_daily_stats, resolve_category`, and reuse a question helper — copy `_question_with_meta` from `tests/test_taste_profile.py` OR create a minimal `Question` inline; the version below builds a minimal approved question):

```python
from app.models import Question, QuestionAIMetadata


async def _question(session: AsyncSession, *, category: str = "Science & Nature") -> Question:
    q = Question(
        module_type="trivia", category=category, icon="🔬",
        payload={"prompt": "q?", "options": ["a", "b", "c", "d"], "correctIndex": 0},
        difficulty="hard", status="approved", explanation="x",
    )
    session.add(q)
    await session.flush()
    return q


async def test_update_daily_stats_accumulates_same_day(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    q = await _question(db_session)
    d = date(2026, 7, 4)
    for correct in (True, True, False):
        await update_daily_stats(
            db_session, user.id, stat_date=d, is_correct=correct, time_frac=0.5,
            streak_after=2 if correct else 0, difficulty="hard", category="Science & Nature",
        )
    row = (
        await db_session.execute(select(UserDailyStats).where(UserDailyStats.user_id == user.id))
    ).scalar_one()
    assert row.answers == 3
    assert row.correct == 2
    assert row.best_streak == 2
    assert row.hard_correct == 2  # two correct hard answers
    assert row.per_category["Science & Nature"] == {"a": 3, "c": 2}


async def test_resolve_category_from_question(db_session: AsyncSession) -> None:
    q = await _question(db_session, category="Geography")
    assert await resolve_category(db_session, q.id) == "Geography"
    assert await resolve_category(db_session, None) is None
```

- [ ] **Step 2: Run, expect FAIL** (module missing): `cd backend && uv run pytest tests/test_growth.py -k "update_daily_stats or resolve_category" -v`

- [ ] **Step 3: Create `backend/app/services/growth.py`:**

```python
"""Growth trajectory: incremental daily-stats upsert + the rolling read model.

Personalization/product-analytics only — never touches scores/coins/rating. JSONB is REASSIGNED,
never mutated in place. All writes are best-effort and flush-only (the caller owns the commit)."""

from __future__ import annotations

import logging
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Question, QuestionAIMetadata, UserDailyStats

logger = logging.getLogger(__name__)


async def resolve_category(session: AsyncSession, question_id: uuid.UUID | None) -> str | None:
    """The question's category — AI metadata first (canonical), else the bank row. None when the
    round has no bank question (generated modules)."""
    if question_id is None:
        return None
    meta_cat = await session.scalar(
        select(QuestionAIMetadata.category).where(QuestionAIMetadata.question_id == question_id)
    )
    if meta_cat:
        return meta_cat
    return await session.scalar(select(Question.category).where(Question.id == question_id))


async def update_daily_stats(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    stat_date: date,
    is_correct: bool,
    time_frac: float,
    streak_after: int | None,
    difficulty: str | None,
    category: str | None,
) -> None:
    """Upsert today's rollup with one answer. Does not commit (flush only)."""
    row = await session.get(UserDailyStats, (user_id, stat_date))
    if row is None:
        row = UserDailyStats(user_id=user_id, stat_date=stat_date)
        session.add(row)

    row.answers += 1
    if is_correct:
        row.correct += 1
        if difficulty == "hard":
            row.hard_correct += 1
    row.sum_time_frac += float(time_frac)
    row.best_streak = max(row.best_streak, streak_after or 0)

    if category:
        per = dict(row.per_category)  # REASSIGN, never mutate in place
        cur = dict(per.get(category, {"a": 0, "c": 0}))
        cur["a"] = cur.get("a", 0) + 1
        cur["c"] = cur.get("c", 0) + (1 if is_correct else 0)
        per[category] = cur
        row.per_category = per

    await session.flush()
```

- [ ] **Step 4: Run, expect PASS:** `cd backend && uv run pytest tests/test_growth.py -v`. Ruff clean.

- [ ] **Step 5: Do NOT commit.** Report.

---

### Task 5: Wire growth capture into A's seam

**Files:** Modify `backend/app/services/taste_profile.py` (`record_answer_signal`), and the 4 chokepoints `practice.py`/`contest.py`/`duel.py`/`friend_duel.py`; Test `backend/tests/test_growth.py`.

- [ ] **Step 1: Add failing test** to `backend/tests/test_growth.py` — an end-to-end capture assertion via the practice chokepoint (reuse the pattern from `tests/test_universal_evaluation.py`: seed trivia via `content.loader.load_trivia`, `start_practice`, fetch round answers, `answer_practice_round`). Add imports: `from app.services.practice import answer_practice_round, start_practice`, `from app.models import RoundAnswer`, `from content.loader import load_trivia`. Add a `_round_answers` + `_correct_result` helper (copy from `tests/test_universal_evaluation.py`):

```python
async def test_practice_answer_upserts_daily_stats(db_session: AsyncSession) -> None:
    await load_trivia(db_session)
    user = await _user(db_session)
    entry = await start_practice(db_session, user.id, category=None, mode=None)
    answers = (
        await db_session.execute(
            select(RoundAnswer).where(RoundAnswer.entry_id == entry.id).order_by(RoundAnswer.idx)
        )
    ).scalars().all()
    a0 = answers[0]
    result = (
        {"choice": a0.server_answer["correctIndex"], "elapsed_ms": 0}
        if a0.module_type != "memory_flash"
        else {"taps": a0.server_answer["sequence"], "tap_times": [0], "elapsed_ms": 0}
    )
    await answer_practice_round(db_session, entry.id, user.id, 0, result)

    rows = (
        await db_session.execute(select(UserDailyStats).where(UserDailyStats.user_id == user.id))
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].answers == 1
```

- [ ] **Step 2: Run, expect FAIL** (no daily-stats row yet): `cd backend && uv run pytest tests/test_growth.py::test_practice_answer_upserts_daily_stats -v`

- [ ] **Step 3: Extend `record_answer_signal`** in `backend/app/services/taste_profile.py`. Add `difficulty: str | None = None` to its keyword args. Inside the `try:` block, after `await update_profile_from_event(...)`, add the growth upsert (import `growth` lazily inside the function to avoid any import-order surprises, and gate on the new flag):

```python
        if settings.growth_tracking_enabled:
            from app.core.timezone import ET  # ZoneInfo("America/New_York"); see note below
            from app.services import growth

            category = await growth.resolve_category(session, question_id)
            stat_date = datetime.now(ET).date()
            await growth.update_daily_stats(
                session,
                user_id,
                stat_date=stat_date,
                is_correct=is_correct,
                time_frac=time_frac,
                streak_after=streak_after,
                difficulty=difficulty,
                category=category,
            )
```

Note on ET: check `app/core/timezone.py` for an exported `ZoneInfo` (the module already builds ET times). If it exports a name like `ET` or `NY`/`EASTERN`, import that; otherwise add `from zoneinfo import ZoneInfo` and use `ZoneInfo("America/New_York")`. `datetime` is already imported in taste_profile.py. Keep this inside the existing best-effort `try/except` so a growth failure never sinks the score.

- [ ] **Step 4: Pass `difficulty` from the 4 chokepoints.** In each, the existing `record_answer_signal(...)` call gains one argument:
  - `practice.py` (`answer_practice_round`) and `contest.py` (`answer_round`) and `duel.py` (`submit_duel_round`): add `difficulty=answer.server_answer.get("difficulty"),`
  - `friend_duel.py` (`submit_answer`): add `difficulty=answer_row["server_answer"].get("difficulty"),`

- [ ] **Step 5: Run, expect PASS** — the new test plus the whole A/capture suite (no regression):
`cd backend && uv run pytest tests/test_growth.py tests/test_universal_evaluation.py -v`
Ruff: `cd backend && uv run ruff check app/services/taste_profile.py app/services/growth.py app/services/practice.py app/services/contest.py app/services/duel.py app/services/friend_duel.py`

- [ ] **Step 6: Add the flag-off + best-effort tests** to `backend/tests/test_growth.py`:

```python
async def test_growth_capture_gated_off(db_session: AsyncSession, monkeypatch) -> None:
    from app.core.config import settings
    monkeypatch.setattr(settings, "growth_tracking_enabled", False)
    await load_trivia(db_session)
    user = await _user(db_session)
    entry = await start_practice(db_session, user.id, category=None, mode=None)
    answers = (
        await db_session.execute(
            select(RoundAnswer).where(RoundAnswer.entry_id == entry.id).order_by(RoundAnswer.idx)
        )
    ).scalars().all()
    a0 = answers[0]
    result = (
        {"choice": a0.server_answer["correctIndex"], "elapsed_ms": 0}
        if a0.module_type != "memory_flash"
        else {"taps": a0.server_answer["sequence"], "tap_times": [0], "elapsed_ms": 0}
    )
    await answer_practice_round(db_session, entry.id, user.id, 0, result)
    rows = (
        await db_session.execute(select(UserDailyStats).where(UserDailyStats.user_id == user.id))
    ).scalars().all()
    assert rows == []  # nothing captured when disabled
```

Run: `cd backend && uv run pytest tests/test_growth.py -v` → PASS.

- [ ] **Step 7: Do NOT commit.** Report.

---

### Task 6: `growth.get_growth` — the rolling read model

**Files:** Modify `backend/app/services/growth.py`; Test `backend/tests/test_growth.py`.

- [ ] **Step 1: Add failing tests** to `backend/tests/test_growth.py` (add `from app.services.growth import get_growth` and `from datetime import timedelta`):

```python
async def _seed_day(session, user_id, d, *, answers, correct, cat="Science & Nature"):
    await session.merge(
        UserDailyStats(
            user_id=user_id, stat_date=d, answers=answers, correct=correct,
            sum_time_frac=answers * 0.5, best_streak=correct, hard_correct=0,
            per_category={cat: {"a": answers, "c": correct}},
        )
    )
    await session.flush()


async def test_get_growth_rolls_and_shapes(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    today = date(2026, 7, 4)
    for i in range(10):
        await _seed_day(db_session, user.id, today - timedelta(days=i), answers=4, correct=i % 4)

    out = await get_growth(db_session, user.id, days=7, today=today)
    assert out["rot_score"]["current"] >= 300
    assert len(out["trend"]) == 7
    assert out["trend"][-1]["date"] == today.isoformat()
    assert any(c["category"] == "Science & Nature" for c in out["categories"])
    assert out["consistency"]["days_played"] >= 1


async def test_get_growth_cold_start(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    today = date(2026, 7, 4)
    await _seed_day(db_session, user.id, today, answers=2, correct=1)
    out = await get_growth(db_session, user.id, days=30, today=today)
    assert out["consistency"]["days_played"] == 1
    assert out["trend"][-1]["date"] == today.isoformat()  # does not error on sparse data
```

- [ ] **Step 2: Run, expect FAIL:** `cd backend && uv run pytest tests/test_growth.py -k get_growth -v`

- [ ] **Step 3: Implement `get_growth`** in `backend/app/services/growth.py` (add imports: `from datetime import date, timedelta`, `from app.services.rot_score import rot_score`, `from app.models import Profile`; keep existing imports):

```python
WINDOW = 7  # trailing days for the rolling Rot Score
MIN_DAYS, MAX_DAYS, DEFAULT_DAYS = 7, 90, 30
_DIRECTION_DEADBAND = 0.03


def _clamp_days(days: int) -> int:
    return max(MIN_DAYS, min(MAX_DAYS, days))


def _rolling_score(rows_by_date: dict, day: date) -> int | None:
    """Rot Score over the trailing WINDOW ending at `day`, or None if no answers in that window."""
    answers = correct = hard = 0
    stf = 0.0
    best = 0
    for i in range(WINDOW):
        r = rows_by_date.get(day - timedelta(days=i))
        if r is None:
            continue
        answers += r.answers
        correct += r.correct
        hard += r.hard_correct
        stf += r.sum_time_frac
        best = max(best, r.best_streak)
    if answers == 0:
        return None
    return rot_score(
        accuracy=correct / answers,
        avg_time_frac=stf / answers,
        best_streak=best,
        hard_correct=hard,
    )


async def get_growth(
    session: AsyncSession, user_id: uuid.UUID, days: int, today: date
) -> dict:
    days = _clamp_days(days)
    window_start = today - timedelta(days=days - 1)
    # Load rows from WINDOW-1 days before the window start (to roll the earliest plotted day).
    load_start = window_start - timedelta(days=WINDOW - 1)
    rows = (
        await session.execute(
            select(UserDailyStats).where(
                UserDailyStats.user_id == user_id,
                UserDailyStats.stat_date >= load_start,
                UserDailyStats.stat_date <= today,
            )
        )
    ).scalars().all()
    by_date = {r.stat_date: r for r in rows}

    # Trend: one rolling point per plotted day (carry forward the last known score across gaps).
    trend: list[dict] = []
    last: int | None = None
    for offset in range(days):
        d = window_start + timedelta(days=offset)
        score = _rolling_score(by_date, d)
        if score is None:
            score = last
        else:
            last = score
        if score is not None:
            trend.append({"date": d.isoformat(), "score": score})

    current = trend[-1]["score"] if trend else None
    prior = _rolling_score(by_date, today - timedelta(days=WINDOW))
    delta = (current - prior) if (current is not None and prior is not None) else 0

    # Per-category over the window: totals + per-day accuracy spark + direction.
    window_rows = [r for r in rows if r.stat_date >= window_start]
    cats: dict[str, dict] = {}
    for r in window_rows:
        for cat, v in r.per_category.items():
            c = cats.setdefault(cat, {"a": 0, "c": 0, "days": {}})
            c["a"] += v.get("a", 0)
            c["c"] += v.get("c", 0)
            c["days"][r.stat_date] = v

    categories = []
    mid = window_start + timedelta(days=days // 2)
    for cat, c in cats.items():
        acc = c["c"] / c["a"] if c["a"] else 0.0
        spark = [
            round((c["days"][window_start + timedelta(days=o)]["c"] /
                   c["days"][window_start + timedelta(days=o)]["a"]), 3)
            for o in range(days)
            if (window_start + timedelta(days=o)) in c["days"]
            and c["days"][window_start + timedelta(days=o)]["a"] > 0
        ]
        early = [v for dt, v in c["days"].items() if dt < mid]
        late = [v for dt, v in c["days"].items() if dt >= mid]
        ea = sum(v["c"] for v in early) / sum(v["a"] for v in early) if early and sum(v["a"] for v in early) else None
        la = sum(v["c"] for v in late) / sum(v["a"] for v in late) if late and sum(v["a"] for v in late) else None
        if ea is None or la is None:
            direction = "flat"
        elif la - ea > _DIRECTION_DEADBAND:
            direction = "up"
        elif ea - la > _DIRECTION_DEADBAND:
            direction = "down"
        else:
            direction = "flat"
        categories.append({"category": cat, "accuracy": round(acc, 3), "spark": spark, "direction": direction})
    categories.sort(key=lambda x: -x["accuracy"])

    profile = await session.get(Profile, user_id)
    days_played = sum(1 for r in window_rows if r.answers > 0)

    return {
        "rot_score": {"current": current or 300, "delta": delta},
        "trend": trend,
        "categories": categories,
        "consistency": {
            "days_played": days_played,
            "streak": profile.streak_count if profile else 0,
        },
    }
```

Note: confirm the profile model is exported as `Profile` in `app/models/__init__.py` and has `streak_count` (verified: `profiles.streak_count`). If the class name differs, adjust the import.

- [ ] **Step 4: Run, expect PASS:** `cd backend && uv run pytest tests/test_growth.py -v`. Ruff clean.

- [ ] **Step 5: Do NOT commit.** Report.

---

### Task 7: `GET /me/growth` endpoint + schema

**Files:** Create `backend/app/schemas/growth.py`; Modify `backend/app/api/me.py` (add the route); Test `backend/tests/test_growth.py`.

- [ ] **Step 1: Add a failing API test** to `backend/tests/test_growth.py` (uses the `client` fixture + a registered user; mirror auth from `tests/test_universal_evaluation.py`/`tests/test_practice.py` `_register`):

```python
from httpx import AsyncClient


async def _register(client: AsyncClient, email: str) -> str:
    r = await client.post(
        "/auth/register",
        json={"email": email, "username": email.split("@")[0][:16], "password": "super-secret-pw"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def test_me_growth_endpoint_shape(client: AsyncClient) -> None:
    token = await _register(client, f"{uuid.uuid4().hex[:10]}@example.com")
    r = await client.get("/me/growth?days=30", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"rot_score", "trend", "categories", "consistency"}
    assert set(body["rot_score"]) == {"current", "delta"}
    assert set(body["consistency"]) == {"days_played", "streak"}
```

- [ ] **Step 2: Run, expect FAIL** (404): `cd backend && uv run pytest tests/test_growth.py::test_me_growth_endpoint_shape -v`

- [ ] **Step 3: Create `backend/app/schemas/growth.py`:**

```python
"""Pydantic response schema for GET /me/growth."""

from __future__ import annotations

from pydantic import BaseModel


class RotScoreOut(BaseModel):
    current: int
    delta: int


class TrendPointOut(BaseModel):
    date: str
    score: int


class CategoryGrowthOut(BaseModel):
    category: str
    accuracy: float
    spark: list[float]
    direction: str  # up | down | flat


class ConsistencyOut(BaseModel):
    days_played: int
    streak: int


class GrowthOut(BaseModel):
    rot_score: RotScoreOut
    trend: list[TrendPointOut]
    categories: list[CategoryGrowthOut]
    consistency: ConsistencyOut
```

- [ ] **Step 4: Add the route** to `backend/app/api/me.py`. Follow the file's existing route conventions (it already has `get_current_user`, `get_session` deps and other `/me/*` routes). Add:

```python
from datetime import datetime

from app.schemas.growth import GrowthOut
from app.services.growth import get_growth
from app.services.rot_score import SCORE_MIN  # noqa: F401  (kept only if referenced)


@router.get("/growth", response_model=GrowthOut)
async def growth(
    days: int = 30,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GrowthOut:
    from zoneinfo import ZoneInfo  # or import the shared ET from app.core.timezone

    today = datetime.now(ZoneInfo("America/New_York")).date()
    data = await get_growth(session, user.id, days=days, today=today)
    return GrowthOut(**data)
```
Match the existing import style in `me.py` (it will already import `Depends`, `User`, `AsyncSession`, `get_current_user`, `get_session`, and the `router`). Remove the `SCORE_MIN` import if unused (it's illustrative). Use the same ET source you used in Task 5.

- [ ] **Step 5: Run, expect PASS:** `cd backend && uv run pytest tests/test_growth.py -v`. Ruff: `cd backend && uv run ruff check app/schemas/growth.py app/api/me.py`. Also run the full API smoke for /me: `cd backend && uv run pytest tests/test_me* -v` (if such files exist).

- [ ] **Step 6: Do NOT commit.** Report.

---

### Task 8: Frontend API client + `GrowthScreen`

**Files:** Modify `frontend/src/api/client.ts`; Create `frontend/src/screens/growth/GrowthScreen.tsx`; Test `frontend/src/screens/growth/GrowthScreen.test.tsx`.

- [ ] **Step 1: Add types + client method** to `frontend/src/api/client.ts`. Near the other response interfaces add:

```ts
export interface GrowthCategory {
  category: string;
  accuracy: number;
  spark: number[];
  direction: "up" | "down" | "flat";
}
export interface GrowthResponse {
  rot_score: { current: number; delta: number };
  trend: { date: string; score: number }[];
  categories: GrowthCategory[];
  consistency: { days_played: number; streak: number };
}
```
And in the `api` object (next to `today:` / `rotCheckToday:`) add:
```ts
  getGrowth: (days = 30) => authedRequest<GrowthResponse>(`/me/growth?days=${days}`),
```

- [ ] **Step 2: Write the failing screen test** — create `frontend/src/screens/growth/GrowthScreen.test.tsx`. Mock `@/api/client` and assert the trend + a category render, and the cold state. Mirror how other screen tests in `src/screens` mock `api` (check an existing `*.test.tsx` for the exact `vi.mock` shape):

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GrowthScreen } from "./GrowthScreen";

vi.mock("@/api/client", () => ({
  api: {
    getGrowth: vi.fn(async () => ({
      rot_score: { current: 742, delta: 38 },
      trend: [
        { date: "2026-06-28", score: 700 },
        { date: "2026-07-04", score: 742 },
      ],
      categories: [
        { category: "Science & Nature", accuracy: 0.86, spark: [0.7, 0.86], direction: "up" },
      ],
      consistency: { days_played: 12, streak: 12 },
    })),
  },
}));

describe("GrowthScreen", () => {
  it("renders the Rot Score and a category", async () => {
    render(<GrowthScreen onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("742")).toBeInTheDocument());
    expect(screen.getByText(/Science & Nature/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run, expect FAIL** (module missing): `cd frontend && npx vitest run src/screens/growth/GrowthScreen.test.tsx`

- [ ] **Step 4: Create `frontend/src/screens/growth/GrowthScreen.tsx`:**

```tsx
import { useEffect, useState } from "react";
import { api, type GrowthResponse } from "@/api/client";
import { GlassCard } from "@/ui/GlassCard";
import { Display } from "@/ui/Display";
import { useReducedMotion } from "@/ui/useReducedMotion";
import { useT } from "@/i18n/useT";

function TrendChart({ points }: { points: { date: string; score: number }[] }) {
  if (points.length < 2) return null;
  const scores = points.map((p) => p.score);
  const min = Math.min(...scores, 300);
  const max = Math.max(...scores, min + 1);
  const w = 300;
  const h = 90;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.score - min) / (max - min)) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden>
      <path d={path} fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

const ARROW = { up: "▲", down: "▼", flat: "–" } as const;

export function GrowthScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  useReducedMotion();
  const [data, setData] = useState<GrowthResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getGrowth(30)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  const cold = !!data && data.consistency.days_played < 7;

  return (
    <main style={{ maxWidth: 460, margin: "0 auto", padding: "24px 18px 96px", display: "flex", flexDirection: "column", gap: 14 }}>
      <button type="button" onClick={onBack} style={{ alignSelf: "flex-start", background: "none", border: "none", color: "var(--muted)", fontWeight: 600, cursor: "pointer", padding: 6 }}>
        {t.common.back}
      </button>
      <Display style={{ fontSize: 24 }}>{t.growth.title}</Display>

      {error && <GlassCard>{t.growth.error}</GlassCard>}
      {!data && !error && <GlassCard>{t.common.loading}</GlassCard>}

      {data && (
        <>
          <GlassCard style={{ textAlign: "center" }}>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{t.growth.rotScore}</div>
            <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{data.rot_score.current}</div>
            <div style={{ color: data.rot_score.delta >= 0 ? "var(--lime)" : "var(--pink)", fontWeight: 700, marginTop: 4 }}>
              {data.rot_score.delta >= 0 ? "▲" : "▼"} {Math.abs(data.rot_score.delta)} {t.growth.thisWeek}
            </div>
            <TrendChart points={data.trend} />
            {cold && <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>{t.growth.keepPlaying}</div>}
          </GlassCard>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {data.categories.map((c) => (
              <GlassCard key={c.category} style={{ padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{c.category}</div>
                <div style={{ color: c.direction === "up" ? "var(--lime)" : c.direction === "down" ? "var(--pink)" : "var(--muted)", fontSize: 13, fontWeight: 700 }}>
                  {Math.round(c.accuracy * 100)}% {ARROW[c.direction]}
                </div>
              </GlassCard>
            ))}
          </div>

          <GlassCard style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>{t.growth.consistency}</span>
            <b>{data.consistency.days_played} {t.growth.days} · {data.consistency.streak} {t.growth.streak}</b>
          </GlassCard>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Run, expect PASS:** `cd frontend && npx vitest run src/screens/growth/GrowthScreen.test.tsx`. Then `cd frontend && npm run typecheck`. If `useReducedMotion` has a different import path or `GlassCard`/`Display` differ, fix imports to match `src/ui/`. The i18n keys (`t.growth.*`) come from Task 9 — if typecheck fails on missing keys, do Task 9 first or add the keys now.

- [ ] **Step 6: Do NOT commit.** Report.

---

### Task 9: Home swap (Campaign pill → Your Growth), App wiring, i18n

**Files:** Modify `frontend/src/screens/Home.tsx`, `frontend/src/screens/home/HubTiles.tsx`, `frontend/src/app/App.tsx`, `frontend/src/i18n/{en,es,tr}.ts`; Update `frontend/src/screens/Home.flow.test.tsx` / `App.nav.test.tsx` as needed.

- [ ] **Step 1: i18n — add a `growth` group.** In `frontend/src/i18n/en.ts` add (near `rotCheck`/`nav`):
```ts
  growth: {
    title: "Your Growth",
    rotScore: "Rot Score",
    thisWeek: "this week",
    keepPlaying: "Keep playing to build your trend.",
    consistency: "Consistency",
    days: "days",
    streak: "streak",
    error: "Could not load your growth",
  },
```
Mirror the SAME keys in `frontend/src/i18n/es.ts` and `frontend/src/i18n/tr.ts` with translations (es: "Tu progreso", "Puntuación Rot", "esta semana", "Sigue jugando para construir tu tendencia.", "Constancia", "días", "racha", "No se pudo cargar tu progreso"; tr: "Gelişimin", "Rot Puanı", "bu hafta", "Trendini oluşturmak için oynamaya devam et.", "İstikrar", "gün", "seri", "Gelişimin yüklenemedi"). Keep copy §7-safe (no cash/bet/casino).

- [ ] **Step 2: Home — replace the Campaign row with Growth.** In `frontend/src/screens/Home.tsx`:
  - Add a prop `onGrowth: () => void;` to the component's props type (next to `onCampaign`), and destructure it.
  - Add an import for an icon (reuse an existing one from the icon set — e.g. a chart/trending icon; if none exists use `SparkIcon` already imported, or `BoltIcon`). 
  - In BOTH `monoRows` arrays, replace the `campaign` row object with:
    ```tsx
    { key: "growth", label: t.growth.title, icon: <SparkIcon size={19} />, onClick: onGrowth },
    ```
  (Keeps it "directly under Friends".) Do NOT remove the `onCampaign` prop — it may still be used by the arcade tiles until Step 3; if after Step 3 `onCampaign` is unused, remove it and its prop.

- [ ] **Step 3: Arcade tiles — swap Campaign → Growth.** In `frontend/src/screens/home/HubTiles.tsx`, replace the Campaign tile with a "Your Growth" tile that calls a new `onGrowth` prop (mirror the existing Campaign tile markup/art; relabel to `t.growth.title`). Thread `onGrowth` from `Home.tsx`'s `<HubTiles onGrowth={onGrowth} ... />`. If Campaign is fully removed from `HubTiles`, drop its now-unused `onCampaign` prop there.

- [ ] **Step 4: App wiring — add the growth flow (mirror Vault).** In `frontend/src/app/App.tsx`:
  - Add state: `const [growthOpen, setGrowthOpen] = useState(false);`
  - In `closeAllOverlays()` add `setGrowthOpen(false);`
  - Add `const goGrowth = () => { closeAllOverlays(); setGrowthOpen(true); };`
  - Add a render branch mirroring `vaultOpen` (a `GrowthScreen` + `AppNav`):
    ```tsx
    if (growthOpen) {
      return (
        <>
          <GrowthScreen onBack={goHome} />
          <AppNav active="home" onHome={goHome} onCampaign={goCampaign} onLeaderboard={goLeaderboard} onVault={goVault} onPlayWindow={goPlay} onQuickPlay={goQuickPlay} />
        </>
      );
    }
    ```
    (Match `AppNav`'s actual required props from the vault branch.)
  - Pass `onGrowth={goGrowth}` to `<Home ... />` (next to `onCampaign`).
  - Import `GrowthScreen`: `import { GrowthScreen } from "@/screens/growth/GrowthScreen";`

- [ ] **Step 5: typecheck + lint + tests.**
`cd frontend && npm run typecheck`
`cd frontend && npm run lint`
`cd frontend && npx vitest run src/screens/Home.flow.test.tsx src/app/App.nav.test.tsx src/screens/growth`
Fix the Home/App tests: any assertion expecting a "Campaign" pill on Home must change to expect "Your Growth" in that slot (Campaign is still reachable via the nav menu, so nav tests for Campaign stay). If a Home test renders `<Home>` and must now pass `onGrowth`, add the prop (a `vi.fn()`).

- [ ] **Step 6: Full frontend suite:**
`cd frontend && npx vitest run` → all green. `npm run typecheck` → clean. `npm run build` → succeeds.

- [ ] **Step 7: Do NOT commit.** Report.

---

### Task 10: Docs + full-suite guard

**Files:** Modify `docs/personalization.md` (or create `docs/growth.md`); run full backend + frontend suites.

- [ ] **Step 1: Document it.** Create `docs/growth.md` describing: the `user_daily_stats` table, the incremental capture via `record_answer_signal` (gated on `growth_tracking_enabled`), the shared `rot_score.py`, the rolling-7-day trend, the `GET /me/growth` shape, and the Home pill swap (Campaign → Your Growth; Campaign stays in the nav menu). Note this is sub-project B of the "self-growth via AI" epic and that C (AI narrative) + D (Rot Check reframe) build on it.

- [ ] **Step 2: Full backend suite:** `cd backend && PYTHONIOENCODING=utf-8 uv run pytest -q` → all pass. `cd backend && uv run ruff check app tests` → clean.

- [ ] **Step 3: Full frontend suite:** `cd frontend && npx vitest run && npm run typecheck && npm run lint && npm run build` → all green.

- [ ] **Step 4: Do NOT commit.** Report the final tallies.

---

## Self-review

**Spec coverage:**
- Metric = Rot Score + per-category → Tasks 1 (shared score), 6 (rolling trend + categories). ✓
- Incremental daily snapshot in A's seam → Tasks 2 (table), 4 (upsert), 5 (wired into `record_answer_signal`). ✓
- ET day-boundary → Task 5 (ET date via timezone helper). ✓
- Rolling-7-day smoothed trend → Task 6 (`_rolling_score`, WINDOW=7). ✓
- `GET /me/growth?days=30` + documented shape → Task 7. ✓
- `growth_tracking_enabled` (default true, independent flag) → Task 3, gated in Task 5, tested. ✓
- "Your Growth" dashboard (layout B: chart-first + category grid + consistency, cold state) → Task 8. ✓
- Home swaps Campaign pill → Growth under Friends; Campaign stays in `AppNav` → Task 9. ✓
- Guests included → keyed by `user_id`; covered implicitly (no auth gating in capture) — Task 5's practice test uses a bare user; guest parity holds. ✓
- Shared score parity guard → Task 1 (existing rot-check tests stay green). ✓
- Best-effort/flush-only capture → Task 4 (flush only) + Task 5 (inside `record_answer_signal`'s try/except). ✓
- Migration (B needs schema) → Task 2. ✓
- i18n en/es/tr mirror, copy-safe → Task 9. ✓

**Placeholder scan:** The plan defers exact positions in a few "match the existing pattern" spots (me.py route conventions, HubTiles tile markup, AppNav prop set, screen-test `vi.mock` shape). Each names the precise file and the concrete pattern to mirror, with complete code for the new logic. No `TBD`/`add error handling`/`similar to Task N` placeholders.

**Type consistency:** `rot_score(*, accuracy, avg_time_frac, best_streak, hard_correct)` used identically in Tasks 1 and 6. `update_daily_stats(session, user_id, *, stat_date, is_correct, time_frac, streak_after, difficulty, category)` defined in Task 4, called in Task 5 with the same kwargs. `get_growth(session, user_id, days, today)` defined in Task 6, called in Task 7. `GrowthResponse` (client) mirrors `GrowthOut` (schema) field-for-field (`rot_score{current,delta}`, `trend[{date,score}]`, `categories[{category,accuracy,spark,direction}]`, `consistency{days_played,streak}`). `getGrowth(days)` (Task 8) matches the endpoint (Task 7). ✓
