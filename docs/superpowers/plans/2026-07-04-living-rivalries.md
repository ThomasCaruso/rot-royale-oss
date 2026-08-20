# Living Rivalries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Commits are DEFERRED this session** — implement + test each step, but do NOT `git commit`/`git add`/branch.

**Goal:** Turn the static head-to-head duel record into a living rivalry on the Friends screen — a surfaced "Rival" (record + streak + last result + Settle-the-score) and streak/last-result on every friend row.

**Architecture:** Extend the friends read path: a `_rivalry_stats` service computes per-friend streak/last-result/last-played/14-day-count from completed `friend_duels`, and `list_friends` picks the "hottest" rival. `GET /friends` gains those per-friend fields + a top-level `rival_user_id`. The Friends screen renders a `RivalCard` + enriched rows. No new tables/migration; reuses the existing challenge flow.

**Tech Stack:** FastAPI + SQLAlchemy async; React/TS + Vitest. Spec: `docs/superpowers/specs/2026-07-04-living-rivalries-design.md`.

## Reference facts (verified)

- `app/services/friends.py`: `@dataclass FriendSummary(user_id, username, avatar_preset, wins, losses)`; `@dataclass FriendsList(friends, incoming, outgoing)`; `_head_to_head(session, user_id) -> dict[opp_id, (wins,losses)]` (used ONLY by `list_friends`); `list_friends(...)` builds `FriendSummary(other_id, prof.username, prof.avatar_preset, wins, losses)` from `_head_to_head`. Imports `or_`, `select`, `FriendDuel`.
- `app/models/social.py::FriendDuel(challenger_id, opponent_id, status, winner_side ['challenger'|'opponent'|None], completed_at, created_at, contest_date, ...)`. Completed duels carry `winner_side` + `completed_at`.
- `app/schemas/social.py`: `FriendOut(user_id, username, avatar_preset, wins, losses)`; `FriendsResponse(friends: list[FriendOut], incoming, outgoing)`.
- `app/api/friends.py::get_friends` (route `GET /friends`) builds `FriendsResponse` from `list_friends` (maps `FriendSummary` → `FriendOut`). Find the mapping and mirror it.
- Frontend `src/api/client.ts`: `interface Friend { user_id; username; avatar_preset; wins; losses }` (line ~473); `interface FriendsResponse { friends: Friend[]; incoming; outgoing }` (~489). `api.friends()` → FriendsResponse. `api.createFriendDuel(username)`.
- `src/screens/friends/FriendsScreen.tsx`: maps `data.friends` to `<Row avatar name sub>...<button style={duelOutlineBtn}>{t.friends.challenge}</button></Row>`; `sub` currently = record or `noDuelsYet`. Avatar via `@/screens/home/Avatar`. `duelOutlineBtn` style exists (slim black outline). i18n `t.friends.*` + `fmt`.
- Tests: backend async rolled-back (`db_session`/`client`), `cd backend && uv run pytest` (prefix `PYTHONIOENCODING=utf-8`). `tests/test_friend_duel.py` has friend-accept helpers. Frontend vitest needs `afterEach(cleanup)`; assert with `.toBeTruthy()`.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `backend/app/services/friends.py` | `RivalryStat`, `_rivalry_stats`, enrich `FriendSummary`/`FriendsList` + rival pick | Modify |
| `backend/app/schemas/social.py` | `FriendOut` + `FriendsResponse` new fields | Modify |
| `backend/app/api/friends.py` | map new fields into the response | Modify |
| `backend/tests/test_rivalry.py` | rivalry-stats + rival-selection + endpoint tests | Create |
| `frontend/src/api/client.ts` | `Friend` + `FriendsResponse` new fields | Modify |
| `frontend/src/i18n/{en,es,tr}.ts` | `rivalry` copy group | Modify |
| `frontend/src/screens/friends/RivalCard.tsx` | the Rival highlight card | Create |
| `frontend/src/screens/friends/RivalCard.test.tsx` | RivalCard tests | Create |
| `frontend/src/screens/friends/FriendsScreen.tsx` | mount RivalCard + enrich the row `sub` line | Modify |

---

### Task 1: `_rivalry_stats` + rival selection (backend service)

**Files:** Modify `backend/app/services/friends.py`; Test `backend/tests/test_rivalry.py` (new).

