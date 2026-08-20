# Universal Evaluation — every answer feeds the brain model (Sub-project A)

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation plan
**Epic:** "Self-growth via AI" — Daily Royale eventually becomes the daily Rot Check.

## North star & decomposition

The product is evolving into a self-growth-via-AI app: the AI evaluates *every* answer a
player gives (correctness **and** speed) across every mode, builds a rich per-player brain
model, and the Daily Royale eventually reframes into the daily "Rot Check." That vision is
several sub-projects; this spec is the first, and the foundation the rest sit on:

- **A — Universal evaluation (THIS SPEC):** every mode feeds one unified brain model.
- **B — Growth over time:** turn the current-state profile into a trajectory (accuracy/speed/
  sharpness trends per category, day over day).
- **C — AI growth narrative:** a batch LLM synthesizes the trajectory into human-readable
  insight ("here's how your brain is changing, here's today's rep"). Never per-answer.
- **D — Daily Royale → Rot Check:** reframe the daily contest into the daily self-growth check.

Each sub-project gets its own spec → plan → implementation cycle. B/C/D are out of scope here.

## Architecture principle (locked)

"The AI evaluates every answer" = **every answer everywhere feeds the real-time, deterministic
brain model**; the **LLM only synthesizes periodically** (sub-project C), never per answer during
play. Per-answer LLM calls are explicitly rejected: slow, costly, and an anti-cheat regression.
The per-answer math is deterministic and already exists (`taste_profile.interest_signal`).

**Capture is server-authoritative** (chosen over client-emitted-everywhere): the server already
computes the authoritative judgement (correct / `time_frac` / valid / streak) at each mode's
per-round scoring point and already knows the question. We tap that. The client is demoted to an
engagement-only channel. This preserves the repo's "server-authoritative everything" invariant
(CLAUDE.md §9) and gives real, un-spoofable speed.

## Today's state (what already exists)

