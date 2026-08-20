# Audit — PR #34 "referral acquisition loop + challenge rivalry heartbeat" (CLOSED, not merged)

**Branch:** `feat/referrals-and-challenge-rivalry` · **Opened:** 2026-07-23 · **Closed:** 2026-08-02
**Size:** 56 files, +4,532 / −45 · **State at close:** CONFLICTING, 39 commits behind `main`

Closed deliberately. This document exists so the design is not lost with it — the branch is the
only place this work exists, and a closed PR's branch is easy to garbage-collect.

## Why it was closed rather than merged

It had drifted 39 commits behind `main` and conflicted across ~20 files, including
`services/registration.py`, `api/challenges.py`, `models/profile.py`, `core/constants.py`,
`core/cosmetics.py`, `services/unlocks.py` and `api/client.ts`. Several of those are exactly the
files reworked since (the themed share card, the profile-menu rework, the i18n dictionaries), so
the conflicts are semantic, not textual — resolving them means re-deciding the interaction between
two designs, not picking a side of a diff. Landing it in that state carried real risk of breaking
live behaviour, and the reward system it implements was never validated against real usage.

**Nothing from this branch was implemented or carried forward.** `main` remains free of referral
tables, referral rewards and rivalry tables.

## What it built — commit `4cb9304`, referrals

The piece worth remembering: it solved **acquisition attribution**, which `main` still has no
answer for.

**Data model** (`models/referral.py`, migration `c1a2b3d4e5f6`)

A `Referral` row is created when a NEW user arrives through an invite or challenge link, in
`pending`, and flips to `activated` only once that user *both* finishes their first Daily Royale
*and* upgrades off guest. Constraints were the good part:

- `UNIQUE(referred_user_id)` — first touch wins, permanently; a later link never overwrites it.
- `CHECK (referrer_user_id <> referred_user_id)` — self-referral impossible at the DB level.
- **No denormalized tally.** The activated count is always derived, so there is no cache to drift.
- `vector` (`challenge` | `invite_link`) plus a nullable `source_challenge_id`, so
  challenge-vs-invite attribution stays answerable after the fact.

**Rewards** (`core/constants.py`, `services/referral.py`)

| | |
|---|---|
| Newcomer | 10 gems + 100 coins |
| Referrer, per activation | 150 coins |
| Daily cap per referrer | 20 activations (anti-farming, not a limit on genuine inviting) |
| Milestone bonus | 300 coins at 3 activated |

Paid idempotently through the existing ledgers, so retries never double-pay.

**Cosmetic ladder** (`core/cosmetics.py`, requirement grammar `referrals:<n>` in
`services/unlocks.py`)

```
referrals:1   → referral_ring    (frame)
referrals:3   → referral_crest   (frame)
referrals:5   → referral_theme   (theme)   ← the aspirational unlock
referrals:10  → referral_halo    (frame)
```

This is close to the "luxury theme + frame after N shares" idea, with two design choices worth
keeping: it laddered (1/3/5/10) rather than a single cliff, and it counted **activations** —
someone who actually played and upgraded — rather than raw shares or raw signups.

**Frontend:** invite landing + invite screen, `?ref=` wiring in `App`, `getInviteInfo` /
`getReferralStats`, `invite` i18n. Also bundled an unrelated "offline-safe sessions" change
(cache the profile so a cold start without connectivity renders the app; only a definitive 401/403
discards the refresh token).

## What it built — commit `360bbd6`, rivalry heartbeat

When another player is the **first** to beat a shared challenge score, the creator gets a push
deep-linking into a head-to-head plus a "challenge back" CTA. Two deliberately separate tables:
`challenge_participations` (one row per entry, never carries notify state) and
`challenge_first_beats` (PK `challenge_id`, claimed via `ON CONFLICT DO NOTHING`, with a guarded
`notified_at` so the send happens exactly once). Rivalry was emergent from scores on a shared
same-seed challenge — never a directed 1v1, and it never touched referral tables.

## What to take from it if this is rebuilt

1. **The attribution model is the valuable part**, and it is small: one table, two constraints,
   first-touch-wins. It is worth rebuilding on current `main` independently of any reward.
2. **Activation, not signup, is the right trigger** — it is what makes farming expensive.
3. **Ladder the reward.** A single cliff at 5 is invisible to almost everyone at current scale.
4. **Don't bundle.** This PR carried referrals + rivalry + an offline-session refactor on one
   branch; that breadth is a large part of why it became unmergeable.

## Related state at time of closing

`main` still cannot measure the share funnel: `createChallenge` fires automatically when the
results screen mounts, so "links minted" is not a share count, and nothing records a play that
originated from a link. Any future incentive work needs that instrumentation first.
