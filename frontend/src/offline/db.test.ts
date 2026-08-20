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
