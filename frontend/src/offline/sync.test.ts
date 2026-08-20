// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { enqueue } from "./outbox";
import { drainOutbox } from "./sync";
import { listOutbox, removeFromOutbox } from "./db";
import { ApiError } from "@/api/client";

async function clearOutbox() {
  for (const r of await listOutbox()) await removeFromOutbox(r.client_id);
}

describe("sync worker", () => {
  beforeEach(clearOutbox);

  it("posts each record once and clears it on success", async () => {
    const campaign = vi.fn(async () => ({ passed: true }));
    const practice = vi.fn(async () => ({ correct: 5 }));
    await enqueue({ kind: "campaign", client_id: "c1", created_at: 1, attempts: 0, payload: { world: "Science", level: 1, items: [] } });
    await drainOutbox({ campaign, practice, onReconciled: () => {} });
    expect(campaign).toHaveBeenCalledTimes(1);
    expect(await listOutbox()).toHaveLength(0);
  });

  it("keeps a record queued on network failure but drops it on 4xx", async () => {
    const netErr = vi.fn(async () => { throw new ApiError(0, "offline"); });
    await enqueue({ kind: "campaign", client_id: "c2", created_at: 1, attempts: 0, payload: { world: "Science", level: 1, items: [] } });
    await drainOutbox({ campaign: netErr, practice: vi.fn(), onReconciled: () => {} });
    expect(await listOutbox()).toHaveLength(1); // still queued

    const badReq = vi.fn(async () => { throw new ApiError(400, "bad"); });
    await drainOutbox({ campaign: badReq, practice: vi.fn(), onReconciled: () => {} });
    expect(await listOutbox()).toHaveLength(0); // dropped
  });

  it("BREAKS on a transient failure so a later record is never attempted (FIFO ordering)", async () => {
    // A transient failure on record #1 must stop the whole drain — record #2 (which may depend on
    // #1 settling server-side, e.g. the next campaign level) must NOT be POSTed ahead of it.
    const campaign = vi.fn(async () => { throw new ApiError(0, "offline"); });
    await enqueue({ kind: "campaign", client_id: "first", created_at: 1, attempts: 0, payload: { world: "Science", level: 1, items: [] } });
    await enqueue({ kind: "campaign", client_id: "second", created_at: 2, attempts: 0, payload: { world: "Science", level: 2, items: [] } });
    await drainOutbox({ campaign, practice: vi.fn(), onReconciled: () => {} });
    expect(campaign).toHaveBeenCalledTimes(1); // only #1 attempted, then break
    expect((await listOutbox()).map((r) => r.client_id)).toEqual(["first", "second"]); // both preserved
  });

  it("CONTINUES past a 4xx-dropped record to the next one (FIFO)", async () => {
    // A permanent 4xx on #1 drops it and moves on to #2, in FIFO order.
    const campaign = vi
      .fn()
      .mockImplementationOnce(async () => { throw new ApiError(400, "bad"); }) // #1 rejected
      .mockImplementationOnce(async () => ({ passed: true })); // #2 succeeds
    await enqueue({ kind: "campaign", client_id: "first", created_at: 1, attempts: 0, payload: { world: "Science", level: 1, items: [] } });
    await enqueue({ kind: "campaign", client_id: "second", created_at: 2, attempts: 0, payload: { world: "Science", level: 2, items: [] } });
    await drainOutbox({ campaign, practice: vi.fn(), onReconciled: () => {} });
    expect(campaign).toHaveBeenCalledTimes(2); // #1 then #2
    expect(await listOutbox()).toHaveLength(0); // both gone (one dropped, one settled)
  });
});
