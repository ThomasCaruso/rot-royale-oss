# Daily Friends Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Commits are DEFERRED this session** — do the implement + test steps, but do NOT run `git commit`/`git add`/branch. Version control is handled at the end.

**Goal:** After finishing today's Daily Royale, show a compact "Friends today" board on the Rot Report — friends ranked by today's score with you highlighted, plus yet-to-play friends with a one-tap Challenge.

**Architecture:** One authed endpoint `GET /contests/{window_id}/friends` returns a friends *filter* of the window's SUBMITTED entries (reusing the settlement ordering) + the friends who haven't played. A single compact `FriendsTodayBoard` card renders it in the Rot Report and is re-openable from Home. No re-scoring, no new push system (Challenge reuses live duels), no ranked-fairness change.

**Tech Stack:** FastAPI + SQLAlchemy async; React/TS + Vitest. Spec: `docs/superpowers/specs/2026-07-04-daily-friends-leaderboard-design.md`.

## Reference facts (verified)

- `app/services/friends.py::list_friends(session, user_id) -> FriendsList` → `.friends` is `list[FriendSummary(user_id, username, avatar_preset, wins, losses)]` (accepted only). `.incoming`/`.outgoing` are pending — NOT friends.
- Settlement ordering (`app/services/settlement.py`): `sort(key=lambda r: (-total_score, -avg_time_frac))` — score desc, then faster (higher) avg `time_frac`. Per-entry avg = `select(RoundResult.entry_id, func.avg(RoundResult.time_frac)).group_by(RoundResult.entry_id)`.
- `app/models/contest.py`: `Entry(window_id nullable, user_id, status, total_score nullable, submitted_at)`; `SUBMITTED = "SUBMITTED"`. `RoundResult(entry_id, time_frac, ...)`.
- `app/models/profile.py::Profile(user_id PK, username, avatar_preset, equipped_frame nullable)`.
- Contest routes live in `app/api/contests.py` (router prefix `/contests`; deps `get_current_user`, `get_session`). Contest schemas live alongside (find `StandingsOut` — same module).
- Frontend: `RotReport.tsx` renders `RotReportFinish` with `windowId={entry.window_id}`. Avatar = `import { Avatar } from "@/screens/home/Avatar"` → `<Avatar size={40} preset={avatar_preset} animated={false} />`. Challenge = `api.createFriendDuel(username)`. Home fetches `api.currentContest()` → the active window id.
- Tests: backend async rolled-back (`db_session`/`client`), run `cd backend && uv run pytest` (prefix `PYTHONIOENCODING=utf-8`). Frontend `cd frontend && npx vitest run` / `npm run typecheck` / `npm run lint`. Vitest needs explicit `afterEach(cleanup)` (no auto-cleanup).

## File structure

| File | Responsibility | Change |
|---|---|---|
| `backend/app/services/contest.py` | `friends_board(...)` + dataclasses | Modify |
| `backend/app/schemas/<contest schema module>` | `FriendsBoardOut` + row models | Modify |
| `backend/app/api/contests.py` | `GET /{window_id}/friends` route | Modify |
| `backend/tests/test_friends_board.py` | service + API tests | Create |
| `frontend/src/api/client.ts` | `friendsBoard` + types | Modify |
| `frontend/src/i18n/{en,es,tr}.ts` | `friendsToday` copy group | Modify |
| `frontend/src/screens/results/FriendsTodayBoard.tsx` | the compact board card | Create |
| `frontend/src/screens/results/FriendsTodayBoard.test.tsx` | board tests | Create |
| `frontend/src/screens/results/RotReport.tsx` | mount the board (absorb pending strip) | Modify |
| `frontend/src/screens/Home.tsx` | "Friends today ›" reopen (modal) | Modify |

---

### Task 1: `friends_board` service

