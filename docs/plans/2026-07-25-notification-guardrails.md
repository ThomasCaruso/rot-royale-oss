# Notification Guardrails + Current-Set Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Rot Royale's *existing* notifications feel valued, not spammy — add a single frequency governor (quiet hours + daily caps), cut the midnight window-open blast, auto-retime streak-saved out of the middle of the night, and reframe the daily reminder as the on-brand "Rot Check" drop.

**Architecture:** A new `services/notify_governor.py` exposes `can_send(session, user_id, kind, now)` — a pure read+policy check (quiet hours ~9 PM–8 AM ET, ≤1 automated + ≤2 directed + ≤3 total pushes per user per ET day). Counts are derived from the *existing* `user_notifications` rows via a `KIND_META` map, so **no new table and no migration**. Each user-targeted notifier calls `can_send()` before it claims its per-kind gate and sends. Quiet hours doubles as free retiming: a night-time trigger is blocked and re-sent by a later morning heartbeat.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy async, pytest (async, rolled-back `db_session` + committed-engine fixtures), `America/New_York` zoneinfo via `app.core.timezone.ET`.

**Scope note:** This is the first of several notification plans (design: `docs/plans/notifications-system-design.md`). It covers **only** the guardrail + current-set cleanup. Localization (`Profile.locale` + server copy catalog), permission priming + iOS provisional auth, the service-worker tap handler, and the new Phase-2 notifications (friend-beat, result recap) are **separate follow-on plans**. The friend-challenge `challenged` kind lives on branch `feat/friend-daily-challenge` (PR #38); `KIND_META` already includes it so the governor covers it once that merges — wiring its endpoint through `can_send()` is a one-line follow-up noted at the end.

---

## File Structure

- **Create** `backend/app/services/notify_governor.py` — the governor: `KIND_META`, caps, `in_quiet_hours()`, `can_send()`. One responsibility: "may we send this push now?"
- **Create** `backend/tests/test_notify_governor.py` — unit tests for quiet hours + caps (rolled-back `db_session`).
- **Modify** `backend/app/services/push.py` — route `notify_daily_reminder` + `notify_streak_saved` through `can_send()`; reframe `_reminder_payload` copy to the Rot Check drop.
- **Modify** `backend/app/jobs/daemon.py:63` and `backend/app/jobs/run.py:249` — remove the window-open blast calls.
- **Modify** `backend/app/jobs/tasks.py` — remove the now-unused `notify_window_opens` wrapper + its import.
- **Modify** `backend/tests/test_push_reengagement.py` — add a governor-integration assertion (streak-saved deferred at night, sent in the morning).

`notify_open_windows()` in `push.py` and its `test_push.py` unit test are **left in place** (dead but valid) — retiring the *scheduling* is what stops the blast; deleting the function is unnecessary churn.

---

## Task 1: The governor module

**Files:**
- Create: `backend/app/services/notify_governor.py`
- Test: `backend/tests/test_notify_governor.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_notify_governor.py`:

```python
"""Notification frequency governor — quiet hours + per-day caps. Uses the rolled-back db_session:
can_send() only reads user_notifications, and we seed rows directly."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from app.core.timezone import ET
from app.models import User, UserNotification
from app.services.notify_governor import can_send, in_quiet_hours
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

# 2 PM ET (a safe, non-quiet hour) and 2 AM ET (quiet).
MIDDAY = datetime(2026, 6, 15, 14, 0, tzinfo=ET).astimezone(UTC)
NIGHT = datetime(2026, 6, 15, 2, 0, tzinfo=ET).astimezone(UTC)
TODAY_ET = date(2026, 6, 15)


def test_in_quiet_hours_boundaries():
    assert in_quiet_hours(datetime(2026, 6, 15, 21, 0, tzinfo=ET).astimezone(UTC)) is True   # 9 PM
    assert in_quiet_hours(datetime(2026, 6, 15, 7, 59, tzinfo=ET).astimezone(UTC)) is True    # 7:59 AM
    assert in_quiet_hours(datetime(2026, 6, 15, 8, 0, tzinfo=ET).astimezone(UTC)) is False     # 8 AM
    assert in_quiet_hours(datetime(2026, 6, 15, 20, 59, tzinfo=ET).astimezone(UTC)) is False   # 8:59 PM


async def _seed_user(session: AsyncSession) -> uuid.UUID:
    uid = uuid.uuid4()
    await session.execute(insert(User).values(id=uid, email=f"{uid.hex}@x.com", password_hash="x"))
    return uid


async def _seed_sent(session: AsyncSession, uid: uuid.UUID, kind: str) -> None:
    await session.execute(
        insert(UserNotification).values(user_id=uid, notify_date=TODAY_ET, kind=kind)
    )


async def test_blocks_during_quiet_hours(db_session: AsyncSession):
    uid = await _seed_user(db_session)
    assert await can_send(db_session, uid, "daily_reminder", NIGHT) is False


async def test_allows_first_automated_of_day(db_session: AsyncSession):
    uid = await _seed_user(db_session)
    assert await can_send(db_session, uid, "daily_reminder", MIDDAY) is True


async def test_second_automated_blocked_by_cap(db_session: AsyncSession):
    uid = await _seed_user(db_session)
    await _seed_sent(db_session, uid, "daily_reminder")  # 1 automated already sent today
    assert await can_send(db_session, uid, "streak_saved", MIDDAY) is False


async def test_directed_allowed_alongside_automated(db_session: AsyncSession):
    uid = await _seed_user(db_session)
    await _seed_sent(db_session, uid, "daily_reminder")  # automated used
    assert await can_send(db_session, uid, "challenged", MIDDAY) is True  # directed has its own budget


async def test_directed_second_allowed_third_blocked(db_session: AsyncSession):
    uid = await _seed_user(db_session)
    await _seed_sent(db_session, uid, "challenged")
    # Second directed of a DIFFERENT kind is allowed (cap is 2 directed/day).
    assert await can_send(db_session, uid, "friend_beat", MIDDAY) is True
    await _seed_sent(db_session, uid, "friend_beat")
    # A hypothetical third directed would exceed DIRECTED_DAILY_CAP.
    assert await can_send(db_session, uid, "friend_beat", MIDDAY) is False


async def test_total_ceiling(db_session: AsyncSession):
    uid = await _seed_user(db_session)
    await _seed_sent(db_session, uid, "daily_reminder")  # 1 automated
    await _seed_sent(db_session, uid, "challenged")       # 1 directed
    await _seed_sent(db_session, uid, "friend_beat")      # 2 directed → 3 total
    # Nothing more today, automated or directed — the hard 3/day ceiling.
    assert await can_send(db_session, uid, "streak_saved", MIDDAY) is False
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_notify_governor.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.notify_governor'`.

- [ ] **Step 3: Write the governor**

Create `backend/app/services/notify_governor.py`:

```python
"""Notification frequency governor — the single 'less is more' guardrail every push routes through.

Rot Royale sends a small set of notifications (docs/plans/notifications-system-design.md). To keep
them feeling valued, EVERY user-targeted send passes can_send() first:

  1. quiet hours — nothing 9 PM–8 AM ET. (v1 uses the contest tz; per-user tz is a later plan.) A
     night-time trigger (e.g. streak-saved at 12:15 AM) is simply blocked and re-sent by a later
     morning heartbeat — automatic retiming, no extra job.
  2. daily caps  — ≤1 AUTOMATED and ≤2 DIRECTED (user-initiated social) pushes per user per ET day,
     with a hard ceiling of 3 total.

Counts are derived from the existing user_notifications rows (the per-kind exactly-once gate) via
KIND_META — no new table, no migration. can_send() is a pure read + policy check; the caller still
claims the per-kind gate when it actually sends.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import ET
from app.models import UserNotification

# kind -> (category, is_automated). Directed = user-initiated social (inherently welcome, own budget).
KIND_META: dict[str, tuple[str, bool]] = {
    "daily_reminder": ("reminder", True),  # the daily Rot Check drop
    "streak_saved": ("reminder", True),
    "result_recap": ("result", True),      # Phase 2
    "milestone": ("result", True),         # Phase 3
    "winback": ("reminder", True),         # Phase 3
    "challenged": ("social", False),       # friend-challenge (directed; PR #38)
    "friend_beat": ("social", False),      # Phase 2 (directed)
}

AUTOMATED_DAILY_CAP = 1
DIRECTED_DAILY_CAP = 2
TOTAL_DAILY_CAP = 3

QUIET_START_HOUR_ET = 21  # 9 PM ET — no sends at/after this hour
QUIET_END_HOUR_ET = 8     # 8 AM ET — no sends before this hour


def _is_automated(kind: str) -> bool:
    meta = KIND_META.get(kind)
    return meta[1] if meta is not None else True  # unknown kinds: treat as automated (conservative)


def in_quiet_hours(now: datetime) -> bool:
    """True during the ~9 PM–8 AM ET blackout. Triggers here are deferred to the next allowed hour."""
    hour = now.astimezone(ET).hour
    return hour >= QUIET_START_HOUR_ET or hour < QUIET_END_HOUR_ET


async def _kinds_sent_today(
    session: AsyncSession, user_id: uuid.UUID, today
) -> list[str]:
    rows = (
        await session.execute(
            select(UserNotification.kind).where(
                UserNotification.user_id == user_id,
                UserNotification.notify_date == today,
            )
        )
    ).scalars().all()
    return list(rows)


async def can_send(
    session: AsyncSession, user_id: uuid.UUID, kind: str, now: datetime
) -> bool:
    """True iff a push of `kind` to `user_id` is allowed right now (quiet hours + daily caps).

    Read-only: does NOT claim anything. The caller claims the per-kind user_notifications gate when
    it actually sends.
    """
    if in_quiet_hours(now):
        return False
    today = now.astimezone(ET).date()
    kinds = await _kinds_sent_today(session, user_id, today)
    if len(kinds) >= TOTAL_DAILY_CAP:
        return False
    automated = sum(1 for k in kinds if _is_automated(k))
    directed = len(kinds) - automated
    if _is_automated(kind):
        return automated < AUTOMATED_DAILY_CAP
    return directed < DIRECTED_DAILY_CAP
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_notify_governor.py -q`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/notify_governor.py backend/tests/test_notify_governor.py
git commit -m "feat(notify): frequency governor — quiet hours + per-day caps (migration-free)"
```

---

## Task 2: Route the reengagement notifiers through the governor

**Files:**
- Modify: `backend/app/services/push.py` (the `for uid in candidates:` loop in `notify_daily_reminder`, and the equivalent claim loop in `notify_streak_saved`)
- Test: `backend/tests/test_push_reengagement.py`

- [ ] **Step 1: Retime the shared evening constant + add the deferral test**

Routing the reminder through the governor blocks sends during quiet hours (≥9 PM ET). The existing tests send at `EVENING_UTC` = **9 PM ET**, which the governor now blocks — so retime that one constant into the allowed evening window (past the 8 PM `push_reminder_hour_et` gate, before the 9 PM quiet cutoff). This keeps every existing evening test valid under the governor with a single edit.

In `backend/tests/test_push_reengagement.py`, change:
```python
EVENING_UTC = datetime(2026, 6, 15, 21, 0, tzinfo=ET).astimezone(UTC)  # 9 PM ET
```
to:
```python
EVENING_UTC = datetime(2026, 6, 15, 20, 30, tzinfo=ET).astimezone(UTC)  # 8:30 PM ET (past reminder gate, pre-quiet)
NIGHT_UTC = datetime(2026, 6, 15, 2, 0, tzinfo=ET).astimezone(UTC)      # 2 AM ET — quiet hours
```

Then add the deferral test (night blocked, allowed-evening sends):

```python
async def test_daily_reminder_deferred_during_quiet_hours():
    async with _world(streak=4) as (engine, _uid):
        calls, send = _recorder()
        async with AsyncSession(engine) as s:
            await notify_daily_reminder(s, send, now=NIGHT_UTC)  # 2 AM ET → governor blocks, no claim
        assert calls == []
        async with AsyncSession(engine) as s:
            await notify_daily_reminder(s, send, now=EVENING_UTC)  # allowed evening → sends once
        assert len(calls) == 1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && uv run pytest tests/test_push_reengagement.py::test_daily_reminder_deferred_during_quiet_hours -q`
Expected: FAIL — with the governor not wired yet, the 2 AM send still delivers 1 call, so `assert calls == []` fails.

- [ ] **Step 3: Wire `can_send` into the claim loops**

In `backend/app/services/push.py`, add the import near the top (with the other `app.services`/model imports):

```python
from app.services.notify_governor import can_send
```

In `notify_daily_reminder`, change the claim loop so each candidate must pass the governor before claiming:

```python
    claimed: set[uuid.UUID] = set()
    for uid in candidates:
        if not await can_send(session, uid, "daily_reminder", now):
            continue
        claim = (
            pg_insert(UserNotification)
            .values(user_id=uid, notify_date=today, kind="daily_reminder")
            .on_conflict_do_nothing(index_elements=["user_id", "notify_date", "kind"])
            .returning(UserNotification.user_id)
        )
        if (await session.scalars(claim)).one_or_none() is not None:
            claimed.add(uid)
```

Apply the identical guard in `notify_streak_saved`'s claim loop, using `"streak_saved"` as the kind and that function's `now` (it already accepts `now: datetime | None = None`; ensure `now = now or datetime.now(UTC)` is set before the loop, mirroring `notify_daily_reminder`).

- [ ] **Step 4: Run the reengagement tests**

Run: `cd backend && uv run pytest tests/test_push_reengagement.py -q`
Expected: PASS (existing tests + the new one). Because `EVENING_UTC` is now 8:30 PM ET (Step 1), the existing evening tests — `test_daily_reminder_fires_streak_aware_and_exactly_once`, `test_daily_reminder_skips_players`, `test_streak_saved_fires_once_when_grace_used` — all send in the allowed window and stay green under the governor.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/push.py backend/tests/test_push_reengagement.py
git commit -m "feat(notify): route daily-reminder + streak-saved through the governor (auto-retimes night sends)"
```

---

## Task 3: Cut the midnight window-open blast

**Files:**
- Modify: `backend/app/jobs/daemon.py` (remove the `notify_window_opens` call, ~line 63)
- Modify: `backend/app/jobs/run.py` (remove the `notify_window_opens` call, ~line 249)
- Modify: `backend/app/jobs/tasks.py` (remove the `notify_window_opens` wrapper + its `notify_open_windows` import)

- [ ] **Step 1: Remove the scheduled calls**

In `backend/app/jobs/daemon.py`, delete the line:

```python
        await notify_window_opens(session)  # 'window open' push (exactly-once); commits itself
```

and remove `notify_window_opens` from the imports at the top of the file.

In `backend/app/jobs/run.py`, delete the line:

```python
            await notify_window_opens(session)  # 'window open' push, after the open is committed
```

and remove `notify_window_opens` from that file's imports.

- [ ] **Step 2: Remove the now-unused task wrapper**

In `backend/app/jobs/tasks.py`, delete the `notify_window_opens` function (the wrapper at ~line 119–125) and remove `notify_open_windows` from the `from app.services.push import (...)` block.

- [ ] **Step 3: Verify nothing references the removed symbols**

Run: `cd backend && uv run ruff check app && uv run mypy app`
Expected: `All checks passed!` and `Success: no issues found`. (Ruff's unused-import + undefined-name rules confirm the cut is clean.)

- [ ] **Step 4: Verify the suite still passes**

Run: `cd backend && uv run pytest tests/test_push.py tests/test_push_reengagement.py -q`
Expected: PASS. `test_push.py`'s `notify_open_windows` unit test still passes — we retired the *scheduling*, not the function.

- [ ] **Step 5: Commit**

```bash
git add backend/app/jobs/daemon.py backend/app/jobs/run.py backend/app/jobs/tasks.py
git commit -m "feat(notify): cut the midnight window-open broadcast (daily Rot Check drop replaces it)"
```

---

## Task 4: Reframe the daily reminder as the Rot Check drop

**Files:**
- Modify: `backend/app/services/push.py` (`_reminder_payload`)
- Test: `backend/tests/test_push_reengagement.py`

- [ ] **Step 1: Update the copy test**

In `backend/tests/test_push_reengagement.py`, the existing `test_daily_reminder_fires_streak_aware_and_exactly_once` asserts `"4-day streak" in calls[0][1]["body"]`. Keep that assertion (the streak flavor still names the streak) and add a no-streak copy test:

```python
async def test_daily_reminder_no_streak_uses_rot_check_drop_copy():
    async with _world(streak=0) as (engine, _uid):
        calls, send = _recorder()
        async with AsyncSession(engine) as s:
            await notify_daily_reminder(s, send, now=EVENING_UTC)  # 8:30 PM ET (allowed window)
        assert len(calls) == 1
        body = calls[0][1]["body"].lower()
        assert "brainrot" in body  # anticipatory drop framing, not a streak nag
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && uv run pytest tests/test_push_reengagement.py::test_daily_reminder_no_streak_uses_rot_check_drop_copy -q`
Expected: FAIL — current no-streak body is "It closes at midnight — get your run in before it's gone."; no "brainrot".

- [ ] **Step 3: Reframe the copy**

In `backend/app/services/push.py`, replace `_reminder_payload`:

```python
def _reminder_payload(streak: int) -> dict[str, str]:
    # The daily Rot Check drop (Wordle-style). No-streak = anticipatory; streak = late-day urgency.
    if streak >= 1:
        return {
            "title": "Your streak's on the line 🔥",
            "body": f"Today's Rot Check closes at midnight — keep your {streak}-day streak alive.",
            "url": "/",
        }
    return {
        "title": "Today's Rot Check is live 🧠",
        "body": "A fresh one just dropped — how bad is your brainrot today?",
        "url": "/",
    }
```

- [ ] **Step 4: Run the reengagement tests**

Run: `cd backend && uv run pytest tests/test_push_reengagement.py -q`
Expected: PASS (streak test still finds "4-day streak"; new test finds "brainrot").

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/push.py backend/tests/test_push_reengagement.py
git commit -m "feat(notify): reframe daily reminder as the on-brand Rot Check drop"
```

---

## Task 5: Final verification

- [ ] **Step 1: Full backend gate (matches CI + local test DB)**

Run:
```bash
cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app \
  && uv run pytest tests/test_notify_governor.py tests/test_push.py tests/test_push_reengagement.py tests/test_friends.py -q
```
Expected: ruff `All checks passed!`, format clean, mypy `Success`, pytest all PASS.

> If pytest errors with `Can't locate revision 'd2f3a4b5c6e7'`, the throwaway test DB is stamped from another branch. Reset it (safe — it's not the dev DB):
> `PGPASSWORD=rot_royale "C:\Program Files\PostgreSQL\16\bin\psql.exe" -h localhost -U rot_royale -d rot_royale_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION rot_royale;"`
> then re-run — conftest migrates it fresh to head.

- [ ] **Step 2: Confirm the governor covers every scheduled notifier**

Grep to confirm both reengagement notifiers guard on `can_send` and no scheduled path still calls `notify_window_opens`:

Run: `cd backend && rg "can_send|notify_window_opens" app/services/push.py app/jobs/`
Expected: `can_send` appears in both `notify_daily_reminder` and `notify_streak_saved`; `notify_window_opens` appears **nowhere** in `app/jobs/`.

---

## Follow-ups (not this plan)

- **Friend-challenge through the governor:** once PR #38 (`feat/friend-daily-challenge`) merges, add a `can_send(session, target.user_id, "challenged", now)` guard in `services/friend_challenge.py::challenge_friend_to_daily` before it claims the gate — one line, mirrors Task 2. Its endpoint returns `sent=False` when the governor blocks (already the "already challenged today" shape).
- **Localization** (`Profile.locale` + server copy catalog), **permission priming + iOS provisional**, **service-worker `notificationclick` handler**, and **Phase-2 notifications** (friend-beat digest, morning result recap) are separate plans per `docs/plans/notifications-system-design.md` §9.
