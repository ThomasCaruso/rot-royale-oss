# Offline Play (Brain Boost · Campaign · Practice · Category) — Design Spec

**Date:** 2026-07-11
**Status:** Approved (design). Next: implementation plan.
**Goal:** Make every single-player learning mode — Brain Boost, Campaign, Practice, Category — fully playable with **no network**, while ranked/social surfaces (Daily Royale, leaderboard, duels, placement) stay online-only. Offline is a headline selling point, so the offline experience must feel first-class, not degraded.

---

## 1. Product decisions (locked)

1. **Answer posture:** *Device answers for non-ranked only.* Brain Boost / Campaign / Practice / Category cache round specs **plus answers + explanations on-device**, purely to drive the mid-session correct/wrong reveal. The **Daily Royale keeps answers server-only** (its shared-seed anti-cheat is untouched).
2. **Offline reward flow:** *Provisional now, real on sync.* Clearing a Campaign level offline shows earned coins and unlocks the next node immediately for momentum; the **server writes the ledger and reconciles on reconnect**.
3. **Scope:** Brain Boost, Campaign, Practice, **and** Category all work offline. Only Daily Royale + leaderboard + duels + placement require network.
4. **Platform:** *Native first, web PWA too.* Capacitor iOS/Android is the primary target and the marketing claim; the same service-worker + on-device store deliver web PWA offline for little extra cost.

### Anti-cheat posture (explicit, accepted)

The scoring authority stays on the server. On-device answers **only drive the local reveal**; they are never the scoring input. On sync, the server re-scores the player's recorded *choices* against its own bank `correctIndex`. Because the answers are on the device, a determined **offline** tamperer can force a pass on anything — but rewards are bounded by the **existing** daily coin cap + one-time first-clear coins + one-time gem milestones, and the currency is cosmetic closed-loop. The farm ceiling is therefore low and bounded. This is the accepted trade for "device answers for non-ranked."

**Invariants preserved:** `coin_ledger` remains append-only server-truth (`profiles.coins_balance` = ledger sum); the Daily Royale shared-seed model is unchanged; `server_answer` for ranked play never leaves the server.

---

## 2. Key simplification: choices recorded as *stable option identity*

Options are shuffled per-round (server remaps `correctIndex`). If the client recorded a choice as a *shuffled position*, the server would have to reproduce the exact shuffle to score it — fragile (seed reproduction) and version-sensitive.

Instead: **the client records each choice as the underlying `question_id` + the selected option's original (pre-shuffle) bank index.** The client can always de-shuffle because it holds the round's answer mapping on-device. The server then scores by a single comparison — `selected_index == bank.correctIndex` for that `question_id` — with **no shuffle reproduction and no seed dependency in the scoring path**. This works identically for Campaign and Practice/Category, since both are question-bank modes.

Seeds are still used to *build the offline bundle* and to keep display parity, but they are not part of the scoring authority.

---

## 3. Architecture overview

```
        ┌────────────────────────── ONLINE ──────────────────────────┐
Download │  GET /campaign/offline-bundle   GET /practice/offline-pool │
         │        (levels + answers)          (per-category answers)   │
         └───────────────────────────┬────────────────────────────────┘
                                      ▼
                      ┌──────────── On-device store (IndexedDB) ───────────┐
                      │ content:  bundle rounds { client_spec, answer{      │
                      │           correctIndex, explanation }, meta }        │
                      │           stamped with bank_version                  │
                      │ outbox:   queued results { client_id, kind, items[] }│
                      └───────────────────────────┬────────────────────────┘
                                                  ▼
        ┌────────────────────────── OFFLINE ──────────────────────────┐
Play    │  Offline Play Engine — reveal correct/wrong + explanation    │
        │  locally from cached answer. Record choices as stable ids.   │
        │  Provisionally mark level cleared + unlock next (display).    │
        └───────────────────────────┬─────────────────────────────────┘
                                     ▼ append result to outbox
        ┌───────────────────────── RECONNECT ─────────────────────────┐
Sync    │  Sync worker drains outbox →                                 │
        │  POST /campaign/offline-complete   POST /practice/offline-submit
        │  server RE-SCORES choices vs its own bank → canonical rewards │
        │  → reconcile provisional UI with server truth                │
        └──────────────────────────────────────────────────────────────┘
```

Three new client subsystems (`src/offline/`): **on-device store**, **offline play engine**, **sync worker**. Plus a small backend surface: two provisioning reads and two idempotent sync writes.

---

## 4. On-device store (`frontend/src/offline/store.ts`)

