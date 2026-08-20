# Offline Play — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Brain Boost, Campaign, Practice, and Category playable with no network — download answer-bearing content while online, play + reveal offline, queue results, and sync them (server re-scores) on reconnect — with "provisional now, real on sync" rewards and clean online-required states for ranked/social surfaces.

**Architecture:** Three new subsystems under `frontend/src/offline/`: an **IndexedDB store** (content bundle + outbox), an **offline play engine** (local reveal from cached answers, reusing existing round/reveal components), and a **sync worker** (drains the outbox FIFO, reconciles provisional→canonical). A `useNetwork()` store drives online/offline UX. Depends on the backend plan's endpoints/contract (`2026-07-11-offline-play-backend.md`).

**Tech Stack:** Vite + React + TS, Zustand, Capacitor (`@capacitor/preferences`, add `@capacitor/network`), `idb-keyval` for IndexedDB, Workbox (VitePWA), vitest. Commands run from `frontend/`.

**Shared contract (from the backend plan):**

```ts
type OfflineRound = {
  question_id: string; idx: number;
  client_spec: { prompt: string; options: string[]; category: string; icon: string; time_limit_ms: number };
  option_source_index: number[];  // option_source_index[shuffledPos] = original bank index
  correct_index: number;          // shuffled slot of the correct option (LOCAL reveal only)
  explanation: string | null;
};
type OfflineItem = { question_id: string; selected_source_index: number; elapsed_ms: number };
// Reveal: highlight correct_index (shuffled). Record: selected_source_index = option_source_index[chosenShuffledPos].
```

---

## File Structure

- Create `frontend/src/offline/db.ts` — IndexedDB wrapper (idb-keyval stores + typed get/set/queue). One responsibility: durable on-device storage.
- Create `frontend/src/offline/types.ts` — `OfflineRound`, `OfflineItem`, `OutboxRecord`, bundle/pool types.
- Create `frontend/src/offline/content.ts` — download + cache campaign bundle / practice pools; staleness by `bank_version`.
- Create `frontend/src/offline/playEngine.ts` — pure helpers: score/reveal a round locally, accumulate items.
- Create `frontend/src/offline/outbox.ts` — enqueue results; `useOutbox()` count.
- Create `frontend/src/offline/sync.ts` — drain outbox FIFO, POST to backend, reconcile.
- Create `frontend/src/store/network.ts` — `useNetwork()` (Capacitor Network + web events).
- Modify `frontend/src/api/client.ts` — add `campaignOfflineBundle`, `campaignOfflineComplete`, `practiceOfflinePool`, `practiceOfflineSubmit`.
- Modify `frontend/src/screens/Practice.tsx` — branch to offline engine when offline+cached.
- Modify `frontend/src/screens/campaign/*` — offline start/play/complete + "pending" marks + download control.
- Modify `frontend/src/app/App.tsx` — bootstrap network store + sync worker; offline-gate ranked/social screens.
- Modify `frontend/vite.config.ts` — precache theme art.
- Tests: `*.test.ts(x)` beside each new module.

---

### Task 1: Dependencies + `useNetwork()` store

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/store/network.ts`, `frontend/src/store/network.test.ts`

- [ ] **Step 1: Install deps**

Run: `npm install idb-keyval @capacitor/network`
Expected: both added to `dependencies`. (`@capacitor/network` gives reliable native online/offline events; `idb-keyval` is a tiny promise-based IndexedDB wrapper.)

- [ ] **Step 2: Write the failing test**

Create `frontend/src/store/network.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { useNetwork, setOnline } from "./network";

