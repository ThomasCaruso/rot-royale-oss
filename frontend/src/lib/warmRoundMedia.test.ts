// @vitest-environment jsdom
/**
 * Warming the run's media.
 *
 * The properties worth pinning are the ones whose failure is invisible: warming the WRONG thing (a
 * spec field that merely looks like a URL), warming in the wrong ORDER (the 1.3MB clip ahead of the
 * assets needed sooner), or warming at all when the player asked the OS to save data. None of these
 * would ever surface as a bug report — they would just quietly cost people money or make the round
 * they are on slower, which is the opposite of the point.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { warmRoundMedia, type WarmableRound } from "./warmRoundMedia";

const CHANGE: WarmableRound = {
  type: "change_detection",
  client_spec: { base_url: "/c/a_base.jpg", altered_url: "/c/a_altered.jpg", key: "a" },
};
const VIDEO: WarmableRound = {
  type: "video",
  client_spec: { base_url: "/v/b_base.mp4", altered_url: "/v/b_altered.mp4" },
};
const TRIVIA: WarmableRound = {
  type: "trivia",
  client_spec: { prompt: "q", options: ["a", "b", "c", "d"] },
};

let fetched: string[];

/** Run every queued idle callback and let the sequential warm loop drain. */
async function drain() {
  await vi.runAllTimersAsync();
}

describe("warmRoundMedia", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetched = [];
    vi.stubGlobal("fetch", (url: string) => {
      fetched.push(url);
      return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    });
    // No requestIdleCallback in jsdom; the setTimeout fallback is the path under test.
    vi.stubGlobal("navigator", { ...navigator, connection: undefined });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("warms both assets of a media round", async () => {
    warmRoundMedia([CHANGE]);
    await drain();
    expect(fetched).toEqual(["/c/a_base.jpg", "/c/a_altered.jpg"]);
  });

  it("fetches nothing for a round that carries no media", async () => {
    warmRoundMedia([TRIVIA]);
    await drain();
    expect(fetched).toEqual([]);
  });

  it("only ever fetches the known media keys", async () => {
    // A spec is an opaque dict from the server. Fetching anything string-shaped in it would turn a
    // future spec field into an accidental request.
    warmRoundMedia([
      { type: "change_detection", client_spec: { base_url: "/ok.jpg", icon: "/not-a-request.png" } },
    ]);
    await drain();
    expect(fetched).toEqual(["/ok.jpg"]);
  });

  it("warms the cheap assets before the video clip", async () => {
    // A clip is ~6x a change pair. Ahead of the others it holds the connection while the assets
    // that are needed sooner wait behind it — video never sits in slot 1.
    warmRoundMedia([VIDEO, CHANGE]);
    await drain();
    expect(fetched).toEqual([
      "/c/a_base.jpg",
      "/c/a_altered.jpg",
      "/v/b_base.mp4",
      "/v/b_altered.mp4",
    ]);
  });

  it("fetches nothing when the player has data saver on", async () => {
    vi.stubGlobal("navigator", { ...navigator, connection: { saveData: true } });
    warmRoundMedia([CHANGE, VIDEO]);
    await drain();
    expect(fetched).toEqual([]);
  });

  it("stops when cancelled", async () => {
    const cancel = warmRoundMedia([CHANGE, VIDEO]);
    cancel();
    await drain();
    expect(fetched).toEqual([]);
  });

  it("a failed warm does not stop the rest", async () => {
    // Best-effort: the round fetches the asset itself if this never landed, so one dead request
    // must not abandon the remaining warms.
    vi.stubGlobal("fetch", (url: string) => {
      fetched.push(url);
      return url.includes("a_base") ? Promise.reject(new Error("offline")) : Promise.resolve({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    });
    warmRoundMedia([CHANGE]);
    await drain();
    expect(fetched).toEqual(["/c/a_base.jpg", "/c/a_altered.jpg"]);
  });

  it("does not fetch the same url twice across rounds", async () => {
    warmRoundMedia([CHANGE, { ...CHANGE }]);
    await drain();
    expect(fetched).toEqual(["/c/a_base.jpg", "/c/a_altered.jpg"]);
  });
});