**Files:** Modify `backend/app/services/contest.py`; Test `backend/tests/test_friends_board.py` (new).

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_friends_board.py`. It builds an OPEN window, three users who are pairwise-friended with the "me" user, submits entries with different scores, and asserts the board ranks correctly and lists a non-player under `yet_to_play`. Reuse patterns from `tests/test_friend_duel.py` (friend accept) and `tests/test_contest_api.py` (`_open_window`, entering, answering). Concretely:

```python
"""Daily friends leaderboard — the friends cut of a window's submitted entries."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Entry, Profile, RoundResult, User
from app.models.contest import OPEN, SUBMITTED, ContestWindow
from app.services.contest import friends_board
from app.services.friends import send_friend_request

pytestmark = pytest.mark.asyncio


async def _user(session: AsyncSession, name: str) -> User:
    u = User(email=f"{name}-{uuid.uuid4().hex[:6]}@example.com", password_hash="x")
    session.add(u)
    await session.flush()
    session.add(Profile(user_id=u.id, username=f"{name}{uuid.uuid4().hex[:4]}", division="bronze"))
    await session.flush()
    return u


async def _befriend(session: AsyncSession, a: User, b: User) -> None:
    # a invites b, b invites a back → auto-accepts to 'accepted'
    bp = (await session.get(Profile, b.id))
    ap = (await session.get(Profile, a.id))
    await send_friend_request(session, a.id, bp.username)
    await send_friend_request(session, b.id, ap.username)


async def _submit_entry(session: AsyncSession, window, user: User, score: int) -> Entry:
    from datetime import UTC, datetime

    e = Entry(
        window_id=window.id, user_id=user.id, is_practice=False, seed=1, round_set=[],
        started_at=datetime.now(UTC), submitted_at=datetime.now(UTC),
        total_score=score, status=SUBMITTED,
    )
    session.add(e)
    await session.flush()
    session.add(RoundResult(entry_id=e.id, idx=0, module_type="trivia", points=score,
                            correct=True, time_frac=0.5, valid=True, flags=[]))
    await session.flush()
    return e


async def _open_window(session: AsyncSession) -> ContestWindow:
    from datetime import UTC, datetime, timedelta

    now = datetime.now(UTC)
    w = ContestWindow(
        contest_date=now.date(), slot="royale", template_id="dr_8_trivia", state=OPEN,
        open_at=now - timedelta(hours=1), close_at=now + timedelta(hours=1),
        settle_at=now + timedelta(hours=1, minutes=15),
    )
    session.add(w)
    await session.flush()
    return w


async def test_friends_board_ranks_and_lists_yet_to_play(db_session: AsyncSession) -> None:
    me = await _user(db_session, "me")
    alice = await _user(db_session, "alice")
    bob = await _user(db_session, "bob")
    carol = await _user(db_session, "carol")  # friend who has NOT played
    for f in (alice, bob, carol):
        await _befriend(db_session, me, f)

    window = await _open_window(db_session)
    await _submit_entry(db_session, window, me, 900)
    await _submit_entry(db_session, window, alice, 940)
    await _submit_entry(db_session, window, bob, 800)

    board = await friends_board(db_session, window.id, me.id)

    assert [r.score for r in board.played] == [940, 900, 800]  # ranked desc
    assert [r.rank for r in board.played] == [1, 2, 3]
    assert board.my_rank == 2
    assert board.friend_field_size == 3
    assert next(r for r in board.played if r.is_me).score == 900
    assert {y.user_id for y in board.yet_to_play} == {carol.id}


async def test_friends_board_excludes_non_friends(db_session: AsyncSession) -> None:
    me = await _user(db_session, "me")
    stranger = await _user(db_session, "stranger")  # not friended
    window = await _open_window(db_session)
    await _submit_entry(db_session, window, me, 500)
    await _submit_entry(db_session, window, stranger, 999)

    board = await friends_board(db_session, window.id, me.id)
    assert [r.user_id for r in board.played] == [me.id]  # stranger absent
    assert board.yet_to_play == []
```

Adjust `Profile(...)` / `ContestWindow(...)` kwargs to the real required columns (check the models — e.g. `division` may be required, `equipped_frame` optional). If `send_friend_request` signature differs, mirror `tests/test_friend_duel.py`.

- [ ] **Step 2: Run, expect FAIL** (`cannot import name 'friends_board'`):
`cd backend && uv run pytest tests/test_friends_board.py -v`

- [ ] **Step 3: Implement.** In `backend/app/services/contest.py` add (near the other read helpers; ensure imports include `from dataclasses import dataclass`, `func`, `Profile`, `RoundResult`, `SUBMITTED`, and `from app.services.friends import list_friends`):

```python
@dataclass
class FriendBoardRow:
    user_id: uuid.UUID
    username: str
    avatar_preset: str
    equipped_frame: str | None
    score: int
    rank: int
    is_me: bool


@dataclass
class FriendBoardPending:
    user_id: uuid.UUID
    username: str
    avatar_preset: str


@dataclass
class FriendsBoardData:
    my_rank: int | None
    friend_field_size: int
    played: list[FriendBoardRow]
    yet_to_play: list[FriendBoardPending]


async def friends_board(
    session: AsyncSession, window_id: uuid.UUID, user_id: uuid.UUID
) -> FriendsBoardData:
    """Friends cut of a window's SUBMITTED entries: accepted friends + me, ranked by the settlement
    ordering (score desc, faster avg time_frac). Entry-based so it's live pre-settlement and equal
    after. A filter on existing entries — never a re-score."""
    friends = (await list_friends(session, user_id)).friends
    id_set: set[uuid.UUID] = {f.user_id for f in friends} | {user_id}

    entries = list(
        (
            await session.execute(
                select(Entry).where(
                    Entry.window_id == window_id,
                    Entry.user_id.in_(id_set),
                    Entry.status == SUBMITTED,
                )
            )
        ).scalars().all()
    )

    avg_by_entry: dict[uuid.UUID, float] = {}
    if entries:
        rows = (
            await session.execute(
                select(RoundResult.entry_id, func.avg(RoundResult.time_frac))
                .where(RoundResult.entry_id.in_([e.id for e in entries]))
                .group_by(RoundResult.entry_id)
            )
        ).all()
        avg_by_entry = {r[0]: float(r[1]) for r in rows}

    ranked = sorted(entries, key=lambda e: (-(e.total_score or 0), -avg_by_entry.get(e.id, 0.0)))
    profiles = {
        p.user_id: p
        for p in (
            await session.execute(select(Profile).where(Profile.user_id.in_(id_set)))
        ).scalars().all()
    }

    played: list[FriendBoardRow] = []
    for i, e in enumerate(ranked):
        p = profiles.get(e.user_id)
        if p is None:
            continue
        played.append(
            FriendBoardRow(
                user_id=e.user_id,
                username=p.username,
                avatar_preset=p.avatar_preset,
                equipped_frame=p.equipped_frame,
                score=e.total_score or 0,
                rank=i + 1,
                is_me=e.user_id == user_id,
            )
        )

    played_ids = {e.user_id for e in entries}
    yet = [
        FriendBoardPending(f.user_id, f.username, f.avatar_preset)
        for f in friends
        if f.user_id not in played_ids
    ]
    my_rank = next((r.rank for r in played if r.is_me), None)
    return FriendsBoardData(
        my_rank=my_rank, friend_field_size=len(played), played=played, yet_to_play=yet
    )
```

- [ ] **Step 4: Run, expect PASS:** `cd backend && uv run pytest tests/test_friends_board.py -v`. Ruff: `cd backend && uv run ruff check app/services/contest.py tests/test_friends_board.py`.
- [ ] **Step 5: Do NOT commit.** Report.

---

### Task 2: Schema + `GET /contests/{window_id}/friends`

**Files:** Modify the contest schema module (where `StandingsOut` lives — find via `grep -rn "class StandingsOut" backend/app/schemas`), `backend/app/api/contests.py`; Test `backend/tests/test_friends_board.py`.

- [ ] **Step 1: Add a failing API test** to `backend/tests/test_friends_board.py` (uses the `client` fixture; register users via `/auth/register`, friend them via `/friends/requests`, enter+submit the window via the API like `tests/test_contest_api.py`). Minimal shape assertion:

```python
from httpx import AsyncClient


async def test_friends_board_endpoint_shape(client: AsyncClient, db_session: AsyncSession) -> None:
    r = await client.post(
        "/auth/register",
        json={"email": f"{uuid.uuid4().hex[:8]}@example.com", "username": f"me{uuid.uuid4().hex[:5]}",
              "password": "super-secret-pw"},
    )
    token = r.json()["access_token"]
    window = await _open_window(db_session)
    resp = await client.get(
        f"/contests/{window.id}/friends", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"my_rank", "friend_field_size", "played", "yet_to_play"}
```

- [ ] **Step 2: Run, expect FAIL** (404): `cd backend && uv run pytest tests/test_friends_board.py::test_friends_board_endpoint_shape -v`

- [ ] **Step 3: Add the schema.** In the contest schema module add:

```python
class FriendBoardRowOut(BaseModel):
    user_id: uuid.UUID
    username: str
    avatar_preset: str
    equipped_frame: str | None
    score: int
    rank: int
    is_me: bool


class FriendBoardPendingOut(BaseModel):
    user_id: uuid.UUID
    username: str
    avatar_preset: str


class FriendsBoardOut(BaseModel):
    my_rank: int | None
    friend_field_size: int
    played: list[FriendBoardRowOut]
    yet_to_play: list[FriendBoardPendingOut]
```

- [ ] **Step 4: Add the route** in `backend/app/api/contests.py` (match the existing `/{window_id}/standings` route's deps + style; import `friends_board` from `app.services.contest` and `FriendsBoardOut`):

```python
@router.get("/{window_id}/friends", response_model=FriendsBoardOut)
async def friends_board_route(
    window_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FriendsBoardOut:
    board = await friends_board(session, window_id, user.id)
    return FriendsBoardOut(
        my_rank=board.my_rank,
        friend_field_size=board.friend_field_size,
        played=[FriendBoardRowOut(**vars(r)) for r in board.played],
        yet_to_play=[FriendBoardPendingOut(**vars(p)) for p in board.yet_to_play],
    )
```

- [ ] **Step 5: Run, expect PASS:** `cd backend && uv run pytest tests/test_friends_board.py -v`. Ruff the two changed files. Also `cd backend && uv run pytest tests/test_contest_api.py -q` (no route regressions).
- [ ] **Step 6: Do NOT commit.** Report.

---

### Task 3: Frontend API client + i18n copy

**Files:** Modify `frontend/src/api/client.ts`, `frontend/src/i18n/{en,es,tr}.ts`.

- [ ] **Step 1: Types + method** in `client.ts` (near the friends/contest types):

```ts
export interface FriendsBoardRow {
  user_id: string;
  username: string;
  avatar_preset: string;
  equipped_frame: string | null;
  score: number;
  rank: number;
  is_me: boolean;
}
export interface FriendsBoardPending {
  user_id: string;
  username: string;
  avatar_preset: string;
}
export interface FriendsBoardResponse {
  my_rank: number | null;
  friend_field_size: number;
  played: FriendsBoardRow[];
  yet_to_play: FriendsBoardPending[];
}
```
And in the `api` object: `friendsBoard: (windowId: string) => authedRequest<FriendsBoardResponse>(\`/contests/${windowId}/friends\`),`

- [ ] **Step 2: i18n** — add a `friendsToday` group to `en.ts` (and mirror in es/tr):
```ts
  friendsToday: {
    title: "Friends today",
    placement: "#{rank} of {n}",
    onTop: "You're on top",
    ahead: "+{gap} on {name}",
    behind: "{gap} to {name}",
    nonePlayed: "No one's played yet — set the pace.",
    yetToPlay: "Yet to play",
    more: "+{n} more",
    noFriends: "Add friends to race them every day",
  },
```
es (mirror, translate): `title:"Amigos hoy"`, `placement:"#{rank} de {n}"`, `onTop:"Vas en cabeza"`, `ahead:"+{gap} sobre {name}"`, `behind:"{gap} para {name}"`, `nonePlayed:"Nadie ha jugado aún — marca el ritmo."`, `yetToPlay:"Aún sin jugar"`, `more:"+{n} más"`, `noFriends:"Añade amigos para competir cada día"`.
tr (mirror): `title:"Bugün arkadaşlar"`, `placement:"{n} içinde #{rank}"`, `onTop:"Zirvedesin"`, `ahead:"{name} önünde +{gap}"`, `behind:"{name} için {gap}"`, `nonePlayed:"Henüz kimse oynamadı — tempoyu sen belirle."`, `yetToPlay:"Henüz oynamadı"`, `more:"+{n} daha"`, `noFriends:"Her gün yarışmak için arkadaş ekle"`.

- [ ] **Step 3: typecheck** `cd frontend && npm run typecheck` → clean.
- [ ] **Step 4: Do NOT commit.** Report.

---

### Task 4: `FriendsTodayBoard` component

**Files:** Create `frontend/src/screens/results/FriendsTodayBoard.tsx` + `.test.tsx`.

- [ ] **Step 1: Write the failing test** `frontend/src/screens/results/FriendsTodayBoard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { FriendsTodayBoard } from "./FriendsTodayBoard";

vi.mock("@/api/client", () => ({
  api: { friendsBoard: vi.fn(), createFriendDuel: vi.fn(async () => ({})) },
}));

const BOARD = {
  my_rank: 2,
  friend_field_size: 3,
  played: [
    { user_id: "a", username: "maya", avatar_preset: "p1", equipped_frame: null, score: 940, rank: 1, is_me: false },
    { user_id: "me", username: "you", avatar_preset: "p2", equipped_frame: null, score: 900, rank: 2, is_me: true },
    { user_id: "b", username: "sam", avatar_preset: "p3", equipped_frame: null, score: 800, rank: 3, is_me: false },
  ],
  yet_to_play: [{ user_id: "c", username: "jordan", avatar_preset: "p4" }],
};

describe("FriendsTodayBoard", () => {
  afterEach(() => cleanup());

  it("renders ranked friends with me highlighted + a yet-to-play challenge", async () => {
    vi.mocked(api.friendsBoard).mockResolvedValue(BOARD as never);
    render(<FriendsTodayBoard windowId="w1" />);
    await waitFor(() => expect(screen.getByText("maya")).toBeTruthy());
    expect(screen.getByText("940")).toBeTruthy();
    expect(screen.getByText(/jordan/)).toBeTruthy();
    // challenge the yet-to-play friend
    screen.getByRole("button", { name: /challenge/i }).click();
    await waitFor(() => expect(api.createFriendDuel).toHaveBeenCalledWith("jordan"));
  });

  it("renders the no-friends invite when the board is empty", async () => {
    vi.mocked(api.friendsBoard).mockResolvedValue({
      my_rank: null, friend_field_size: 0, played: [], yet_to_play: [],
    } as never);
    render(<FriendsTodayBoard windowId="w1" />);
    await waitFor(() => expect(screen.getByText(/Add friends to race them/)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing): `cd frontend && npx vitest run src/screens/results/FriendsTodayBoard.test.tsx`

- [ ] **Step 3: Implement** `frontend/src/screens/results/FriendsTodayBoard.tsx`. A single compact card (reuse the Growth card look via tokens; ≤3 rows always including me, `+N more` to expand, one collapsed yet-to-play row with Challenge). Keep it calm — no gold/glow/confetti.

```tsx
import { useEffect, useState } from "react";
import { api, type FriendsBoardResponse } from "@/api/client";
import { Avatar } from "@/screens/home/Avatar";
import { useT } from "@/i18n/useT";

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 22,
  padding: 18,
  boxShadow: "0 14px 40px rgba(20, 16, 10, 0.06)",
};

function fmt(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

export function FriendsTodayBoard({ windowId }: { windowId: string }) {
  const t = useT();
  const ft = t.friendsToday;
  const [board, setBoard] = useState<FriendsBoardResponse | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [challenged, setChallenged] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    api
      .friendsBoard(windowId)
      .then((b) => alive && setBoard(b))
      .catch(() => {
        /* best-effort; the board just omits itself */
      });
    return () => {
      alive = false;
    };
  }, [windowId]);

  if (!board) return null;
  const { played, yet_to_play, my_rank, friend_field_size } = board;

  if (played.length === 0 && yet_to_play.length === 0) {
    return (
      <section style={card}>
        <Label>{ft.title}</Label>
        <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>{ft.noFriends}</div>
      </section>
    );
  }

  // Show top rows but always keep "me" visible; +N more expands.
  const meIdx = played.findIndex((r) => r.is_me);
  const visible = expanded
    ? played
    : played.slice(0, Math.max(3, meIdx + 1)).slice(0, meIdx >= 3 ? meIdx + 1 : 3);
  const hidden = played.length - visible.length;

  const meRow = played[meIdx];
  const ahead = meIdx > 0 ? played[meIdx - 1] : null;
  const below = meIdx >= 0 && meIdx < played.length - 1 ? played[meIdx + 1] : null;

  async function challenge(username: string) {
    setChallenged((s) => new Set(s).add(username));
    try {
      await api.createFriendDuel(username);
    } catch {
      /* surfaced elsewhere; keep the board calm */
    }
  }

  return (
    <section style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Label>{ft.title}</Label>
        {my_rank != null && (
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>
            {fmt(ft.placement, { rank: my_rank, n: friend_field_size })}
          </span>
        )}
      </div>

      {meRow &&
        (meRow.rank === 1 ? (
          <div style={{ fontSize: 13, color: "var(--lime)", fontWeight: 600, marginTop: 4 }}>
            {ft.onTop}
            {below && ` · ${fmt(ft.ahead, { gap: meRow.score - below.score, name: below.username })}`}
          </div>
        ) : ahead ? (
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
            {fmt(ft.behind, { gap: `−${ahead.score - meRow.score}`, name: ahead.username })}
          </div>
        ) : played.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{ft.nonePlayed}</div>
        ) : null)}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {visible.map((r) => (
          <div key={r.user_id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 18, fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>
              {r.rank}
            </span>
            <Avatar size={32} preset={r.avatar_preset} animated={false} />
            <span
              style={{
                flex: 1,
                fontSize: 14,
                fontWeight: r.is_me ? 800 : 600,
                color: r.is_me ? "var(--brand)" : "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {r.username}
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
              {r.score}
            </span>
          </div>
        ))}
        {hidden > 0 && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{ alignSelf: "flex-start", background: "none", border: "none", color: "var(--brand)", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "2px 0" }}
          >
            {fmt(ft.more, { n: hidden })}
          </button>
        )}
      </div>

      {yet_to_play.length > 0 && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <Label>{ft.yetToPlay}</Label>
          {yet_to_play.map((p) => (
            <div key={p.user_id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar size={28} preset={p.avatar_preset} animated={false} />
              <span style={{ flex: 1, fontSize: 13.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {p.username}
              </span>
              <button
                type="button"
                onClick={() => challenge(p.username)}
                disabled={challenged.has(p.username)}
                style={{ background: "color-mix(in srgb, var(--brand) 12%, transparent)", color: "var(--brand)", border: "none", borderRadius: 999, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: challenged.has(p.username) ? 0.5 : 1 }}
              >
                {t.friends.challenge}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--brand)" }}>
      {children}
    </div>
  );
}
```
Confirm `t.friends.challenge` exists (it does — the FriendsScreen challenge label). If `Avatar`'s prop names differ, match `@/screens/home/Avatar`.

- [ ] **Step 4: Run, expect PASS:** `cd frontend && npx vitest run src/screens/results/FriendsTodayBoard.test.tsx`. Then `npm run typecheck` + `npm run lint` (fix any react-refresh/only-export-components warning by keeping only the component exported — `Label`/`card`/`fmt` are module-local, fine).
- [ ] **Step 5: Do NOT commit.** Report.

---

### Task 5: Mount in the Rot Report (absorb the pending strip)

**Files:** Modify `frontend/src/screens/results/RotReport.tsx`; Test `frontend/src/screens/results/RotReport.test.tsx`.

- [ ] **Step 1:** In `RotReport.tsx`, inside `RotReportFinish` (which has `windowId`), render `<FriendsTodayBoard windowId={windowId} />` as ONE card in the results stack, placed where the "Daily placement pending" strip is. Keep the global "settles at {time}" as a small sub-line (don't leave two big blocks). Import: `import { FriendsTodayBoard } from "./FriendsTodayBoard";`. Do not restructure the rest of the report.

- [ ] **Step 2:** Update `RotReport.test.tsx` if it mocks `@/api/client` — add `friendsBoard: vi.fn(async () => ({ my_rank: null, friend_field_size: 0, played: [], yet_to_play: [] }))` and `createFriendDuel: vi.fn()` to the mock so the board mounts without error. Keep existing assertions.

- [ ] **Step 3: Run:** `cd frontend && npx vitest run src/screens/results && npm run typecheck && npm run lint`. Expect PASS/clean.
- [ ] **Step 4: Do NOT commit.** Report.

---

### Task 6: Home "Friends today ›" reopen + full-suite guard

**Files:** Modify `frontend/src/screens/Home.tsx`; run full suites.

- [ ] **Step 1:** On the completed-Daily state in `Home.tsx` (the `playedToday` branch — where "Completed today ✓" shows), add a small `Friends today ›` text button. It opens a lightweight modal (local `useState`) that renders `<FriendsTodayBoard windowId={activeWindowId} />` centered over a scrim. Get `activeWindowId` from the already-fetched current contest (the same value used for the Daily card). Keep it minimal — a self-contained modal in Home, no `App.tsx` overlay plumbing. Import `FriendsTodayBoard` + reuse any existing modal/scrim pattern in the file; if none, a simple fixed-position scrim + centered card + a close on backdrop click.

- [ ] **Step 2:** If a Home test (`Home.flow.test.tsx`) mocks `@/api/client`, add `friendsBoard`/`createFriendDuel` mocks so nothing throws. Add `onGrowth`-style props only if needed (the modal is internal, so likely no new prop).

- [ ] **Step 3: Full frontend suite:** `cd frontend && npm run typecheck && npm run lint && npx vitest run && npm run build` → all green.
- [ ] **Step 4: Full backend suite:** `cd backend && PYTHONIOENCODING=utf-8 uv run pytest -q` → all pass; `uv run ruff check app tests` → clean.
- [ ] **Step 5: Do NOT commit.** Report final tallies.

---

## Self-review

**Spec coverage:**
- Endpoint `GET /contests/{window_id}/friends` (friends filter, settlement ordering, yet_to_play) → Tasks 1–2. ✓
- `FriendsTodayBoard` compact card (≤3 rows + `+N more`, me highlighted, placement/gap line, yet-to-play Challenge reusing `createFriendDuel`) → Task 4. ✓
- Visual restraint (one calm token-driven card, no gold/glow) → Task 4 card style + compact layout. ✓
- Mounted on Rot Report, absorbing the pending strip → Task 5. ✓
- Home reopen "Friends today ›" → Task 6. ✓
- States: no-friends invite, none-played, lead/chasing → Task 4 (tested empty + ranked). ✓
- Fairness-safe (filter, not re-score; ranked untouched) → Task 1 (entry-based read only). ✓
- Honesty (real entries/friends) → Task 1 (SUBMITTED entries + accepted friends only; non-friend-exclusion tested). ✓
- Testing backend + frontend → Tasks 1,2,4,5,6. ✓

**Placeholder scan:** The schema-module path and the RotReport insertion point are "find the existing X" pointers (StandingsOut module; the pending-strip location) with the exact grep/anchor named — the new logic is fully literal. No TBD/"handle edge cases"/"similar to".

**Type consistency:** `FriendsBoardData{my_rank, friend_field_size, played[FriendBoardRow], yet_to_play[FriendBoardPending]}` (Task 1) ↔ `FriendsBoardOut` (Task 2) ↔ `FriendsBoardResponse` (Task 3) ↔ component props (Task 4) — field names identical (`my_rank`, `friend_field_size`, `played`, `yet_to_play`, and row `user_id/username/avatar_preset/equipped_frame/score/rank/is_me`). `friendsBoard(windowId)` (Task 3) matches the route (Task 2). `createFriendDuel(username)` reused (Task 4). ✓
