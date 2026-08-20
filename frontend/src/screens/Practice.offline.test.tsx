// @vitest-environment jsdom
/**
 * Offline Practice: with a cached pool and the device offline, Practice plays a full local session
 * (reveal from the cached answer) and enqueues one practice result to the outbox — no network. The
 * online path is unchanged (guarded by useNetwork).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@/modules"; // registers trivia/rapid_math/memory_flash so getModule("trivia") resolves
import { Practice } from "./Practice";
import { setOnline } from "@/store/network";
import { putPool, listOutbox, removeFromOutbox } from "@/offline/db";

// jsdom doesn't implement matchMedia; Confetti (final-round celebration) reads it. Stub a
// non-reduced matcher so the component tree renders.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

async function clearOutbox() {
  for (const r of await listOutbox()) await removeFromOutbox(r.client_id);
}

describe("Practice offline", () => {
  beforeEach(async () => {
    setOnline(false);
    await clearOutbox();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("plays offline from the cached pool and queues a result", async () => {
    await putPool({
      category: null,
      bank_version: "v1",
      questions: [
        {
          question_id: "q1",
          idx: 0,
          client_spec: {
            prompt: "2+2",
            options: ["4", "5", "6", "7"],
            category: "Science & Nature",
            icon: "flask",
            time_limit_ms: 10000,
          },
          option_source_index: [0, 1, 2, 3],
          correct_index: 0,
          explanation: null,
        },
      ],
    });

    render(<Practice mode={null} category={null} onExit={() => {}} />);

    // The category splash shows for ~1s before the question — wait it out.
    await screen.findByText("2+2", {}, { timeout: 3000 });

    // Lock in an answer; the module waits ~420ms then fires onComplete → local reveal.
    fireEvent.click(screen.getByText("4"));

    // Single-round pool → this reveal is the final one; Continue enqueues the result.
    const cont = await screen.findByText("See results", {}, { timeout: 3000 });
    fireEvent.click(cont);

    await waitFor(async () => expect(await listOutbox()).toHaveLength(1), { timeout: 3000 });

    const [rec] = await listOutbox();
    expect(rec.kind).toBe("practice");
    if (rec.kind === "practice") {
      expect(rec.payload.items).toHaveLength(1);
      expect(rec.payload.items[0]).toMatchObject({
        question_id: "q1",
        selected_source_index: 0,
      });
    }
  });

  it("shows a not-downloaded error when offline with no cached pool", async () => {
    render(<Practice mode={null} category="Sports" onExit={() => {}} />);
    await screen.findByText(/Not downloaded yet/i, {}, { timeout: 3000 });
  });
});
