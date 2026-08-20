// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/api/client";
import { trackFunnel, trackFunnelOnce } from "./analytics";

describe("funnel analytics wrapper — best-effort, never into gameplay", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the event + source through the beacon", () => {
    const spy = vi
      .spyOn(api, "sendFunnelBeacon")
      .mockResolvedValue(new Response(null, { status: 202 }));
    trackFunnel("save_profile_clicked", "reveal");
    expect(spy).toHaveBeenCalledWith({ event: "save_profile_clicked", source: "reveal" });
  });

  it("swallows beacon rejections — no unhandled rejection, no throw", async () => {
    vi.spyOn(api, "sendFunnelBeacon").mockRejectedValue(new Error("offline"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    expect(() => trackFunnel("intro_viewed")).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("swallows synchronous throws from the transport", () => {
    vi.spyOn(api, "sendFunnelBeacon").mockImplementation(() => {
      throw new Error("sync explosion");
    });
    expect(() => trackFunnel("guest_created")).not.toThrow();
  });

  it("trackFunnelOnce dedupes per page-load (StrictMode double-mounts)", () => {
    const spy = vi
      .spyOn(api, "sendFunnelBeacon")
      .mockResolvedValue(new Response(null, { status: 202 }));
    trackFunnelOnce("ranked_save_gate_viewed");
    trackFunnelOnce("ranked_save_gate_viewed");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