- `taste_profile.py` already evaluates each answer on **correctness + speed** (fast/normal/slow
  bands off the server's flat trivia timer) and folds it into category/subcategory/topic
  affinities, a difficulty preference, humor/brainrot/educational prefs, weak-but-interesting and
  disliked topics, and a confidence score. The signal model is spec-locked and stays as-is.
- Every LLM-classified question carries difficulty/quality/topic weights (`question_ai_metadata`).
- **The gap:** the profile is fed **only from `Practice.tsx`** via the client tracker. The Daily
  Royale, Campaign, bot duels, friend duels, and the Rot Check itself discard their answers. The
  brain model is built from a fraction of what the player actually plays.

## The design

### 1. One seam: `record_answer_signal(...)`

A single helper (in `app/services/taste_profile.py`, alongside `record_interaction`) is called at
each per-round scoring chokepoint, immediately after `judgement` is computed:

```
record_answer_signal(
    session, user_id, *,
    question_id: uuid.UUID | None,   # from answer.server_answer["question_id"]
    mode: str,                        # "practice" | "campaign" | "royale" | "duel" | "friend_duel" | "rot_check"
    is_correct: bool,                 # judgement.correct and judgement.valid
    response_ms: int | None,          # from the server's time_frac (never client-reported)
    timed_out: bool,
    streak_before: int,
    streak_after: int,
    session_id: str | None = None,    # entry_id / duel_id, for grouping
)
```

It constructs a `QuestionInteractionEvent` from these server-authoritative fields and folds it
into the profile via the existing `update_profile_from_event`. It is **best-effort**: the profile
update (and indeed the whole call) is wrapped in try/except and logs on failure — a bug here must
never sink a score write. It only `flush`es; the request boundary owns the commit.

### 2. Chokepoints (four functions cover everything)

| Function | File:line (approx) | Modes covered |
|---|---|---|
| `answer_practice_round` | practice.py:296 | Practice · **Campaign** · **Rot Check** · Quick Play (all ride the practice `/answer` loop) |
| `answer_contest_round` | contest.py:270 | **Daily Royale (ranked)** |
| bot-duel round scorer | duel.py:532 | Bot / Gem duels |
| friend-duel round resolution | friend_duel.py:388 | Live friend duels |

Campaign, Rot Check, and Quick Play all finalize the Entry through the practice `/answer` loop
(campaign.py:7), so hooking `answer_practice_round` captures them for free. The engine, scoring
service (`score_entry`), and settlement are **not** hooked — `score_entry` re-scores an entry's
rounds at settlement and would double-count live contest answers.

`mode` is passed by each caller so events are attributable. Where a caller already knows a finer
mode (campaign vs practice vs rot_check), it passes that; otherwise it passes its base mode.

### 3. `response_ms` derivation

Each judgement carries `time_frac` (1.0 = instant, 0.0 = used the full limit). The duel path
already has `time_frac_to_ms` (`duel_logic.py:34`); the practice/contest paths derive the same way
from the module's server limit. The existing `taste_profile._speed()` consumes `response_ms`
against the trivia timer unchanged.

### 4. Client role shrinks to engagement-only

The frontend tracker (`interactionTracker.ts`) stops sending correctness/speed (the server owns
those now) and sends **only** the signals the server cannot observe — `explanation_opened`,
`explanation_read_ms`, `shared_after`, `replayed_after` — tagged to the same `(entry_id, idx)` so
they resolve to the same `question_id` and fold into the same profile. This:

- removes the **Practice double-count** (server + client both emitting correctness), and
- turns the client tracker into a pure engagement channel that can later be wired into any screen
  that shows explanations, without re-introducing client-trusted correctness.

`POST /personalization/events` and its `record_interaction` path stay; the payload it carries from
the client is now engagement-only in practice, though the endpoint remains capable of the full
shape for compatibility.

### 5. Invariants preserved

- **Ranked fairness:** the model **records** from the Daily Royale, but ranked question
  **selection stays un-personalized** — `contest.enter` still calls `personalize_bank(mode=
  "ranked")`, a no-op unless `PERSONALIZE_RANKED_DAILY=true` (stays false). Recording ≠
  personalizing; leaderboard comparability and entry-seed reproducibility are untouched.
- **Guests:** the profile is keyed by `user_id`, which guests already have, so guest play builds
  the model immediately (compelling pre-signup Rot Check reveal) and survives upgrade-in-place with
  no merge subsystem.
- **Server never commits:** the helper `flush`es only; services never commit (per repo convention).
- **Idempotency / one event per answer:** each round scores exactly once — the practice/contest
  answer loops enforce strict `idx` sequencing and 409 on re-submit; duels resolve a round exactly
  once under a `FOR UPDATE` lock. So one answer → at most one server signal event.
- **Feature flag:** capture respects `settings.personalization_enabled` (already gating
  `record_interaction`); with it off, nothing is recorded and scoring is unaffected.

### 6. Scope guardrail (what A does NOT do)

- No new UI. No time-series / daily snapshots (that is **B**). No LLM narrative (that is **C**). No
  change to scores, coins, rating, standings, or the Daily Royale's product framing (that is **D**).
- A is pure capture plumbing. Its only observable effect is that `user_taste_profiles` and
  `question_interaction_events` now reflect *all* play, not just Practice.

## Data model

No migration. Reuses `question_interaction_events` and `user_taste_profiles` as-is. The
server-authoritative events simply populate columns the client used to (`is_correct`,
`response_ms`, `timed_out`, `streak_before/after`, `mode`, `session_id`), leaving the
engagement columns (`explanation_*`, `shared_after`, `replayed_after`) to the client channel.

## Testing

- **Per mode** (practice, campaign, contest/royale, bot duel, friend duel): answering a round
  writes exactly one `QuestionInteractionEvent` and bumps `profile.interaction_count`, with
  `is_correct` and `response_ms` matching the server judgement.
- **Ranked:** entering + answering the Daily Royale feeds the model, while `personalize_bank`
  for a ranked entry remains a pass-through (pool unchanged).
- **Guest:** a guest user answering builds a profile row keyed by their `user_id`.
- **No double-count:** the practice path produces one server event per answer even with the client
  tracker active (client no longer emits correctness).
- **Safety:** a forced failure inside the profile update does not fail the score write (the round
  result is still persisted).
- **Flag off:** with `personalization_enabled=false`, no events are written and scoring is intact.

## Risks

- **Double-count regression** if the client keeps emitting correctness — mitigated by explicitly
  narrowing the client tracker and a dedicated test.
- **`response_ms` skew across modes** (duel timer vs trivia timer): derive per-mode from that
  mode's server limit so `_speed()` bands stay meaningful; the trivia timer is the reference for
  the trivia-only modes.
- **Volume:** every answer now writes an event row. Acceptable at v1 scale; `question_interaction_
  events` is already append-only and can be pruned/rolled up in sub-project B if needed.