- [ ] **Step 1: Write the failing test** — create `backend/tests/test_rivalry.py`:

```python
"""Living rivalries — per-friend streak/last-result/14-day stats + 'hottest' rival selection."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Profile, User
from app.models.social import FriendDuel
from app.services.friends import list_friends, send_friend_request

pytestmark = pytest.mark.asyncio


async def _user(session: AsyncSession, name: str) -> User:
    u = User(email=f"{name}-{uuid.uuid4().hex[:6]}@example.com", password_hash="x")
    session.add(u)
    await session.flush()
    session.add(Profile(user_id=u.id, username=f"{name}{uuid.uuid4().hex[:5]}", division="bronze"))
    await session.flush()
    return u


async def _befriend(session: AsyncSession, a: User, b: User) -> None:
    ap = await session.get(Profile, a.id)
    bp = await session.get(Profile, b.id)
    await send_friend_request(session, a.id, bp.username)
    await send_friend_request(session, b.id, ap.username)


async def _duel(session, challenger, opponent, winner_side, days_ago: float) -> None:
    ts = datetime.now(UTC) - timedelta(days=days_ago)
    session.add(
        FriendDuel(
            challenger_id=challenger.id, opponent_id=opponent.id, status="completed",
            seed=1, round_set=[], server_answers=[], contest_date=ts.date(),
            winner_side=winner_side, challenger_round_wins=4, opponent_round_wins=2,
            completed_at=ts,
        )
    )
    await session.flush()


async def test_rivalry_streak_and_last_result(db_session: AsyncSession) -> None:
    me = await _user(db_session, "me")
    ava = await _user(db_session, "ava")
    await _befriend(db_session, me, ava)
    # oldest -> newest: me wins, me wins, me loses, me wins, me wins, me wins  (streak = +3)
    await _duel(db_session, me, ava, "challenger", 10)
    await _duel(db_session, me, ava, "challenger", 9)
    await _duel(db_session, me, ava, "opponent", 8)
    await _duel(db_session, me, ava, "challenger", 2)
    await _duel(db_session, me, ava, "challenger", 1)
    await _duel(db_session, me, ava, "challenger", 0.1)

    friends = (await list_friends(db_session, me.id)).friends
    f = next(x for x in friends if x.user_id == ava.id)
    assert (f.wins, f.losses) == (5, 1)
    assert f.streak == 3           # won the last 3 straight
    assert f.last_result == "won"
    assert f.duels_14d == 6        # all within 14 days


async def test_rival_is_hottest_in_last_14_days(db_session: AsyncSession) -> None:
    me = await _user(db_session, "me")
    ava = await _user(db_session, "ava")   # dueled a lot long ago
    bob = await _user(db_session, "bob")   # dueled recently (hot)
    for f in (ava, bob):
        await _befriend(db_session, me, f)
    for _ in range(5):
        await _duel(db_session, me, ava, "challenger", 40)  # old
    await _duel(db_session, me, bob, "opponent", 1)          # recent
    await _duel(db_session, me, bob, "challenger", 0.5)

    fl = await list_friends(db_session, me.id)
    assert fl.rival_user_id == bob.id   # hottest in the last 14 days, not the high-volume-but-cold ava


async def test_no_duels_means_no_rival(db_session: AsyncSession) -> None:
    me = await _user(db_session, "me")
    ava = await _user(db_session, "ava")
    await _befriend(db_session, me, ava)
    fl = await list_friends(db_session, me.id)
    assert fl.rival_user_id is None
    f = next(x for x in fl.friends if x.user_id == ava.id)
    assert f.streak == 0 and f.last_result is None and f.duels_14d == 0
```

- [ ] **Step 2: Run, expect FAIL** (`FriendSummary` has no `streak` / `FriendsList` has no `rival_user_id`):
`cd backend && uv run pytest tests/test_rivalry.py -v`

- [ ] **Step 3: Implement** in `backend/app/services/friends.py`. Add `from datetime import UTC, datetime, timedelta` (merge with existing datetime import). Extend the dataclasses and add the stats fn:

