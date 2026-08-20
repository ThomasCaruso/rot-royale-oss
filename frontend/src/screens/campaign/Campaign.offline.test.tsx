// @vitest-environment jsdom
/**
 * Offline Campaign: with a cached level and the device offline, CampaignPlay plays a full local
 * level (reveal from the cached answer), enqueues ONE campaign result to the outbox, and marks the
 * level provisionally cleared — no network. The online path stays unchanged (guarded by props).
 *
 * We drive CampaignPlay directly (render with `offlineRounds` + `userId`) rather than deep-nav the
 * hub — the container just threads those props through, and the play loop is where the offline
 * behavior lives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@/modules"; // registers trivia so getModule("trivia") resolves
import { CampaignPlay } from "./CampaignPlay";
import type { CampaignStartResponse } from "@/api/client";
import type { OfflineRound } from "@/offline/types";
import { listOutbox, removeFromOutbox } from "@/offline/db";
import { loadProvisional } from "@/offline/campaignLocal";

// jsdom lacks matchMedia; Confetti (final-round celebration) reads it. Stub a non-reduced matcher.
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

const USER = "user-offline-1";
const WORLD = "Science";
const LEVEL = 3;

const round: OfflineRound = {
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
};

const session: CampaignStartResponse = {
  entry_id: "",
  world: WORLD,
  level: LEVEL,
  title: "Test Level",
  is_boss: false,
  rounds: [{ idx: 0, type: "trivia", client_spec: round.client_spec as unknown as Record<string, unknown> }],
};

async function clearOutbox() {
  for (const r of await listOutbox()) await removeFromOutbox(r.client_id);
}

describe("Campaign offline", () => {
  beforeEach(async () => {
    await clearOutbox();
    globalThis.localStorage?.clear();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("plays offline from the cached level, queues ONE campaign result, and marks it provisionally cleared", async () => {
    const onFinished = vi.fn();

    render(
      <CampaignPlay
        session={session}
        offlineRounds={[round]}
        userId={USER}
        onFinished={onFinished}
        onAbort={() => {}}
      />,
    );

    // The category splash shows for ~0.9s before the question — wait it out.
    await screen.findByText("2+2", {}, { timeout: 3000 });

    // Lock in an answer; the module waits ~420ms then fires onComplete → local reveal.
    fireEvent.click(screen.getByText("4"));

    // Single-round level → this reveal is final; Continue enqueues + marks provisional + finishes.
    const cont = await screen.findByText(/Finish Level/i, {}, { timeout: 3000 });
    fireEvent.click(cont);

    // ONE campaign outbox record, carrying the recorded choice as a stable source index.
    await waitFor(async () => expect(await listOutbox()).toHaveLength(1), { timeout: 3000 });
    const [rec] = await listOutbox();
    expect(rec.kind).toBe("campaign");
    if (rec.kind === "campaign") {
      expect(rec.payload.world).toBe(WORLD);
      expect(rec.payload.level).toBe(LEVEL);
      expect(rec.payload.items).toHaveLength(1);
      expect(rec.payload.items[0]).toMatchObject({ question_id: "q1", selected_source_index: 0 });
    }

    // The level is now provisionally cleared for this user (drives the ladder overlay + pending mark).
    const prov = loadProvisional(USER);
    expect(prov.cleared).toContainEqual({ world: WORLD, level: LEVEL });

    // onFinished was called with the PROVISIONAL flag (so LevelComplete hides reward chrome).
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    const [completion, opts] = onFinished.mock.calls[0];
    expect(opts).toMatchObject({ provisional: true });
    expect(completion).toMatchObject({ world: WORLD, level: LEVEL, correct: 1, total: 1 });
  });

  it("does not touch the outbox until the level is finished", async () => {
    render(
      <CampaignPlay
        session={session}
        offlineRounds={[round]}
        userId={USER}
        onFinished={() => {}}
        onAbort={() => {}}
      />,
    );
    await screen.findByText("2+2", {}, { timeout: 3000 });
    // Before answering, nothing is queued.
    expect(await listOutbox()).toHaveLength(0);
  });
});
