# Living Rivalries — the Friends screen's rivalry layer (Friends pillar 2)

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation plan
**Epic:** "Make friends mean more" — comradery + rivalry. Pillar 1 (daily friends leaderboard) is
built; this is pillar 2 (the battle/rivalry side). Pillar 3 (support/cheers) is a separate spec.

## Goal

Turn the head-to-head duel record — which today is a static "7W 5L" buried on a per-friend detail
page — into a **living rivalry**: an ongoing story with streaks, last results, and a surfaced
"Rival" you're actively battling, so friends become a reason to return (an unfinished score to
settle).

## Locked decisions (from brainstorming)

1. **Placement:** the **Friends screen** (not a Home card, not the duel result). A "Rival" highlight
   pinned at the top + living data (streak + last result) on every friend row and the detail page.
2. **Rival logic — "hottest right now":** rival = the friend with the **most completed duels in the
   last 14 days** (tie → most recent). If none in 14 days → the **most-recently-dueled** friend
   overall. If you've never completed a duel → no rival.
3. **Reuses the existing challenge flow** ("Settle the score" = `api.createFriendDuel(username)`).
   No new duel system, no new tables.

## What exists today (build on it)

- `app/services/friends.py::_head_to_head(session, user_id) -> dict[opponent_id, (wins, losses)]` —
  aggregate W–L from COMPLETED `friend_duels` (walks `winner_side` vs the user's side).
- `list_friends(...)` → `FriendsList(friends=[FriendSummary(user_id, username, avatar_preset, wins,
  losses)], incoming, outgoing)`; surfaced via `GET /friends` (`FriendsResponse`).
- `friend_duels` rows carry `challenger_id`, `opponent_id`, `status`, `winner_side`
  (`challenger|opponent`), `completed_at`, `created_at`.
- `FriendsScreen.tsx`: friend rows (record line) + a per-friend detail page + challenge buttons
  (now slim black-outline). `api.createFriendDuel(username)`.

## 1. Backend — enrich the friends endpoint (DRY, no new tables)

A new `app/services/rivalry.py` (or an extension of `friends.py`) computes, for each accepted
friend, from that pair's COMPLETED duels ordered by `completed_at`:

- **`streak`** — signed int: the count of consecutive same-outcome duels ending at the most recent.
  `+3` = won the last 3; `-2` = lost the last 2; `0` = no completed duels.
- **`last_result`** — `"won" | "lost" | null` (from the most recent completed duel's `winner_side`
  vs the user's side).
- **`last_played`** — the most recent `completed_at` (ISO), or null.
- **`duels_14d`** — count of that pair's completed duels with `completed_at >= now − 14 days`.

`wins`/`losses` stay as-is (from `_head_to_head`). **Rival selection:** among friends with ≥1
completed duel, pick `max(duels_14d, then last_played)`; if all `duels_14d == 0`, pick
`max(last_played)`; if no friend has any completed duel, `rival_user_id = null`.

**API:** `GET /friends` (`FriendsResponse`) gains, per friend in `friends[]`: `streak`,
`last_result`, `last_played`, `duels_14d`; and a top-level **`rival_user_id: uuid | null`**. One
call powers the whole screen. Computed from `friend_duels` — a read, no writes, no migration. The
extra work is bounded (the user's friend count is small); reuse a single query over the user's
completed duels grouped by opponent rather than N queries.

## 2. Frontend — `RivalCard` + row enrichment

- **`src/screens/friends/RivalCard.tsx`** — rendered at the top of `FriendsScreen` only when
  `rival_user_id` is set. Shows: the rival's avatar + name, the **record** ("You lead 3–1" /
  "3–1" / "Even 2–2"), the **streak** ("won 3 straight" — green — / "lost 2 straight" — muted/red),
  the **last result** ("beat them {relative time}"), and a **"Settle the score"** button (slim
  black-outline, like the duel buttons; calls `createFriendDuel`). Calm premium card matching the
  app's aesthetic.
- **Friend rows + detail page:** show the streak + last-result next to the existing record line
  (subtle — e.g. "3–1 · 🔥 won 3 straight"), reusing the friends data now on the row. Keep the
  slim-outline Duel button.
- All copy through i18n (`friends`/a new `rivalry` group), mirrored en/es/tr.

## 3. States

- **No completed duels** (new user / never dueled): no `RivalCard`; a gentle line "Duel a friend to
  start a rivalry." Rows show record 0–0 → "No duels yet."
- **Even record / streak 0:** show the record only; streak text omitted when 0.
- **Ties in rival selection:** deterministic (duels_14d, then last_played desc).
- **Guests:** rivalries are duel-based; work identically (duels roll into the same counters).

## 4. Copy & honesty (DESIGN §7)

Bragging-rights framing only: "You lead", "Settle the score", "won 3 straight", "your rival". Never
cash/prize/bet/gambling; never a fabricated count. Real completed-duel history only.

## 5. Scope guardrail (what this is NOT)

Friends screen only. **Not** in scope: a Home Rival card, duel-result rivalry callouts, "rival of
the week" rotation, or pulling today's-Royale head-to-head into the rival card (all can borrow this
data later). No change to the duel engine, settlement, or ranked fairness. No new question content.
No new tables/migration.

## 6. Testing

**Backend:**
- `streak` sign + length from an ordered completed-duel history (e.g. W,W,L,W from oldest→newest →
  streak `+1`; W,L,L,L → `-3`); `0` with no duels.
- `last_result`/`last_played` from the most recent completed duel.
- `duels_14d` counts only completed duels inside the 14-day window.
- rival selection: hottest-in-14d wins; recency breaks ties; 14-day fallback to most-recent overall;
  no-duels → `rival_user_id` null.
- only COMPLETED duels count (pending/declined/cancelled/expired ignored); non-friends excluded.
- `GET /friends` returns the new per-friend fields + `rival_user_id`.

**Frontend:**
- `RivalCard` renders record + streak wording + last-result + "Settle the score" (calls
  `createFriendDuel`).
- friend rows show the streak/last-result; no-rival empty state hides the card and shows the prompt.
- existing FriendsScreen tests stay green (new optional fields don't break them).

## 7. Risks

- **Query cost:** computing per-pair streaks means reading the user's completed duels. Bounded by
  friend count / duel volume; do it in one grouped query, not N. If it ever bites, cache per session.
- **Streak semantics:** "streak" is the consecutive run ending at the latest duel (not the max run
  ever) — documented so the copy ("won 3 straight") matches.
- **Rival churn:** "hottest right now" can change after each duel — intended (it tracks the active
  rivalry), not a bug.