**Technology:** IndexedDB via a thin typed wrapper (`idb-keyval`-style or a small hand-rolled helper). Rationale: Capacitor Preferences and `localStorage` are size- and performance-limited; the content bundle (question banks with answers) is structured and can reach a few MB. IndexedDB is the correct tier and works on both native (WKWebView) and web.

**Object stores:**

- `content` — keyed records:
  - `campaign:<world>:<level>` → `{ world, level, is_boss, title, seed, rounds: OfflineRound[], bank_version }`
  - `pool:<category>` → `{ category, questions: OfflineRound[], bank_version }` (bounded pool for practice/category generation)
  - `meta` → `{ bank_version, fetched_at, campaign_levels_cached: number }`
- `outbox` — queued results, each `{ client_id: uuid, kind: "campaign"|"practice", payload, created_at, attempts }`.

```ts
type OfflineRound = {
  question_id: string;
  client_spec: RoundSpec;              // prompt + shuffled options + category/icon + time_limit_ms
  answer: { correctIndex: number;      // ORIGINAL (pre-shuffle) bank index
            explanation: string };
};
```

**Network detection:** add `@capacitor/network` (native events) with a `navigator.onLine` + `online`/`offline` window-event fallback (web). Surfaced through a `useNetwork()` Zustand store (`src/store/network.ts`) exposing `{ online: boolean }`.

**Staleness:** every cached record carries `bank_version`. When online, if the server's `bank_version` differs, re-fetch the bundle/pool. Cached campaign content is stable (authored); practice pools refresh more often.

---

## 5. Offline Play Engine (`frontend/src/offline/playEngine.ts` + screen wiring)

A local variant of the existing practice/campaign loop. Instead of calling `POST /practice/{entry}/answer` to learn correctness, it reveals directly from the cached `answer`:

- Reuse the existing UI components (`MultipleChoiceRound`, `PracticeReveal`, category splash, streak confetti gates) unchanged — the round *plays and feels identical*.
- On answer: de-shuffle the tapped option to its original index using the round's `client_spec` option order (the client knows the shuffle it rendered), compare to `answer.correctIndex`, show green/red + explanation.
- Record into a session accumulator: `{ question_id, selected_index /* original */, elapsed_ms }`.
- On finish: write one `outbox` record with a fresh `client_id` (UUID). For **campaign**, also (decision 2) provisionally mark the level cleared and unlock the next node in local campaign state, and show a provisional coin/gem estimate computed with the shared display formula. For **practice/Brain Boost/category**, show the normal local result screen (accuracy, provisional sharpness).

**Entry point selection:** the Campaign/Practice screens choose engine vs online path based on `useNetwork().online` **and** whether the content is cached. Online → existing server path (unchanged). Offline with cache → play engine. Offline without cache → "Not downloaded yet — connect once to make this available offline" empty state.

---

## 6. Backend sync surface

All new endpoints are **idempotent by `client_id`** (a partial-unique index on the client-supplied id, like the existing coin idempotency keys) so a retried or double-drained outbox is a no-op that returns the same canonical result.

### 6.1 `POST /campaign/offline-complete`
Request: `{ world, level, client_id, items: [{ question_id, selected_index, elapsed_ms }] }`

Server:
1. Validate the level is currently unlocked for the user (server-authoritative unlock state; a provisional client unlock does not grant server unlock — see §7 reconciliation).
2. Validate the submitted `question_id`s are exactly the level's authored question set (reject foreign/injected questions).
3. Re-score each item: `correct = (selected_index == bank.correctIndex)`; reconstruct streak from item order; `time_frac` from clamped client `elapsed_ms` (display-only for this non-ranked mode).
4. Run the **existing** `complete_campaign_level` settlement path → coins/gems/progress/unlocks, honoring the **daily coin cap at sync time** and all one-time idempotency guards.
5. Return the canonical `CampaignCompleteResponse` (+ echo `client_id`).

Idempotency: if `client_id` already settled, return the stored canonical result without re-awarding.

### 6.2 `POST /practice/offline-submit`
Request: `{ mode, category, client_id, items: [{ question_id, selected_index, elapsed_ms }] }`

Server: re-score each item by `question_id` lookup, create a SUBMITTED entry + `RoundResult`s, apply sharpness and `record_answer_signal` personalization (streak reconstructed from order), idempotent by `client_id`. Brain Boost summary then reads the created entry through the existing `/brain-boost/{entry_id}/summary` path.

