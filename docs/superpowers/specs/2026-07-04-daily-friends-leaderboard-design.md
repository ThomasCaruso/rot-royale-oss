# Daily Friends Leaderboard — "Friends today" on the Rot Report (Friends pillar 1)

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation plan
**Epic:** "Make friends mean more" — comradery + rivalry. This is pillar 1 (the keystone);
pillar 2 (living rivalries) and pillar 3 (cheers / celebrate growth) are separate specs.

## Goal

Make friends matter **every day**, not just when you happen to duel. After you finish today's
Daily Royale, the results screen shows how you placed **against your friends** who also played
today — a friends cut of the same event. Battle (ranked placement + a hook to pull in friends who
haven't played) and comradery (shared daily ritual) in one compact surface.

## Non-negotiable: visual restraint

The Rot Report is already dense (score, funny title, stat chips, pending-placement strip, share
CTAs, nav). This board must feel like **one clean card that belongs to the premium card system**
(same language as the Your Growth redesign: soft `--panel` card, hairline border, generous padding,
thin rows, token-driven), **not** more noise. Hard rules:
- **One card, compact.** A short placement line + at most **3 ranked rows** + a single collapsed
  "yet to play" row. A `+N more` reveals the rest inline only on tap.
- No confetti, glow, gold, or heavy shadows. Calm. Reduced-motion-safe.
- If it can't be made to look clean in the Rot Report flow, it drops to a single **"Friends today ›"**
  link that opens the board as its own light overlay — never a cluttered stack.

## Locked decisions (from brainstorming)

1. **Placement:** post-run on the **Rot Report**, live all day (entry-based, updates as friends
   play). Re-openable from Home's completed Daily card via a "Friends today ›" affordance.
2. **Board makeup:** **Played (ranked)** friends + me, then **Yet to play** friends each with a
   one-tap **Challenge** that reuses the existing live-duel flow (`api.createFriendDuel(username)`).
   No new nudge/push system.
3. **Fairness-safe:** a friends *filter* on existing entries — no re-scoring; ranked stays globally
   fair (`PERSONALIZE_RANKED_DAILY` untouched). Entries are seeded-different per player, so a
   friend's score is never a spoiler.

## 1. Backend — one endpoint, reuses existing data

`GET /contests/{window_id}/friends` (authed) →
```json
{
  "my_rank": 2,
  "friend_field_size": 5,
  "played": [
    { "user_id": "…", "username": "maya", "avatar_preset": "…", "equipped_frame": "…",
      "score": 940, "rank": 1, "is_me": false },
    { "user_id": "…", "username": "you", "…": "…", "score": 900, "rank": 2, "is_me": true }
  ],
  "yet_to_play": [ { "user_id": "…", "username": "sam", "avatar_preset": "…" } ]
}
```

- **Source:** accepted-friend user_ids (`services/friends`) ∪ {me} → the window's **SUBMITTED**
  entries for that set, ordered `score desc, avg time_frac asc` (the exact settlement ordering,
  reused). `rank` is dense over that friend subset. `yet_to_play` = accepted friends with no
  submitted entry for this window. Profile fields (`username`, `avatar_preset`, `equipped_frame`)
  joined for display.
- **`my_rank` / `friend_field_size`:** my rank among played friends and the count of played friends
  (incl. me). If I haven't submitted, `my_rank = null` (shouldn't happen — the board renders after my
  run — but handled).
- **Service:** `services/contest.friends_board(session, window_id, user_id)` (pure-ish query,
  entry-based so it works live pre-settlement and identical post-settlement). New Pydantic
  `FriendsBoardOut`. Route in `app/api/contest.py` next to `standings`/`window_field`.
- **Guests:** a guest friend with a submitted entry still appears (the board is entry-based and
  informational, not ranked permanence). Accepted edge; no special-casing.
- **Honesty (DESIGN §7):** real entries + real friends only; no fabricated counts; "friends"/"field"
  framing, never "N players".

## 2. Frontend — `FriendsTodayBoard`

- New `src/screens/results/FriendsTodayBoard.tsx`. Props: `windowId`. Fetches
  `api.friendsBoard(windowId)` on mount; re-fetches when reopened.
- **Layout (compact):**
  - Label `FRIENDS TODAY` (the growth-card uppercase label style).
  - **Placement line:** `#2 of 5 · +40 on {next below} · −30 to {next above}` (adapts: leader →
    "You're on top · +40 clear"; nobody below → just the chasing gap).
  - **Up to 3 ranked rows:** `rank · avatar · name · score`, **me highlighted** (brand tint). If
    more than 3 played, the row containing *me* is always shown; a `+N more` toggles the full list
    inline.
  - **Yet to play:** one collapsed row — `{a}, {b} haven't played · Challenge` (Challenge on the
    first, or a small "Challenge" per name when expanded). Uses `api.createFriendDuel(username)` and
    routes into the existing friend-duel pending/accept flow.
- **Reuse** the avatar/frame renderer + row styling already in `FriendsScreen` (don't re-roll).
- **Placement in `RotReport.tsx`:** inserted as one card in the results stack, replacing/absorbing
  the standalone pending-placement strip area (the friends placement is the *immediate* social
  placement; the global "placement pending at {time}" line stays as a small sub-line inside or just
  below this card — not a second big block).
- **Home reopen:** the completed-Daily state (`Home.tsx` played branch) gets a small
  `Friends today ›` text affordance that opens `FriendsTodayBoard` for today's window (as a light
  overlay/sheet, mirroring how other overlays open in `App.tsx`). Small, optional, non-cluttering.

## 3. States (real data only)

- **No friends:** compact invite — "Add friends to race them every day" → opens the Friends screen.
- **Friends, none played yet:** "No one's played yet — set the pace." + the yet-to-play Challenge
  list.
- **I lead / I'm chasing:** the placement line adapts (leader vs mid vs last).
- **Load error:** the card silently omits itself (best-effort; never blocks the Rot Report). Loading:
  a slim skeleton or nothing until data.

## 4. Testing

**Backend** (`tests/test_contest_api.py` or a new `tests/test_friends_board.py`):
- returns only my accepted friends + me; excludes non-friends and un-submitted entries from `played`.
- ordering = score desc then avg time_frac asc; dense ranks; `my_rank`/`friend_field_size` correct.
- `yet_to_play` = accepted friends with no submitted entry; empty-friends → empty lists.
- pending friend requests are NOT treated as friends.

**Frontend** (`FriendsTodayBoard.test.tsx`):
- renders ranked rows with me highlighted + the placement/gap line from a mocked board.
- `+N more` reveals the rest; yet-to-play Challenge calls `createFriendDuel`.
- no-friends and none-played empty states.
- `RotReport.test.tsx`: the board mounts in the results flow without breaking existing assertions.

## 5. Scope guardrail (what this is NOT)

Just this board + endpoint + the Home reopen link. **Not** in scope: rivalries/H2H surfacing
(pillar 2), cheers / celebrate-growth (pillar 3), any nudge/push system (Challenge reuses live
duels), feed/chat/DMs (§5b). No change to settlement, Elo, coins, or ranked fairness. No new
question content.

## 6. Risks

- **Clutter** — mitigated by the "one compact card, ≤3 rows, collapse the rest" rule and the
  fallback to a `Friends today ›` link if it can't be made clean.
- **Live vs settled numbers** — the board is entry-based (`total_score` on the submitted entry),
  which equals the settled score, so pre- and post-settlement views agree; no dual mode.
- **Small friend fields** — the yet-to-play + invite states keep it from feeling empty.
