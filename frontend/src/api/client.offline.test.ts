import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client";

describe("offline api methods", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
  });
  it("posts campaign offline-complete with the body", async () => {
    await api.campaignOfflineComplete({ world: "Science", level: 1, client_id: "c1", items: [] });
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const [, init] = calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({ world: "Science", level: 1, client_id: "c1" });
  });
  it("builds the offline-pool GET url with category", async () => {
    await api.practiceOfflinePool("Science & Nature");
    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/practice/offline-pool?category=Science%20%26%20Nature");
  });
});