### 6.3 Provisioning reads
- `GET /campaign/offline-bundle` → `{ bank_version, levels: [{ world, level, is_boss, title, seed, rounds:[{question_id, client_spec, answer:{correctIndex, explanation}}] }] }` for all **unlocked + lookahead** levels (lookahead depth a tunable constant; whole campaign is acceptable since authored content is small).
- `GET /practice/offline-pool?category=` → `{ bank_version, category, questions:[{question_id, client_spec, answer:{correctIndex, explanation}}] }`, a bounded pool per category (constant cap) sufficient to generate offline sessions.

Both include answers (the "device answers" decision) and are only served to authenticated users.

---

## 7. Reconciliation (provisional → canonical)

- The sync worker drains the `outbox` **strictly FIFO** whenever `online` flips true (and on app foreground). FIFO matters for dependent campaign levels: if the player cleared N then N+1 offline, N syncs first and unlocks N+1 server-side before N+1's `offline-complete` runs. If N fails server re-scoring (didn't actually clear), N+1 is then legitimately `locked`-rejected and dropped, and the UI reconciles both to server truth. Each record POSTs to its endpoint; on `2xx` it is removed and the canonical result merged into local state; on network failure it stays queued (bumped `attempts`); on a `4xx` validation rejection it is dropped and logged (it can never succeed).
- After a campaign result syncs, refresh `/me` (coins/gems) and `/campaign` (authoritative ladder). Provisional unlocks/clears that the server confirms simply lose their "pending" mark; in the rare case the server disagrees (e.g., cap reached), the UI settles to server truth without a scary error — pending coins that didn't materialize are shown as "counted toward today's cap."
- Because rewards are server-written, there is never a double-credit: `client_id` + the existing per-award idempotency keys guarantee exactly-once.

---

## 8. App shell & assets

- Extend the existing Workbox precache (`vite.config.ts`) to include **theme art PNGs** (`public/assets/themes/**`) so themed offline play renders correctly, not just the JS/CSS/fonts already precached.
- Confirm `navigateFallback: /index.html` covers deep links used by the offline modes.
- API base stays build-time baked (`VITE_API_BASE`) — already correct; no runtime config needed.

---

## 9. Network-aware UX

- **Offline banner:** slim, non-alarming ("Offline — your progress will sync when you're back").
- **Online-required surfaces:** Daily Royale, leaderboard, duels, placement render a clean "Back online to play this" state offline (not a crash/spinner).
- **Sync chip:** subtle "N results syncing…" indicator while the outbox drains; clears to a brief "Synced ✓".
- **Pending marks:** provisionally-cleared campaign levels wear a small "pending" dot until the server confirms.
- **Download control:** a "Downloaded ✓ / Update available" affordance on Campaign (and per-category for Practice) so players can pre-load before going offline; auto-download opportunistically while online.
- All copy obeys DESIGN §7 honesty rules (no fake counts, coins-not-cash, etc.).

---

## 10. Testing

**Backend**
- `offline-complete` / `offline-submit` re-score correctly from stable indices; results match the equivalent online path.
- Idempotent under double-submit (same `client_id` → identical result, no double award).
- Daily coin cap still enforced when many campaign results sync at once.
- Rejects mismatched/injected `question_id`s and locked levels.
- Ledger sum still equals `coins_balance` after a batch sync.

**Frontend**
- On-device store round-trips bundle + outbox; `bank_version` change triggers refresh.
- Offline play engine reveals correct/wrong + explanation purely from cache; de-shuffle maps to the right original index.
- Outbox drains exactly once on reconnect; a failed POST re-queues, a validation `4xx` drops.
- Provisional → canonical reconciliation (coins, unlocks, pending marks) with online and cap-reached cases.
- `useNetwork()` reflects Capacitor Network events and web `online`/`offline`.
- Online-required screens show the offline state instead of erroring.

---

## 11. Non-goals (v1)

- No offline Daily Royale, leaderboard, duels, or placement (network-required by design).
- No background sync while the app is fully closed (sync runs on reconnect/foreground; native background-fetch is a later upgrade).
- No local settlement mirror — the server remains the sole scorer.
- No conflict UI beyond the quiet reconciliation in §7.

---

## 12. Implementation sequencing (for the plan)

1. **Backend first:** provisioning reads (`offline-bundle`, `offline-pool`) + sync writes (`offline-complete`, `offline-submit`) with idempotency, re-scoring, and tests. No client dependency.
2. **Client store + network:** IndexedDB store, `@capacitor/network`, `useNetwork()`, download/staleness.
3. **Offline play engine:** local reveal loop reusing existing components; outbox recording; provisional campaign unlock.
4. **Sync worker + reconciliation:** drain, merge, pending marks.
5. **App-shell/assets + network-aware UX:** precache art, offline banner, online-required states, download controls.

Remains one coherent spec; the plan may split it into a backend plan and a client plan.