```python
@dataclass
class FriendSummary:
    user_id: uuid.UUID
    username: str
    avatar_preset: str
    wins: int
    losses: int
    streak: int = 0                 # +N = won last N straight; -N = lost last N; 0 = none
    last_result: str | None = None  # "won" | "lost" | None
    last_played: datetime | None = None
    duels_14d: int = 0
```
Add `rival_user_id` to `FriendsList`:
```python
@dataclass
class FriendsList:
    friends: list[FriendSummary]
    incoming: list[FriendRequestSummary]
    outgoing: list[FriendRequestSummary]
    rival_user_id: uuid.UUID | None = None
```
Add a `RivalryStat` + `_rivalry_stats` (place near `_head_to_head`):
```python
@dataclass
class RivalryStat:
    wins: int
    losses: int
    streak: int
    last_result: str | None
    last_played: datetime | None
    duels_14d: int


async def _rivalry_stats(session: AsyncSession, user_id: uuid.UUID) -> dict[uuid.UUID, RivalryStat]:
    """Per-opponent rivalry stats from this user's COMPLETED friend duels (oldest→newest)."""
    rows = (
        (
            await session.execute(
                select(FriendDuel)
                .where(
                    FriendDuel.status == "completed",
                    FriendDuel.completed_at.is_not(None),
                    or_(FriendDuel.challenger_id == user_id, FriendDuel.opponent_id == user_id),
                )
                .order_by(FriendDuel.completed_at)
            )
        )
        .scalars()
        .all()
    )
    cutoff = datetime.now(UTC) - timedelta(days=14)
    hist: dict[uuid.UUID, list[tuple[bool, datetime]]] = {}
    for d in rows:
        my_side = "challenger" if d.challenger_id == user_id else "opponent"
        other = d.opponent_id if my_side == "challenger" else d.challenger_id
        hist.setdefault(other, []).append((d.winner_side == my_side, d.completed_at))

    stats: dict[uuid.UUID, RivalryStat] = {}
    for opp, h in hist.items():
        wins = sum(1 for won, _ in h if won)
        last_won = h[-1][0]
        streak = 0
        for won, _ in reversed(h):
            if won == last_won:
                streak += 1
            else:
                break
        stats[opp] = RivalryStat(
            wins=wins,
            losses=len(h) - wins,
            streak=streak if last_won else -streak,
            last_result="won" if last_won else "lost",
            last_played=h[-1][1],
            duels_14d=sum(1 for _, ts in h if ts >= cutoff),
        )
    return stats
```
In `list_friends`, replace the `record = await _head_to_head(...)` usage: call `stats = await _rivalry_stats(session, user_id)`, and where it builds each accepted `FriendSummary`, pull from `stats`:
```python
    stats = await _rivalry_stats(session, user_id)
    # ... in the accepted branch:
    s = stats.get(other_id)
    friends.append(
        FriendSummary(
            other_id, prof.username, prof.avatar_preset,
            wins=s.wins if s else 0,
            losses=s.losses if s else 0,
            streak=s.streak if s else 0,
            last_result=s.last_result if s else None,
            last_played=s.last_played if s else None,
            duels_14d=s.duels_14d if s else 0,
        )
    )
```
After the friends list is built + sorted, compute the rival:
```python
    accepted_ids = {f.user_id for f in friends}
    candidates = [
        (oid, s) for oid, s in stats.items() if oid in accepted_ids and (s.wins + s.losses) > 0
    ]
    rival_user_id = (
        max(candidates, key=lambda kv: (kv[1].duels_14d, kv[1].last_played or datetime.min.replace(tzinfo=UTC)))[0]
        if candidates
        else None
    )
    return FriendsList(friends=friends, incoming=incoming, outgoing=outgoing, rival_user_id=rival_user_id)
```
(Leave `_head_to_head` in place — it's now unused by `list_friends` but harmless; do NOT delete unless ruff flags it, in which case remove it.)

- [ ] **Step 4: Run, expect PASS:** `cd backend && uv run pytest tests/test_rivalry.py -v`. Then `cd backend && uv run pytest tests/test_friends*.py tests/test_friend_duel.py -q` (no regressions in the friends surface). Ruff: `cd backend && uv run ruff check app/services/friends.py tests/test_rivalry.py`.
- [ ] **Step 5: Do NOT commit.** Report.

---

### Task 2: Schema + endpoint mapping

**Files:** Modify `backend/app/schemas/social.py`, `backend/app/api/friends.py`; Test `backend/tests/test_rivalry.py`.

- [ ] **Step 1: Add a failing endpoint test** to `backend/tests/test_rivalry.py` (uses the `client` fixture; register two users, friend them, one completed duel, then GET /friends):

```python
from httpx import AsyncClient


async def _register(client: AsyncClient, name: str) -> tuple[str, str]:
    uname = f"{name}{uuid.uuid4().hex[:5]}"
    r = await client.post(
        "/auth/register",
        json={"email": f"{uuid.uuid4().hex[:8]}@example.com", "username": uname, "password": "super-secret-pw"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"], uname


async def test_friends_endpoint_exposes_rivalry_fields(client: AsyncClient) -> None:
    ta, ua = await _register(client, "a")
    tb, ub = await _register(client, "b")
    await client.post("/friends/requests", json={"username": ub}, headers={"Authorization": f"Bearer {ta}"})
    await client.post("/friends/requests", json={"username": ua}, headers={"Authorization": f"Bearer {tb}"})
    r = await client.get("/friends", headers={"Authorization": f"Bearer {ta}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "rival_user_id" in body
    assert set(body["friends"][0]) >= {"streak", "last_result", "last_played", "duels_14d"}
```

- [ ] **Step 2: Run, expect FAIL** (fields absent): `cd backend && uv run pytest tests/test_rivalry.py::test_friends_endpoint_exposes_rivalry_fields -v`

- [ ] **Step 3: Extend the schema** in `backend/app/schemas/social.py`:
```python
class FriendOut(BaseModel):
    user_id: uuid.UUID
    username: str
    avatar_preset: str
    wins: int
    losses: int
    streak: int = 0
    last_result: str | None = None
    last_played: datetime | None = None
    duels_14d: int = 0


class FriendsResponse(BaseModel):
    friends: list[FriendOut]
    incoming: list[FriendRequestOut]
    outgoing: list[FriendRequestOut]
    rival_user_id: uuid.UUID | None = None
```
(`datetime` is already imported in this module — it's used by `FriendRequestOut`.)

- [ ] **Step 4: Map the fields** in `backend/app/api/friends.py::get_friends`. Find where it builds `FriendOut(...)` from each `FriendSummary` and `FriendsResponse(...)`, and add the new fields:
```python
    data = await list_friends(session, user.id)
    return FriendsResponse(
        friends=[
            FriendOut(
                user_id=f.user_id, username=f.username, avatar_preset=f.avatar_preset,
                wins=f.wins, losses=f.losses,
                streak=f.streak, last_result=f.last_result,
                last_played=f.last_played, duels_14d=f.duels_14d,
            )
            for f in data.friends
        ],
        incoming=[...unchanged...],
        outgoing=[...unchanged...],
        rival_user_id=data.rival_user_id,
    )
```
Keep the existing `incoming`/`outgoing` mapping exactly as it is; only add the friend fields + `rival_user_id`.

- [ ] **Step 5: Run, expect PASS:** `cd backend && uv run pytest tests/test_rivalry.py -v`. Ruff the two files. Also `cd backend && uv run pytest -k friend -q` (friends/friend-duel suites green).
- [ ] **Step 6: Do NOT commit.** Report.

---

### Task 3: Frontend types + i18n

**Files:** Modify `frontend/src/api/client.ts`, `frontend/src/i18n/{en,es,tr}.ts`.

- [ ] **Step 1: Extend types** in `client.ts`. On `interface Friend` add:
```ts
  streak: number;        // +N won last N straight, -N lost last N, 0 none
  last_result: "won" | "lost" | null;
  last_played: string | null;  // ISO
  duels_14d: number;
```
On `interface FriendsResponse` add `rival_user_id: string | null;`.

- [ ] **Step 2: i18n** — add a `rivalry` group to `en.ts` (mirror in es/tr):
```ts
  rivalry: {
    label: "Your Rival",
    youLead: "You lead {w}–{l}",
    youTrail: "Down {w}–{l}",
    even: "Even {w}–{l}",
    wonStreak: "won {n} straight",
    lostStreak: "lost {n} straight",
    lastWon: "beat them {when}",
    lastLost: "lost to them {when}",
    settle: "Settle the score",
    startRivalry: "Duel a friend to start a rivalry",
    noDuels: "No duels yet",
  },
```
es: label "Tu rival", youLead "Ganas {w}–{l}", youTrail "Pierdes {w}–{l}", even "Empate {w}–{l}", wonStreak "{n} victorias seguidas", lostStreak "{n} derrotas seguidas", lastWon "les ganaste {when}", lastLost "perdiste con ellos {when}", settle "Salda cuentas", startRivalry "Reta a un amigo para empezar una rivalidad", noDuels "Sin duelos aún".
tr: label "Rakibin", youLead "Öndesin {w}–{l}", youTrail "Gerridesin {w}–{l}", even "Berabere {w}–{l}", wonStreak "üst üste {n} galibiyet", lostStreak "üst üste {n} mağlubiyet", lastWon "onları yendin {when}", lastLost "onlara kaybettin {when}", settle "Hesabı kapat", startRivalry "Bir rivaliteye başlamak için bir arkadaşına meydan oku", noDuels "Henüz düello yok". Keep copy §7-safe.

- [ ] **Step 3: typecheck** `cd frontend && npm run typecheck` → clean.
- [ ] **Step 4: Do NOT commit.** Report.

---

### Task 4: `RivalCard` + Friends screen enrichment

**Files:** Create `frontend/src/screens/friends/RivalCard.tsx` + `.test.tsx`; Modify `frontend/src/screens/friends/FriendsScreen.tsx`.

- [ ] **Step 1: Failing test** `frontend/src/screens/friends/RivalCard.test.tsx`:
```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Friend } from "@/api/client";
import { RivalCard } from "./RivalCard";

const rival: Friend = {
  user_id: "r1", username: "ava", avatar_preset: "ninja", wins: 3, losses: 1,
  streak: 3, last_result: "won", last_played: new Date().toISOString(), duels_14d: 4,
};

describe("RivalCard", () => {
  afterEach(() => cleanup());

  it("shows the rival record, streak, and a settle-the-score button", () => {
    const onSettle = vi.fn();
    render(<RivalCard rival={rival} onSettle={onSettle} />);
    expect(screen.getByText("ava")).toBeTruthy();
    expect(screen.getByText(/You lead 3.1/)).toBeTruthy();
    expect(screen.getByText(/won 3 straight/)).toBeTruthy();
    screen.getByRole("button", { name: /settle the score/i }).click();
    expect(onSettle).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL:** `cd frontend && npx vitest run src/screens/friends/RivalCard.test.tsx`

- [ ] **Step 3: Implement** `frontend/src/screens/friends/RivalCard.tsx`:
```tsx
import type { Friend } from "@/api/client";
import { Avatar } from "@/screens/home/Avatar";
import { fmt, useT } from "@/i18n/useT";

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 22,
  padding: 16,
  boxShadow: "0 14px 40px rgba(20, 16, 10, 0.06)",
  display: "flex",
  alignItems: "center",
  gap: 12,
};

function relative(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function RivalCard({ rival, onSettle }: { rival: Friend; onSettle: () => void }) {
  const t = useT();
  const rv = t.rivalry;
  const record =
    rival.wins > rival.losses
      ? fmt(rv.youLead, { w: rival.wins, l: rival.losses })
      : rival.wins < rival.losses
        ? fmt(rv.youTrail, { w: rival.wins, l: rival.losses })
        : fmt(rv.even, { w: rival.wins, l: rival.losses });
  const streakText =
    rival.streak > 0
      ? fmt(rv.wonStreak, { n: rival.streak })
      : rival.streak < 0
        ? fmt(rv.lostStreak, { n: -rival.streak })
        : "";
  const last =
    rival.last_result === "won"
      ? fmt(rv.lastWon, { when: relative(rival.last_played) })
      : rival.last_result === "lost"
        ? fmt(rv.lastLost, { when: relative(rival.last_played) })
        : "";
  return (
    <section style={card}>
      <Avatar size={44} preset={rival.avatar_preset} animated={false} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--brand)" }}>
          {rv.label}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginTop: 2 }}>{rival.username}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
          {record}
          {streakText && (
            <> · <span style={{ color: rival.streak > 0 ? "var(--lime)" : "var(--pink)", fontWeight: 700 }}>{streakText}</span></>
          )}
        </div>
        {last && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 1 }}>{last}</div>}
      </div>
      <button
        type="button"
        onClick={onSettle}
        style={{
          background: "transparent", color: "var(--text)",
          border: "1px solid color-mix(in srgb, var(--text) 55%, transparent)",
          borderRadius: 999, padding: "8px 16px", fontSize: 12.5, fontWeight: 700,
          fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        {rv.settle}
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Run, expect PASS:** `cd frontend && npx vitest run src/screens/friends/RivalCard.test.tsx`

- [ ] **Step 5: Mount in `FriendsScreen.tsx` + enrich rows.**
  - Import `RivalCard`. Just above the friends list `<section>`, render the rival when present:
    ```tsx
    {data?.rival_user_id && (() => {
      const rv = data.friends.find((f) => f.user_id === data.rival_user_id);
      return rv ? <RivalCard rival={rv} onSettle={() => challenge(rv)} /> : null;
    })()}
    ```
  - Enrich the row `sub` line to include the streak/last result. Replace the existing `sub={...}` on the friend `<Row>` with a small helper: record + a streak suffix, e.g.
    ```tsx
    sub={
      f.wins + f.losses > 0
        ? `${fmt(t.friends.record, { w: f.wins, l: f.losses })}${
            f.streak > 0 ? ` · ${fmt(t.rivalry.wonStreak, { n: f.streak })}` :
            f.streak < 0 ? ` · ${fmt(t.rivalry.lostStreak, { n: -f.streak })}` : ""
          }`
        : t.friends.noDuelsYet
    }
    ```
  - `challenge(f)` already exists in the file and starts a live duel — reuse it for `onSettle`.

- [ ] **Step 6: Full checks.** `cd frontend && npm run typecheck && npm run lint && npx vitest run src/screens/friends` (and update any FriendsScreen test that mocks `api.friends` — add the new fields `streak:0, last_result:null, last_played:null, duels_14d:0` to friend mocks and `rival_user_id:null` to the response mock so they don't break). Then the full guard: `cd frontend && npx vitest run && npm run build` and `cd backend && PYTHONIOENCODING=utf-8 uv run pytest -q && uv run ruff check app tests`.
- [ ] **Step 7: Do NOT commit.** Report final tallies.

---

## Self-review

**Spec coverage:**
- Rival highlight (record + streak + last result + Settle-the-score) → Task 4 `RivalCard`. ✓
- Rows/detail show streak + last result → Task 4 Step 5 (row `sub` enrichment). ✓
- Rival logic "hottest 14-day, recency tiebreak, 14-day fallback, none→null" → Task 1 `list_friends` rival pick (`max(duels_14d, last_played)`; empty→None). ✓
- Streak = signed consecutive run ending at latest → Task 1 `_rivalry_stats`. ✓
- Enrich `GET /friends` (per-friend fields + `rival_user_id`) → Tasks 1–2. ✓
- No new tables/migration; reuse challenge → Task 4 reuses `challenge()`/`createFriendDuel`. ✓
- States (no duels → no card + prompt; even/zero streak) → Task 4 (rival only when set; streak text omitted at 0) + i18n `startRivalry`/`noDuels`. ✓
- Only completed duels count; non-friends excluded → Task 1 (`status=='completed'`; rival candidates filtered to `accepted_ids`). ✓
- Copy honesty → Task 3 i18n (bragging-rights framing). ✓
- Tests backend + frontend → Tasks 1,2,4. ✓

**Placeholder scan:** The only non-literal bits are "find the existing `FriendOut(...)`/incoming mapping in `get_friends`" and "the friends list `<section>` anchor in FriendsScreen" — both name the exact file + the surrounding code to mirror; all new logic is literal. No TBD/"handle edge cases"/"similar to".

**Type consistency:** `FriendSummary` (Task 1: +streak/last_result/last_played/duels_14d) ↔ `FriendOut` (Task 2) ↔ `Friend` (Task 3) — identical field names. `FriendsList.rival_user_id` (Task 1) ↔ `FriendsResponse.rival_user_id` (Task 2) ↔ `FriendsResponse.rival_user_id` (Task 3). `RivalCard({rival: Friend, onSettle})` (Task 4) matches the `Friend` type + `challenge()`. `last_result` values `"won"|"lost"|null` consistent across service/schema/TS. ✓