describe("useNetwork", () => {
  it("defaults to online and reflects setOnline", () => {
    setOnline(true);
    expect(useNetwork.getState().online).toBe(true);
    setOnline(false);
    expect(useNetwork.getState().online).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm run test -- src/store/network.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement**

Create `frontend/src/store/network.ts`:

```ts
import { create } from "zustand";
import { Network } from "@capacitor/network";

interface NetworkState {
  online: boolean;
}
export const useNetwork = create<NetworkState>(() => ({
  online: typeof navigator === "undefined" ? true : navigator.onLine,
}));

export function setOnline(online: boolean): void {
  if (useNetwork.getState().online !== online) useNetwork.setState({ online });
}

/** Wire real network events. Call once at app bootstrap. Returns a teardown fn. */
export function startNetworkWatch(): () => void {
  let remove: (() => void) | undefined;
  Network.addListener("networkStatusChange", (s) => setOnline(s.connected))
    .then((h) => { remove = () => void h.remove(); })
    .catch(() => undefined);
  const onl = () => setOnline(true);
  const off = () => setOnline(false);
  if (typeof window !== "undefined") {
    window.addEventListener("online", onl);
    window.addEventListener("offline", off);
  }
  Network.getStatus().then((s) => setOnline(s.connected)).catch(() => undefined);
  return () => {
    remove?.();
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onl);
      window.removeEventListener("offline", off);
    }
  };
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm run test -- src/store/network.test.ts`
Expected: PASS. (If vitest cannot resolve `@capacitor/network` in the `node` env, add a `vi.mock("@capacitor/network", ...)` returning `{ Network: { addListener: async () => ({ remove(){} }), getStatus: async () => ({ connected: true }) } }` at the top of the test.)

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/store/network.ts frontend/src/store/network.test.ts
git commit -m "feat(offline): network status store + capacitor/network"
```

---

### Task 2: IndexedDB store (`offline/db.ts`)

**Files:**
- Create: `frontend/src/offline/types.ts`, `frontend/src/offline/db.ts`, `frontend/src/offline/db.test.ts`

- [ ] **Step 1: Define types**

Create `frontend/src/offline/types.ts`:

```ts
export interface OfflineRound {
  question_id: string;
  idx: number;
  client_spec: { prompt: string; options: string[]; category: string; icon: string; time_limit_ms: number };
  option_source_index: number[];
  correct_index: number;
  explanation: string | null;
}
export interface CampaignBundleLevel {
  world: string; level: number; title: string; is_boss: boolean; seed: number; rounds: OfflineRound[];
}
export interface CampaignBundle { bank_version: string; levels: CampaignBundleLevel[]; }
export interface PracticePool { category: string | null; bank_version: string; questions: OfflineRound[]; }

export interface OfflineItem { question_id: string; selected_source_index: number; elapsed_ms: number; }

export type OutboxRecord =
  | { kind: "campaign"; client_id: string; created_at: number; attempts: number;
      payload: { world: string; level: number; items: OfflineItem[] } }
  | { kind: "practice"; client_id: string; created_at: number; attempts: number;
      payload: { mode: string | null; category: string | null; items: OfflineItem[] } };
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/offline/db.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { putCampaignLevel, getCampaignLevel, enqueue, listOutbox, removeFromOutbox } from "./db";

describe("offline db", () => {
  beforeEach(async () => {
    const rec = await listOutbox();
    for (const r of rec) await removeFromOutbox(r.client_id);
  });

  it("round-trips a campaign level", async () => {
    const lvl = { world: "Science", level: 1, title: "Start", is_boss: false, seed: 7, rounds: [] };
    await putCampaignLevel(lvl);
    expect(await getCampaignLevel("Science", 1)).toEqual(lvl);
  });

  it("queues and lists outbox FIFO by created_at", async () => {
    await enqueue({ kind: "practice", client_id: "a", created_at: 1, attempts: 0, payload: { mode: "practice", category: null, items: [] } });
    await enqueue({ kind: "practice", client_id: "b", created_at: 2, attempts: 0, payload: { mode: "practice", category: null, items: [] } });
    const list = await listOutbox();
    expect(list.map((r) => r.client_id)).toEqual(["a", "b"]);
    await removeFromOutbox("a");
    expect((await listOutbox()).map((r) => r.client_id)).toEqual(["b"]);
  });
});
```

Run: `npm install -D fake-indexeddb` first (test-only IndexedDB shim for the node/jsdom test env).

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm run test -- src/offline/db.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement**

Create `frontend/src/offline/db.ts`:

```ts
import { get, set, del, keys, createStore } from "idb-keyval";
import type { CampaignBundleLevel, PracticePool, OutboxRecord } from "./types";

const content = createStore("rr-offline-content", "kv");
const outbox = createStore("rr-offline-outbox", "kv");

const campKey = (world: string, level: number) => `campaign:${world}:${level}`;

export async function putCampaignLevel(l: CampaignBundleLevel): Promise<void> {
  await set(campKey(l.world, l.level), l, content);
}
export async function getCampaignLevel(world: string, level: number): Promise<CampaignBundleLevel | undefined> {
  return get(campKey(world, level), content);
}
export async function putPool(p: PracticePool): Promise<void> {
  await set(`pool:${p.category ?? "_mixed"}`, p, content);
}
export async function getPool(category: string | null): Promise<PracticePool | undefined> {
  return get(`pool:${category ?? "_mixed"}`, content);
}
export async function setMeta(v: { bank_version: string; fetched_at: number }): Promise<void> {
  await set("meta", v, content);
}
export async function getMeta(): Promise<{ bank_version: string; fetched_at: number } | undefined> {
  return get("meta", content);
}

export async function enqueue(r: OutboxRecord): Promise<void> {
  await set(r.client_id, r, outbox);
}
export async function listOutbox(): Promise<OutboxRecord[]> {
  const ks = await keys(outbox);
  const recs = await Promise.all(ks.map((k) => get(k as string, outbox) as Promise<OutboxRecord>));
  return recs.filter(Boolean).sort((a, b) => a.created_at - b.created_at);
}
export async function removeFromOutbox(client_id: string): Promise<void> {
  await del(client_id, outbox);
}
export async function bumpAttempts(client_id: string): Promise<void> {
  const r = (await get(client_id, outbox)) as OutboxRecord | undefined;
  if (r) await set(client_id, { ...r, attempts: r.attempts + 1 }, outbox);
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm run test -- src/offline/db.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/offline/types.ts frontend/src/offline/db.ts frontend/src/offline/db.test.ts frontend/package.json frontend/package-lock.json
git commit -m "feat(offline): IndexedDB content + outbox store"
```

---

### Task 3: API client methods

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.offline.test.ts`

- [ ] **Step 1: Add types + methods** to `frontend/src/api/client.ts` (near the campaign/practice methods ~lines 852-913):

```ts
// types (near other response interfaces)
export interface CampaignBundleResp { bank_version: string; levels: import("@/offline/types").CampaignBundleLevel[]; }
export interface PracticePoolResp { category: string | null; bank_version: string; questions: import("@/offline/types").OfflineRound[]; }

// methods (inside the `api` object)
campaignOfflineBundle: () => authedRequest<CampaignBundleResp>("/campaign/offline-bundle"),
campaignOfflineComplete: (body: { world: string; level: number; client_id: string; items: import("@/offline/types").OfflineItem[] }) =>
  authedRequest<CampaignCompleteResponse>("/campaign/offline-complete", jsonInit("POST", body)),
practiceOfflinePool: (category?: string | null) =>
  authedRequest<PracticePoolResp>(`/practice/offline-pool${category ? `?category=${encodeURIComponent(category)}` : ""}`),
practiceOfflineSubmit: (body: { mode: string | null; category: string | null; client_id: string; items: import("@/offline/types").OfflineItem[] }) =>
  authedRequest<PracticeResultResponse>("/practice/offline-submit", jsonInit("POST", body)),
```

- [ ] **Step 2: Write a test** that the methods build the right requests (mock `fetch`):

Create `frontend/src/api/client.offline.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client";

describe("offline api methods", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
  });
  it("posts campaign offline-complete with the body", async () => {
    await api.campaignOfflineComplete({ world: "Science", level: 1, client_id: "c1", items: [] });
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({ world: "Science", level: 1, client_id: "c1" });
  });
});
```

- [ ] **Step 3: Run** `npm run test -- src/api/client.offline.test.ts` — Expected: PASS. (If the auth token gate short-circuits, set a token first via `useSessionStore.getState().setAccessToken("t")`.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.offline.test.ts
git commit -m "feat(offline): api client methods for bundle/pool/sync"
```

---

### Task 4: Offline play engine (pure helpers)

**Files:**
- Create: `frontend/src/offline/playEngine.ts`, `frontend/src/offline/playEngine.test.ts`

Pure functions the offline screens use: given an `OfflineRound` and the player's chosen **shuffled** slot, produce the reveal + the recordable `OfflineItem`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/offline/playEngine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { revealFor, itemFor } from "./playEngine";
import type { OfflineRound } from "./types";

const round: OfflineRound = {
  question_id: "q1", idx: 0,
  client_spec: { prompt: "2+2", options: ["5", "4", "6", "7"], category: "Science & Nature", icon: "flask", time_limit_ms: 10000 },
  option_source_index: [1, 0, 2, 3], // shuffled slot -> original index
  correct_index: 1,                  // "4" sits at shuffled slot 1
  explanation: "because",
};

describe("offline play engine", () => {
  it("reveals correct when the chosen shuffled slot is the correct one", () => {
    const r = revealFor(round, 1);
    expect(r.correct).toBe(true);
    expect(r.correctIndex).toBe(1);
    expect(r.explanation).toBe("because");
  });
  it("reveals wrong otherwise", () => {
    expect(revealFor(round, 0).correct).toBe(false);
  });
  it("records the choice as the ORIGINAL bank index", () => {
    // chose shuffled slot 0 -> original index 1
    expect(itemFor(round, 0, 3400)).toEqual({ question_id: "q1", selected_source_index: 1, elapsed_ms: 3400 });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test -- src/offline/playEngine.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

Create `frontend/src/offline/playEngine.ts`:

```ts
import type { OfflineRound, OfflineItem } from "./types";

export interface OfflineReveal { correct: boolean; correctIndex: number; explanation: string | null; }

/** Local reveal from cached answer. `chosenShuffled` is the slot the player tapped (or null = timeout). */
export function revealFor(round: OfflineRound, chosenShuffled: number | null): OfflineReveal {
  return {
    correct: chosenShuffled === round.correct_index,
    correctIndex: round.correct_index,
    explanation: round.explanation,
  };
}

/** Record the choice as a STABLE original bank index so the server can re-score it on sync. */
export function itemFor(round: OfflineRound, chosenShuffled: number | null, elapsedMs: number): OfflineItem {
  const src = chosenShuffled === null ? -1 : round.option_source_index[chosenShuffled];
  return { question_id: round.question_id, selected_source_index: src, elapsed_ms: elapsedMs };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test -- src/offline/playEngine.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/offline/playEngine.ts frontend/src/offline/playEngine.test.ts
git commit -m "feat(offline): pure play-engine reveal + item helpers"
```

---

### Task 5: Content download + staleness (`offline/content.ts`)

**Files:**
- Create: `frontend/src/offline/content.ts`, `frontend/src/offline/content.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/offline/content.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { downloadCampaign, isCampaignLevelCached } from "./content";
import * as db from "./db";

describe("offline content", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("downloads a bundle and caches each level", async () => {
    vi.spyOn(await import("@/api/client"), "api", "get").mockReturnValue({
      campaignOfflineBundle: async () => ({ bank_version: "v1", levels: [
        { world: "Science", level: 1, title: "S1", is_boss: false, seed: 1, rounds: [] },
      ] }),
    } as never);
    await downloadCampaign();
    expect(await isCampaignLevelCached("Science", 1)).toBe(true);
  });
});
```

> If mocking the `api` getter is awkward, refactor `downloadCampaign` to accept an injected fetcher: `downloadCampaign(fetch = api.campaignOfflineBundle)` and pass a stub in the test.

- [ ] **Step 2: Run it to confirm it fails** — `npm run test -- src/offline/content.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Create `frontend/src/offline/content.ts`:

```ts
import { api } from "@/api/client";
import { putCampaignLevel, getCampaignLevel, putPool, setMeta } from "./db";

export async function downloadCampaign(fetch = api.campaignOfflineBundle): Promise<void> {
  const bundle = await fetch();
  for (const lvl of bundle.levels) await putCampaignLevel(lvl);
  await setMeta({ bank_version: bundle.bank_version, fetched_at: Date.now() });
}

export async function downloadPractice(category: string | null = null, fetch = api.practiceOfflinePool): Promise<void> {
  const pool = await fetch(category);
  await putPool(pool);
}

export async function isCampaignLevelCached(world: string, level: number): Promise<boolean> {
  return (await getCampaignLevel(world, level)) !== undefined;
}

/** Best-effort opportunistic refresh while online; safe to call on app foreground. */
export async function refreshOfflineContent(): Promise<void> {
  await Promise.allSettled([downloadCampaign(), downloadPractice(null)]);
}
```

- [ ] **Step 4: Run the test** — `npm run test -- src/offline/content.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/offline/content.ts frontend/src/offline/content.test.ts
git commit -m "feat(offline): content download + cache"
```

---

### Task 6: Sync worker (drain outbox FIFO + reconcile)

**Files:**
- Create: `frontend/src/offline/outbox.ts`, `frontend/src/offline/sync.ts`, `frontend/src/offline/sync.test.ts`

- [ ] **Step 1: Implement the tiny outbox count store** `frontend/src/offline/outbox.ts`:

```ts
import { create } from "zustand";
import { listOutbox, enqueue as dbEnqueue } from "./db";
import type { OutboxRecord } from "./types";

export const useOutbox = create<{ pending: number }>(() => ({ pending: 0 }));

export async function refreshOutboxCount(): Promise<void> {
  useOutbox.setState({ pending: (await listOutbox()).length });
}
export async function enqueue(r: OutboxRecord): Promise<void> {
  await dbEnqueue(r);
  await refreshOutboxCount();
}
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/offline/sync.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { enqueue } from "./outbox";
import { drainOutbox } from "./sync";
import { listOutbox } from "./db";

describe("sync worker", () => {
  beforeEach(async () => { for (const r of await listOutbox()) await import("./db").then((m) => m.removeFromOutbox(r.client_id)); });

  it("posts each record once and clears it on success", async () => {
    const campaign = vi.fn(async () => ({ passed: true }));
    const practice = vi.fn(async () => ({ correct: 5 }));
    await enqueue({ kind: "campaign", client_id: "c1", created_at: 1, attempts: 0, payload: { world: "Science", level: 1, items: [] } });
    await drainOutbox({ campaign, practice, onReconciled: () => {} });
    expect(campaign).toHaveBeenCalledTimes(1);
    expect(await listOutbox()).toHaveLength(0);
  });

  it("keeps a record queued on network failure but drops it on 4xx", async () => {
    const netErr = vi.fn(async () => { throw new (await import("@/api/client")).ApiError(0, "offline"); });
    await enqueue({ kind: "campaign", client_id: "c2", created_at: 1, attempts: 0, payload: { world: "Science", level: 1, items: [] } });
    await drainOutbox({ campaign: netErr, practice: vi.fn(), onReconciled: () => {} });
    expect(await listOutbox()).toHaveLength(1); // still queued

    const badReq = vi.fn(async () => { throw new (await import("@/api/client")).ApiError(400, "bad"); });
    await drainOutbox({ campaign: badReq, practice: vi.fn(), onReconciled: () => {} });
    expect(await listOutbox()).toHaveLength(0); // dropped
  });
});
```

- [ ] **Step 3: Run it to confirm it fails** — `npm run test -- src/offline/sync.test.ts` → FAIL.

- [ ] **Step 4: Implement**

Create `frontend/src/offline/sync.ts`:

```ts
import { api, ApiError } from "@/api/client";
import { listOutbox, removeFromOutbox, bumpAttempts } from "./db";
import { refreshOutboxCount } from "./outbox";
import type { OutboxRecord } from "./types";

export interface SyncDeps {
  campaign: (b: { world: string; level: number; client_id: string; items: OutboxRecord["payload"] extends { items: infer I } ? I : never }) => Promise<unknown>;
  practice: (b: { mode: string | null; category: string | null; client_id: string; items: unknown }) => Promise<unknown>;
  onReconciled: (r: OutboxRecord, result: unknown) => void;
}

const defaultDeps: Pick<SyncDeps, "campaign" | "practice"> = {
  campaign: (b) => api.campaignOfflineComplete(b as never),
  practice: (b) => api.practiceOfflineSubmit(b as never),
};

let draining = false;

/** Drain the outbox strictly FIFO. Network error → keep + bump attempts. 4xx → drop (never succeeds). */
export async function drainOutbox(deps: Partial<SyncDeps> = {}): Promise<void> {
  if (draining) return;
  draining = true;
  const { campaign, practice, onReconciled } = { ...defaultDeps, onReconciled: () => {}, ...deps } as SyncDeps;
  try {
    for (const rec of await listOutbox()) {
      try {
        const result =
          rec.kind === "campaign"
            ? await campaign({ world: rec.payload.world, level: rec.payload.level, client_id: rec.client_id, items: rec.payload.items as never })
            : await practice({ mode: rec.payload.mode, category: rec.payload.category, client_id: rec.client_id, items: rec.payload.items });
        await removeFromOutbox(rec.client_id);
        onReconciled(rec, result);
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          await removeFromOutbox(rec.client_id); // permanent rejection
        } else {
          await bumpAttempts(rec.client_id); // transient (offline / 5xx) — retry later
          break; // stop draining; preserve FIFO for dependent campaign levels
        }
      }
    }
  } finally {
    await refreshOutboxCount();
    draining = false;
  }
}
```

- [ ] **Step 5: Run the test to confirm it passes** — `npm run test -- src/offline/sync.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/offline/outbox.ts frontend/src/offline/sync.ts frontend/src/offline/sync.test.ts
git commit -m "feat(offline): sync worker drains outbox FIFO + reconciles"
```

---

### Task 7: Wire offline into the Practice screen

**Files:**
- Modify: `frontend/src/screens/Practice.tsx`
- Test: `frontend/src/screens/Practice.offline.test.tsx`

Branch the existing loop: when `useNetwork().online === false` and a pool is cached, run locally. Reuse the round module `Component` and `PracticeReveal` unchanged; instead of `api.answerPracticeRound`, call `revealFor`; on finish, `enqueue` a practice record and show the local result. When online, behavior is unchanged.

- [ ] **Step 1: Write the failing test** — mount `Practice` with network forced offline and a seeded pool; assert it plays a round and enqueues one outbox record on finish.

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Practice } from "./Practice";
import { setOnline } from "@/store/network";
import { putPool } from "@/offline/db";
import { listOutbox } from "@/offline/db";

beforeEach(async () => { setOnline(false); });

it("plays offline from the cached pool and queues a result", async () => {
  await putPool({ category: null, bank_version: "v1", questions: [
    { question_id: "q1", idx: 0, client_spec: { prompt: "2+2", options: ["4","5","6","7"], category: "Science & Nature", icon: "flask", time_limit_ms: 10000 }, option_source_index: [0,1,2,3], correct_index: 0, explanation: null },
  ] });
  render(<Practice mode={null} category={null} onExit={() => {}} />);
  await screen.findByText("2+2");
  fireEvent.click(screen.getByText("4"));
  await waitFor(async () => expect(await listOutbox()).toHaveLength(1));
});
```

> `@testing-library/react` may already be a dev dep; if not, `npm install -D @testing-library/react @testing-library/dom`. Ensure vitest env is `jsdom` for this file (the directive above sets it per-file). You may need to switch `vitest.config.ts` `environment` to `jsdom` or rely on the per-file directive — prefer the per-file directive to avoid changing global config.

- [ ] **Step 2: Run it to confirm it fails** — FAIL (no offline branch yet).

- [ ] **Step 3: Implement the offline branch** in `Practice.tsx`. Add near the top of the component:

```tsx
import { useNetwork } from "@/store/network";
import { getPool } from "@/offline/db";
import { revealFor, itemFor } from "@/offline/playEngine";
import { enqueue } from "@/offline/outbox";
import type { OfflineRound, OfflineItem } from "@/offline/types";
```

Add an `offline` flag from `useNetwork`, and when offline load `getPool(category)` instead of `api.startPractice`, mapping each `OfflineRound.client_spec` into the same `RoundSpec` the module `Component` renders. On each round's `onComplete({choice, elapsed_ms})`: compute `revealFor(round, choice)` locally to drive `PracticeReveal` (build a `PracticeAnswerResponse`-shaped object: `{ idx, module_type:"trivia", correct, valid:true, answer:{correctIndex: reveal.correctIndex}, explanation, finished }`), and push `itemFor(round, choice, elapsed_ms)` into a local `items` ref. On the final round, `enqueue({ kind:"practice", client_id: crypto.randomUUID(), created_at: Date.now(), attempts:0, payload:{ mode, category, items } })` and show the local result screen.

> Keep the online path exactly as-is; guard the new logic behind `offline`. The `PracticeReveal` component already reads `reveal.answer.correctIndex` and `reveal.explanation`, so the offline-constructed reveal object drops in unchanged.

- [ ] **Step 4: Run the test to confirm it passes** — PASS.

- [ ] **Step 5: Run the full frontend suite + typecheck** — `npm run test && npm run typecheck` → green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/Practice.tsx frontend/src/screens/Practice.offline.test.tsx
git commit -m "feat(offline): Practice plays offline from cached pool"
```

---

### Task 8: Wire offline into Campaign (play + provisional unlock + pending marks)

**Files:**
- Modify: `frontend/src/screens/campaign/Campaign.tsx`, `CampaignPlay.tsx`, `CampaignLadder.tsx`
- Create: `frontend/src/offline/campaignLocal.ts` (provisional local progress) + test

- [ ] **Step 1: Local provisional progress store** — write `frontend/src/offline/campaignLocal.ts` with a per-user localStorage map of provisionally-cleared `{world, level}` and provisionally-unlocked next levels (follow the `rotReportStore.ts` fail-safe pattern). Test it round-trips and merges with server ladder state (mark levels "pending" until the server confirms). Include the test first (TDD), matching the `rotReportStore.test.ts` structure.

- [ ] **Step 2: Offline start/play/complete in `CampaignPlay.tsx`** — when offline, load the level from `getCampaignLevel(world, level)` instead of `api.campaignStart`; run the same reveal loop via `revealFor`; on finish, `enqueue({ kind:"campaign", client_id: crypto.randomUUID(), ... payload:{ world, level, items } })`, mark the level provisionally cleared + next unlocked in `campaignLocal`, and show `LevelComplete` with a provisional coin estimate and a small "will finalize when you're back online" line. Add a TDD test asserting an offline finish enqueues exactly one campaign record and marks local progress.

- [ ] **Step 3: Merge provisional state into the ladder** in `Campaign.tsx`/`CampaignLadder.tsx` — overlay `campaignLocal` onto `CampaignLadderResponse` so provisionally-cleared levels show cleared + a "pending" dot, and their next level is playable offline. When `useOutbox().pending === 0` after a sync, clear the local provisional entries (server ladder is now truth). Add a test for the overlay.

- [ ] **Step 4: Download control** — in the Campaign hub, add a "Downloaded ✓ / Update" control calling `downloadCampaign()`; show `getMeta().bank_version` freshness. Keep copy honest (no fake counts).

- [ ] **Step 5: Run** `npm run test && npm run typecheck` → green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/campaign frontend/src/offline/campaignLocal.ts frontend/src/offline/campaignLocal.test.ts
git commit -m "feat(offline): Campaign offline play + provisional unlock + pending marks"
```

---

### Task 9: App bootstrap, sync triggers, and online-required gating

**Files:**
- Modify: `frontend/src/app/App.tsx`
- Test: `frontend/src/app/offlineGate.test.tsx` (or a focused unit for the gate helper)

- [ ] **Step 1: Bootstrap** — in `App.tsx`'s bootstrap effect, call `startNetworkWatch()` (store teardown), `refreshOutboxCount()`, and register a reaction: whenever `useNetwork` flips to `online === true`, call `drainOutbox({ onReconciled: () => void Promise.allSettled([load-campaign-if-open, refreshMe()]) })` and `refreshOfflineContent()`. Also drain on app foreground (`document visibilitychange`).

- [ ] **Step 2: Offline-gate ranked/social** — extract a pure `requiresOnline(screen)` helper (Daily Royale/Contest, Leaderboard, Duel, Friends live duel, placement) and, when `!online`, render a calm "Back online to play this" panel instead of those screens. Write the helper + a unit test first (TDD):

```ts
import { requiresOnline } from "./offlineGate";
it("gates ranked and social surfaces", () => {
  expect(requiresOnline("contest")).toBe(true);
  expect(requiresOnline("leaderboard")).toBe(true);
  expect(requiresOnline("duel")).toBe(true);
  expect(requiresOnline("campaign")).toBe(false);
  expect(requiresOnline("practice")).toBe(false);
});
```

- [ ] **Step 3: Offline banner + sync chip** — render a slim offline banner when `!online` and a "N syncing…"/"Synced ✓" chip driven by `useOutbox().pending`. Reuse existing UI primitives; respect reduced-motion.

- [ ] **Step 4: Run** `npm run test && npm run typecheck && npm run lint` → green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/App.tsx frontend/src/app/offlineGate.ts frontend/src/app/offlineGate.test.tsx
git commit -m "feat(offline): bootstrap sync triggers + online-required gating + banner"
```

---

### Task 10: Precache theme art + build verification

**Files:**
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: Extend the Workbox precache** to include theme art so themed offline play renders. In the `workbox.globPatterns`, add `png` (or add a `runtimeCaching` CacheFirst rule for `/assets/themes/` and `public/assets/themes`). Prefer a runtime `CacheFirst` rule for `\/assets\/themes\/.*\.(png|webp)$` (cacheName `theme-art`, `expiration.maxEntries: 60`) so the initial install stays light:

```ts
{
  urlPattern: /\/assets\/themes\/.*\.(png|webp)$/,
  handler: "CacheFirst",
  options: { cacheName: "theme-art", expiration: { maxEntries: 60 }, cacheableResponse: { statuses: [0, 200] } },
},
```

- [ ] **Step 2: Build** — `npm run build` → succeeds; confirm the generated SW (`dist/sw.js`) contains the new runtime rule and the app shell still precaches.

- [ ] **Step 3: Commit**

```bash
git add frontend/vite.config.ts
git commit -m "feat(offline): cache theme art for offline rendering"
```

---

### Task 11: Manual offline smoke (Playwright) + final green

**Files:** none (verification)

- [ ] **Step 1:** `npm run build && npm run preview`; in Playwright, load the app authenticated, let content download, then set the browser context offline (`context.setOffline(true)`), and verify: Campaign level plays + reveals + shows provisional clear; Practice plays offline; Leaderboard/Duel show the online-required panel; the offline banner appears.
- [ ] **Step 2:** Set `context.setOffline(false)`; verify the outbox drains (sync chip → "Synced ✓"), coins/ladder reconcile, and pending marks clear.
- [ ] **Step 3:** `npm run test && npm run typecheck && npm run lint && npm run build` → all green.
- [ ] **Step 4: Commit** any fixups.

```bash
git add -A frontend
git commit -m "test(offline): offline smoke pass + green build"
```

---

## Notes for the reviewer

- Online play paths are untouched — every new behavior is behind `useNetwork().online === false` or additive endpoints.
- Exactly-once relies on the backend `offline_client_id` unique index; the client generates one UUID per finished session and never mutates it on retry.
- Provisional campaign progress is display-only; the server ladder remains truth and provisional marks are cleared once the outbox drains.
- Copy stays within DESIGN §7 honesty rules (no fake counts; coins-not-cash; "will finalize when you're back online").
