// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/api/client";
import { trackInteraction } from "./interactionTracker";

describe("trackInteraction — fire-and-forget personalization signals", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the interaction payload to the API", () => {
    const spy = vi
      .spyOn(api, "recordQuestionInteraction")
      .mockResolvedValue({ recorded: true });

    trackInteraction({
      mode: "practice",
      entry_id: "e-1",
      idx: 0,
      is_correct: true,
      response_ms: 1500,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "practice", entry_id: "e-1", idx: 0, is_correct: true }),
    );
  });

  it("swallows API rejections — gameplay never sees a tracking failure", async () => {
    vi.spyOn(api, "recordQuestionInteraction").mockRejectedValue(new Error("network down"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    expect(() => trackInteraction({ mode: "quick" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 10)); // let the rejection settle

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("swallows synchronous throws from the API layer", () => {
    vi.spyOn(api, "recordQuestionInteraction").mockImplementation(() => {
      throw new Error("sync explosion");
    });
    expect(() => trackInteraction({ mode: "practice" })).not.toThrow();
  });
});
