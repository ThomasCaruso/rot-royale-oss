# Universal Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every answer the player gives — in every mode (Daily Royale, Campaign, Practice, bot duels, friend duels, Rot Check) — feed one unified, server-authoritative brain model on correctness **and** speed.

**Architecture:** A single helper `record_answer_signal(...)` fires at each mode's per-round scoring chokepoint, right after the server computes its authoritative `judgement`. It builds a `QuestionInteractionEvent` from server-owned data (correct / real speed from `time_frac` / streak) and folds it into the existing `UserTasteProfile` via `update_profile_from_event`. The frontend interaction tracker is demoted to an engagement-only channel (explanation-read / share) so it can't double-count. No schema migration — existing columns are reused.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, pytest (async, rolled-back-transaction fixtures), React/TS (Vitest) frontend.

---

## Design decisions locked in brainstorming (spec: `docs/superpowers/specs/2026-07-04-universal-evaluation-design.md`)

- **Server-authoritative capture** (not client-emitted). The server already has `judgement` + question at each per-round scoring point.
- **Four chokepoints cover everything:** `answer_practice_round` (practice + campaign + quick + category + rot_check, all ride the practice `/answer` loop), `answer_round` (Daily Royale), `submit_duel_round` (bot duel), `submit_answer` (friend duel). The batch `submit_practice` / `submit_entry` / `score_entry` paths are settlement/legacy — **not hooked** (would double-count).
- **Ranked records but does not personalize** — `PERSONALIZE_RANKED_DAILY` is untouched.
- **Guests build profiles** — the profile is keyed by `user_id`, which guests already have.
- **One counted event per answer** — the server path bumps `interaction_count`; the client engagement path is made count-neutral.
- **Accepted simplification (reversible, restored in sub-project B):** the compound "wrong + explanation-engaged → weak_but_interesting" marking is not populated in A. The server event knows `is_correct` but the explanation has not been read yet at scoring time; the client engagement event no longer carries `is_correct`. The explanation-read still nudges topic affinity via `SIG_EXPLANATION_READ`. Correlating the two events is B's job.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `backend/app/services/taste_profile.py` | Profile signal engine | Add `count_interaction` param to `update_profile_from_event`; add `question_id_from_server_answer(...)` + `record_answer_signal(...)`; flip `record_interaction` to count-neutral |
| `backend/app/services/practice.py` | Practice/campaign per-round scoring | Call `record_answer_signal` in `answer_practice_round` |
| `backend/app/services/contest.py` | Daily Royale per-round scoring | Call `record_answer_signal` in `answer_round` |
| `backend/app/services/duel.py` | Bot duel per-round scoring | Call `record_answer_signal` in `submit_duel_round` |
| `backend/app/services/friend_duel.py` | Friend duel per-round scoring | Call `record_answer_signal` in `submit_answer` |
| `backend/tests/test_taste_profile.py` | Profile engine unit tests | Add `count_interaction` + `record_answer_signal` unit tests |
| `backend/tests/test_universal_evaluation.py` | **New** — cross-mode capture integration tests | Create |
| `backend/tests/test_personalization_api.py` | `/events` endpoint tests | Update count assertion for the count-neutral endpoint |
| `frontend/src/screens/Practice.tsx` | Practice play screen | Narrow the staged interaction payload to engagement-only |
| `frontend/src/lib/interactionTracker.test.ts` | Tracker unit test | Adjust to the narrowed payload if it asserts fields |

---

### Task 1: `count_interaction` flag on `update_profile_from_event`

Lets a caller apply a profile update without counting it as a new answer (used by the engagement-only client channel so `interaction_count` stays = answers).

**Files:**
- Modify: `backend/app/services/taste_profile.py:150` (signature) and `:246-247` (count bump)
- Test: `backend/tests/test_taste_profile.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_taste_profile.py`:

```python
async def test_update_profile_can_skip_interaction_count(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    q = await _question_with_meta(db_session)
    event = _event(user.id, q.id, is_correct=True, response_ms=1500)
    db_session.add(event)
    await db_session.flush()

    await update_profile_from_event(db_session, user.id, event, count_interaction=False)

    profile = await get_or_create_profile(db_session, user.id)
    assert profile.interaction_count == 0            # not counted...
    assert profile.category_affinity.get("Sports", 0) > 0  # ...but affinity still moved
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_taste_profile.py::test_update_profile_can_skip_interaction_count -v`
Expected: FAIL — `update_profile_from_event() got an unexpected keyword argument 'count_interaction'`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/taste_profile.py`, change the signature (line ~150):

```python
async def update_profile_from_event(
    session: AsyncSession,
    user_id: uuid.UUID,
    event: QuestionInteractionEvent,
    count_interaction: bool = True,
) -> UserTasteProfile:
```

And guard the count bump (currently lines ~246-247):

```python
    if count_interaction:
        profile.interaction_count += 1
        profile.confidence_score = round(
            min(1.0, profile.interaction_count / CONFIDENCE_FULL_AT), 4
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_taste_profile.py -v`
Expected: PASS (the new test plus all existing ones — default `True` preserves current behavior).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/taste_profile.py backend/tests/test_taste_profile.py
git commit -m "feat(personalization): count_interaction flag on profile update"
```

---

### Task 2: `record_answer_signal` — the server-authoritative capture helper

**Files:**
- Modify: `backend/app/services/taste_profile.py` (add helper + question-id extractor near the top-level functions)
- Test: `backend/tests/test_taste_profile.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_taste_profile.py` (add `from app.core.config import settings` and `from app.services.taste_profile import record_answer_signal, question_id_from_server_answer` to the imports, plus `from sqlalchemy import select` and `from app.models import QuestionInteractionEvent` if not already imported):

```python
async def test_record_answer_signal_writes_event_and_counts(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    q = await _question_with_meta(db_session)

    await record_answer_signal(
        db_session,
        user.id,
        question_id=q.id,
        mode="royale",
        is_correct=True,
        time_frac=0.85,
        limit_ms=10000,
        streak_before=0,
        streak_after=1,
        session_id=None,
    )

    profile = await get_or_create_profile(db_session, user.id)
    assert profile.interaction_count == 1
    rows = (
        await db_session.execute(
            select(QuestionInteractionEvent).where(QuestionInteractionEvent.user_id == user.id)
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].is_correct is True
    assert rows[0].mode == "royale"
    assert rows[0].response_ms == 1500  # round(10000 * (1 - 0.85))


async def test_record_answer_signal_noop_when_disabled(
    db_session: AsyncSession, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "personalization_enabled", False)
    user = await _user(db_session)
    q = await _question_with_meta(db_session)

    await record_answer_signal(
        db_session, user.id, question_id=q.id, mode="royale", is_correct=True,
        time_frac=0.5, limit_ms=10000, streak_before=0, streak_after=1,
    )

    rows = (
        await db_session.execute(
            select(QuestionInteractionEvent).where(QuestionInteractionEvent.user_id == user.id)
        )
    ).scalars().all()
    assert rows == []


def test_question_id_from_server_answer() -> None:
    qid = uuid.uuid4()
    assert question_id_from_server_answer({"correctIndex": 0, "question_id": str(qid)}) == qid
    assert question_id_from_server_answer({"correctIndex": 0}) is None
    assert question_id_from_server_answer({"question_id": "not-a-uuid"}) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_taste_profile.py -k "record_answer_signal or question_id_from" -v`
Expected: FAIL — `cannot import name 'record_answer_signal'`.

- [ ] **Step 3: Write the implementation**

In `backend/app/services/taste_profile.py`, add near the other module-level functions (e.g. just above `record_interaction`):

```python
def question_id_from_server_answer(server_answer: dict[str, Any]) -> uuid.UUID | None:
    """Pull the bank question id out of a stored server_answer (trivia carries it; generated
    modules like rapid_math/memory_flash do not). Returns None on absence or a malformed value."""
    raw = server_answer.get("question_id") if server_answer else None
    if not raw:
        return None
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError, TypeError):
        return None


async def record_answer_signal(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    question_id: uuid.UUID | None,
    mode: str,
    is_correct: bool,
    time_frac: float,
    limit_ms: int,
    streak_before: int | None = None,
    streak_after: int | None = None,
    session_id: uuid.UUID | None = None,
) -> None:
    """Server-authoritative capture of one scored answer, fired from a mode's per-round scoring
    chokepoint. Speed is derived from the SERVER's time_frac (never client-reported). Best-effort:
    a failure here must never sink the surrounding score write. Does not commit (flush only).

    Gated on settings.personalization_enabled — with it off, nothing is recorded.
    """
    if not settings.personalization_enabled:
        return
    try:
        response_ms = max(0, round(limit_ms * (1.0 - time_frac)))
        event = QuestionInteractionEvent(
            user_id=user_id,
            question_id=question_id,
            mode=mode[:16],
            session_id=session_id,
            is_correct=is_correct,
            response_ms=response_ms,
            timed_out=False,
            streak_before=streak_before,
            streak_after=streak_after,
        )
        session.add(event)
        await session.flush()
        await update_profile_from_event(session, user_id, event, count_interaction=True)
    except Exception:  # noqa: BLE001 — capture must never fail a score write
        logger.exception("answer-signal capture failed for user %s (mode=%s)", user_id, mode)
```

Add `from typing import Any` to the imports if not already present (it isn't in this file — add it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_taste_profile.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/taste_profile.py backend/tests/test_taste_profile.py
git commit -m "feat(personalization): server-authoritative record_answer_signal helper"
```

---

### Task 3: Hook the practice chokepoint (covers practice · campaign · quick · category · rot_check)

**Files:**
- Modify: `backend/app/services/practice.py` — inside `answer_practice_round`, after the `RoundResult` is added (after line ~319, before `await session.flush()` at ~300... note: the `RoundResult` add block is lines ~308-319 in the current file; insert the call immediately after it)
- Test: `backend/tests/test_universal_evaluation.py` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_universal_evaluation.py`:

```python
"""Universal evaluation: every mode's per-round scoring feeds the taste profile (sub-project A)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Entry, QuestionInteractionEvent, RoundAnswer, User
from app.services.practice import answer_practice_round, start_practice
from app.services.taste_profile import get_or_create_profile

pytestmark = pytest.mark.asyncio


async def _user(session: AsyncSession) -> User:
    user = User(email=f"{uuid.uuid4().hex[:12]}@example.com", password_hash="x")
    session.add(user)
    await session.flush()
    return user


async def _round_answers(session: AsyncSession, entry_id) -> list[RoundAnswer]:
    return list(
        (
            await session.execute(
                select(RoundAnswer)
                .where(RoundAnswer.entry_id == entry_id)
                .order_by(RoundAnswer.idx)
            )
        )
        .scalars()
        .all()
    )


def _correct_result(module_type: str, server_answer: dict) -> dict:
    if module_type == "memory_flash":
        seq = server_answer["sequence"]
        return {"taps": seq, "tap_times": [100 * i for i in range(len(seq))], "elapsed_ms": 0}
    return {"choice": server_answer["correctIndex"], "elapsed_ms": 0}


async def _events(session: AsyncSession, user_id) -> list[QuestionInteractionEvent]:
    return list(
        (
            await session.execute(
                select(QuestionInteractionEvent).where(
                    QuestionInteractionEvent.user_id == user_id
                )
            )
        )
        .scalars()
        .all()
    )


async def test_practice_answer_feeds_brain_model(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    entry = await start_practice(db_session, user.id, category=None, mode=None)
    answers = await _round_answers(db_session, entry.id)

    await answer_practice_round(
        db_session, entry.id, user.id, 0,
        _correct_result(answers[0].module_type, answers[0].server_answer),
    )

    events = await _events(db_session, user.id)
    assert len(events) == 1
    assert events[0].is_correct is True
    assert events[0].mode == "practice"
    profile = await get_or_create_profile(db_session, user.id)
    assert profile.interaction_count == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_universal_evaluation.py::test_practice_answer_feeds_brain_model -v`
Expected: FAIL — `assert len(events) == 1` gets 0 (no capture wired yet).

- [ ] **Step 3: Write the implementation**

In `backend/app/services/practice.py`, add the import near the top:

```python
from app.services.taste_profile import question_id_from_server_answer, record_answer_signal
```

Inside `answer_practice_round`, immediately after the `session.add(RoundResult(...))` block (the block ending at line ~319) and before `total_score = ...`, insert:

```python
    await record_answer_signal(
        session,
        user_id,
        question_id=question_id_from_server_answer(answer.server_answer),
        mode="practice",
        is_correct=bool(counts),
        time_frac=judgement.time_frac,
        limit_ms=get_module(answer.module_type).time_limit_ms,
        streak_before=streak_prev,
        streak_after=streak_prev + 1 if counts else 0,
        session_id=entry_id,
    )
```

(`get_module` and `counts`/`judgement`/`streak_prev`/`answer` are already in scope in this function.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_universal_evaluation.py tests/test_practice.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/practice.py backend/tests/test_universal_evaluation.py
git commit -m "feat(personalization): capture practice/campaign answers into the brain model"
```

---

### Task 4: Hook the Daily Royale chokepoint (`answer_round`)

**Files:**
- Modify: `backend/app/services/contest.py` — inside `answer_round`, after the `RoundResult` add block (after line ~293), before `total_score = ...`
- Test: `backend/tests/test_universal_evaluation.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_universal_evaluation.py` (add imports at top: `from app.models.contest import OPEN` and `from app.services.contest import answer_round, enter_contest`; plus a local `_open_window` helper copied from the pattern in `tests/test_contest_api.py:22` — reproduced here so the file is self-contained):

```python
from datetime import UTC, datetime, timedelta

from app.models.contest import OPEN, Window
from app.services.contest import answer_round, enter_contest


async def _open_window(session: AsyncSession) -> Window:
    now = datetime.now(UTC)
    window = Window(
        contest_date=now.date(),
        slot="royale",
        template_id="m2_trivia_7",
        state=OPEN,
        open_at=now - timedelta(hours=1),
        close_at=now + timedelta(hours=1),
        settle_at=now + timedelta(hours=1, minutes=15),
    )
    session.add(window)
    await session.flush()
    return window


async def test_daily_royale_answer_feeds_brain_model(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    window = await _open_window(db_session)
    entry = await enter_contest(db_session, window.id, user.id)
    answers = await _round_answers(db_session, entry.id)

    await answer_round(
        db_session, entry.id, user.id, 0,
        _correct_result(answers[0].module_type, answers[0].server_answer),
    )

    events = await _events(db_session, user.id)
    assert len(events) == 1
    assert events[0].mode == "royale"
    assert events[0].is_correct is True
```

> Note: confirm the `Window` constructor kwargs against `app/models/contest.py` and the exact
> `enter_contest` signature (`tests/test_contest_api.py` enters via `POST /contests/{id}/enter`; if
> the service signature differs, drive this test through the API client instead, mirroring
> `tests/test_contest_api.py:99` `test_submit_scores_server_side...`, then assert the events).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_universal_evaluation.py::test_daily_royale_answer_feeds_brain_model -v`
Expected: FAIL — 0 events captured.

- [ ] **Step 3: Write the implementation**

In `backend/app/services/contest.py`, add the import:

```python
from app.services.taste_profile import question_id_from_server_answer, record_answer_signal
```

Inside `answer_round`, immediately after the `session.add(RoundResult(...))` block (ending ~line 293), insert the same call as Task 3 but with `mode="royale"`:

```python
    await record_answer_signal(
        session,
        user_id,
        question_id=question_id_from_server_answer(answer.server_answer),
        mode="royale",
        is_correct=bool(counts),
        time_frac=judgement.time_frac,
        limit_ms=get_module(answer.module_type).time_limit_ms,
        streak_before=streak_prev,
        streak_after=streak_prev + 1 if counts else 0,
        session_id=entry_id,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_universal_evaluation.py tests/test_contest_api.py tests/test_personalization_ranking.py -v`
Expected: PASS. (`test_personalization_ranking.py` confirms ranked selection stays un-personalized — recording does not change it.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/contest.py backend/tests/test_universal_evaluation.py
git commit -m "feat(personalization): capture Daily Royale answers into the brain model"
```

---

### Task 5: Hook the bot-duel chokepoint (`submit_duel_round`)

**Files:**
- Modify: `backend/app/services/duel.py` — inside `submit_duel_round`, after the human `RoundResult` add block (after line ~552)
- Test: `backend/tests/test_universal_evaluation.py`

- [ ] **Step 1: Write the failing test**

Reuse the duel test setup pattern from `tests/test_duel_play.py` (`_user`, `_script_rival`, `_correct_index`, `submit_duel_round`). Append a focused capture test to `tests/test_duel_play.py` (it already has the fixtures — keeps setup DRY) rather than re-deriving duel scaffolding in the new file:

```python
async def test_duel_round_feeds_brain_model(db_session: AsyncSession) -> None:
    from sqlalchemy import select
    from app.models import QuestionInteractionEvent

    uid = await _user(db_session, gems=100)
    match = await _start_match(db_session, uid)          # the helper this file already uses to open a match
    idx0 = await _correct_index(db_session, match, 0)

    await submit_duel_round(db_session, uid, match.id, 0, {"choice": idx0, "elapsed_ms": 1000})

    events = (
        await db_session.execute(
            select(QuestionInteractionEvent).where(QuestionInteractionEvent.user_id == uid)
        )
    ).scalars().all()
    assert len(events) == 1
    assert events[0].mode == "duel"
    assert events[0].is_correct is True
```

> Confirm the match-opening helper name in `tests/test_duel_play.py` (it defines `_submit` at line 59
> which wraps `submit_duel_round`, and `_script_rival`/`_correct_index`; use whatever helper that
> file already uses to create an `in_progress` match — reuse it, do not re-implement).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_duel_play.py::test_duel_round_feeds_brain_model -v`
Expected: FAIL — 0 events.

- [ ] **Step 3: Write the implementation**

In `backend/app/services/duel.py`, add the import:

```python
from app.services.taste_profile import question_id_from_server_answer, record_answer_signal
```

Inside `submit_duel_round`, immediately after the human `session.add(RoundResult(...))` block (ending ~line 552), insert:

```python
    await record_answer_signal(
        session,
        user_id,
        question_id=question_id_from_server_answer(answer.server_answer),
        mode="duel",
        is_correct=bool(counts),
        time_frac=judgement.time_frac,
        limit_ms=get_module(answer.module_type).time_limit_ms,
        streak_before=streak_prev,
        streak_after=streak_prev + 1 if counts else 0,
        session_id=match.entry_id,
    )
```

(`answer`, `counts`, `judgement`, `streak_prev`, `match`, `get_module` are all in scope here.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_duel_play.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/duel.py backend/tests/test_duel_play.py
git commit -m "feat(personalization): capture bot-duel answers into the brain model"
```

---

### Task 6: Hook the friend-duel chokepoint (`submit_answer`)

**Files:**
- Modify: `backend/app/services/friend_duel.py` — inside `submit_answer`, inside the `if existing is None:` block after the `FriendDuelSubmission` is added (after line ~399, still inside that block)
- Test: `backend/tests/test_friend_duel.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_friend_duel.py`, reusing that file's existing setup helpers (it already creates two accepted friends + an active duel and calls `submit_answer`). Assert that each player's submitted answer produces one event for that player:

```python
async def test_friend_duel_answer_feeds_both_brain_models(db_session: AsyncSession) -> None:
    from sqlalchemy import select
    from app.models import QuestionInteractionEvent

    # Reuse this file's helper that returns an active duel + both user ids + a correct-choice getter.
    duel, chal_id, opp_id, correct_choice = await _active_duel_with_players(db_session)

    await submit_answer(db_session, chal_id, duel.id, 0, {"choice": correct_choice(0), "elapsed_ms": 1200})
    await submit_answer(db_session, opp_id, duel.id, 0, {"choice": correct_choice(0), "elapsed_ms": 1500})

    for uid in (chal_id, opp_id):
        events = (
            await db_session.execute(
                select(QuestionInteractionEvent).where(QuestionInteractionEvent.user_id == uid)
            )
        ).scalars().all()
        assert len(events) == 1
        assert events[0].mode == "friend_duel"
```

> Match the helper names to what `tests/test_friend_duel.py` already defines. If it builds the duel
> inline rather than via a helper, follow that same inline pattern here (create two users, friend +
> accept, challenge + accept to reach `status="active"`), then call `submit_answer` for each player.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_friend_duel.py::test_friend_duel_answer_feeds_both_brain_models -v`
Expected: FAIL — 0 events.

- [ ] **Step 3: Write the implementation**

In `backend/app/services/friend_duel.py`, add the import:

```python
from app.services.taste_profile import question_id_from_server_answer, record_answer_signal
```

Inside `submit_answer`, inside the `if existing is None:` block, immediately after `await session.flush()` (line ~400, right after the `FriendDuelSubmission` add), insert:

```python
        await record_answer_signal(
            session,
            user_id,
            question_id=question_id_from_server_answer(answer_row["server_answer"]),
            mode="friend_duel",
            is_correct=bool(correct),
            time_frac=judgement.time_frac,
            limit_ms=get_module(answer_row["module_type"]).time_limit_ms,
            streak_before=None,
            streak_after=None,
            session_id=duel_id,
        )
```

(`judgement`, `correct`, `answer_row`, `user_id`, `duel_id`, `get_module` are all in scope in that block. Friend duels track head-to-head, not a running streak, so streak fields are `None` — the column is nullable and the signal math does not use streak.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_friend_duel.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/friend_duel.py backend/tests/test_friend_duel.py
git commit -m "feat(personalization): capture friend-duel answers into the brain model"
```

---

### Task 7: Make the client `/events` path count-neutral

The server now owns the counted correctness/speed event. The client `/events` endpoint becomes an engagement-only supplement, so it must not increment `interaction_count` (else engaged answers count twice).

**Files:**
- Modify: `backend/app/services/taste_profile.py:304-308` (`record_interaction` → pass `count_interaction=False`)
- Test: `backend/tests/test_personalization_api.py`

- [ ] **Step 1: Update the failing test**

In `backend/tests/test_personalization_api.py`, the existing `test_event_with_question_id_updates_profile` asserts `profile.interaction_count == 1` (line ~67). Change that assertion to reflect the count-neutral endpoint, and assert the affinity still moved (the endpoint still folds the signal):

```python
    assert profile.interaction_count == 0          # /events is an engagement supplement, not a count
    assert profile.category_affinity != {}          # ...but the signal still shaped the profile
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_personalization_api.py::test_event_with_question_id_updates_profile -v`
Expected: FAIL — count is still 1 (endpoint not yet changed).

- [ ] **Step 3: Write the implementation**

In `backend/app/services/taste_profile.py`, in `record_interaction` (line ~306), change the profile-update call:

```python
    if settings.personalization_enabled:
        try:
            await update_profile_from_event(session, user_id, event, count_interaction=False)
        except Exception:  # noqa: BLE001 — profile update must never sink the event write
            logger.exception("taste profile update failed for user %s", user_id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_personalization_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/taste_profile.py backend/tests/test_personalization_api.py
git commit -m "feat(personalization): /events becomes a count-neutral engagement supplement"
```

---

### Task 8: Narrow the frontend tracker to engagement-only

The client must stop sending `is_correct` / `response_ms` / `timed_out` / `selected_answer` / `streak_*` (the server owns those now), so its supplemental event contributes only engagement deltas and can never double-apply the correctness/speed signal. It keeps `mode`, `entry_id`, `idx`, `explanation_opened`, `explanation_read_ms`, `shared_after`, `replayed_after`, `quit_after`.

**Files:**
- Modify: `frontend/src/screens/Practice.tsx:189-199` (the `pendingEventRef.current = { ... }` payload)
- Test: `frontend/src/lib/interactionTracker.test.ts` (adjust only if it asserts the removed fields)

- [ ] **Step 1: Narrow the staged payload**

In `frontend/src/screens/Practice.tsx`, change the `pendingEventRef.current = {...}` object (lines ~189-199) to engagement-only:

```tsx
          pendingEventRef.current = {
            mode: category ? "category" : mode === "quick" ? "quick" : "practice",
            entry_id: session.entry_id,
            idx,
            explanation_opened: Boolean(rev.explanation),
            // is_correct / response_ms / timed_out / selected_answer / streak_* are now captured
            // server-side at scoring time (see backend record_answer_signal); the client only
            // supplies the engagement signals the server can't see.
          };
```

Leave `flushInteraction` unchanged — it still layers `quit_after` and `explanation_read_ms` on top.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: PASS. If `QuestionInteractionPayload` requires any of the removed fields, they are already optional (see `src/api/client.ts:120`); no type error expected.

- [ ] **Step 3: Update/verify the tracker test**

Run: `cd frontend && npx vitest run src/lib/interactionTracker.test.ts src/screens`
If a test asserts the removed fields on the staged payload, update it to assert the engagement-only shape (`mode`, `entry_id`, `idx`, `explanation_opened`, and post-flush `quit_after`/`explanation_read_ms`). Otherwise no change.
Expected: PASS.

- [ ] **Step 4: Lint**

Run: `cd frontend && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/Practice.tsx frontend/src/lib/interactionTracker.test.ts
git commit -m "feat(personalization): client tracker becomes engagement-only (server owns correctness/speed)"
```

---

### Task 9: Cross-cutting guarantees — guest capture, no double-count, docs

**Files:**
- Test: `backend/tests/test_universal_evaluation.py`
- Modify: `docs/personalization.md`

- [ ] **Step 1: Write the guarantee tests**

Append to `backend/tests/test_universal_evaluation.py`:

```python
async def test_guest_play_builds_brain_model(db_session: AsyncSession) -> None:
    from app.models.user import GUEST_STATUS

    guest = User(
        email=f"{uuid.uuid4().hex[:12]}@guest.invalid",
        password_hash="x",
        status=GUEST_STATUS,
    )
    db_session.add(guest)
    await db_session.flush()

    entry = await start_practice(db_session, guest.id, category=None, mode=None)
    answers = await _round_answers(db_session, entry.id)
    await answer_practice_round(
        db_session, entry.id, guest.id, 0,
        _correct_result(answers[0].module_type, answers[0].server_answer),
    )

    profile = await get_or_create_profile(db_session, guest.id)
    assert profile.interaction_count == 1


async def test_practice_answer_counts_once_even_with_client_supplement(
    db_session: AsyncSession,
) -> None:
    """Server capture + a client engagement supplement for the same answer = one counted event."""
    from app.schemas.personalization import QuestionInteractionEventIn
    from app.services.taste_profile import record_interaction

    user = await _user(db_session)
    entry = await start_practice(db_session, user.id, category=None, mode=None)
    answers = await _round_answers(db_session, entry.id)
    await answer_practice_round(
        db_session, entry.id, user.id, 0,
        _correct_result(answers[0].module_type, answers[0].server_answer),
    )

    # The client posts its engagement-only supplement for the same round.
    await record_interaction(
        db_session,
        user.id,
        QuestionInteractionEventIn(
            mode="practice", entry_id=entry.id, idx=0, explanation_opened=True
        ),
    )

    profile = await get_or_create_profile(db_session, user.id)
    assert profile.interaction_count == 1  # server counted; the supplement did not
    events = await _events(db_session, user.id)
    assert len(events) == 2  # one server event + one engagement supplement row (both stored)
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_universal_evaluation.py -v`
Expected: PASS. (If `GUEST_STATUS`/`User.status` field names differ, align with `app/models/user.py`.)

- [ ] **Step 3: Update the docs**

In `docs/personalization.md`, under "How it behaves", add a bullet:

```markdown
- **Universal capture (sub-project A):** every mode records a server-authoritative answer signal at
  its per-round scoring point — practice/campaign (`answer_practice_round`), Daily Royale
  (`answer_round`), bot duel (`submit_duel_round`), friend duel (`submit_answer`) — via
  `taste_profile.record_answer_signal`. Correctness and speed come from the server's own judgement
  (never client-reported). The `POST /personalization/events` client channel is now an
  engagement-only supplement (explanation-read / share) and is count-neutral, so `interaction_count`
  equals the number of answers. Ranked play is recorded but selection stays un-personalized.
```

- [ ] **Step 4: Full backend + frontend suite**

Run: `cd backend && uv run pytest -q`
Run: `cd frontend && npm run typecheck && npx vitest run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_universal_evaluation.py docs/personalization.md
git commit -m "test(personalization): guest capture + no-double-count guarantees; docs"
```

---

## Self-review

**Spec coverage:**
- "One seam `record_answer_signal`" → Task 2. ✓
- Four chokepoints (practice/campaign, royale, bot duel, friend duel) → Tasks 3–6. ✓
- Server-authoritative fields incl. real speed from `time_frac` → Task 2 (`response_ms = round(limit_ms*(1-time_frac))`). ✓
- Client shrinks to engagement-only → Task 8; count-neutral `/events` → Task 7. ✓
- Ranked records but not personalized → Task 4 runs `test_personalization_ranking` to prove selection is unchanged. ✓
- Guests build profiles → Task 9. ✓
- No migration → confirmed (reuses existing columns). ✓
- Best-effort/never-sink-a-score + flush-not-commit → Task 2 (try/except, flush only). ✓
- Idempotency / one counted event per answer → Task 9 double-count test. ✓
- Feature-flag off → Task 2 `test_record_answer_signal_noop_when_disabled`. ✓

**Placeholder scan:** Tasks 4/5/6 contain two "confirm the helper/constructor name against the existing test file" notes. These are deliberate reuse guards (the plan reuses each mode's established test scaffolding rather than re-deriving heavy setup), and each provides the concrete fallback (drive via the API / build inline). All implementation-code steps are complete and literal.

**Type consistency:** `record_answer_signal(...)` keyword args are identical across Tasks 2–6 (`question_id`, `mode`, `is_correct`, `time_frac`, `limit_ms`, `streak_before`, `streak_after`, `session_id`). `question_id_from_server_answer` returns `uuid.UUID | None`, matching the nullable `question_id` column. `count_interaction` default `True` (Task 1) is overridden `False` only in `record_interaction` (Task 7). Consistent. ✓
